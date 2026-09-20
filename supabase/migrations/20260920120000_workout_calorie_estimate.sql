-- Up Migration

alter table public.workouts
  add column active_calories_kcal integer,
  add column calorie_estimate_version smallint,
  add column calorie_estimate_weight_kg numeric(7, 2),
  add column calorie_estimate_duration_min numeric(7, 1),
  add column calorie_estimated_at timestamptz,
  add constraint workouts_active_calories_positive
    check (active_calories_kcal is null or active_calories_kcal > 0),
  add constraint workouts_calorie_estimate_version_positive
    check (calorie_estimate_version is null or calorie_estimate_version > 0),
  add constraint workouts_calorie_estimate_weight_positive
    check (calorie_estimate_weight_kg is null or calorie_estimate_weight_kg > 0),
  add constraint workouts_calorie_estimate_duration_positive
    check (calorie_estimate_duration_min is null or calorie_estimate_duration_min > 0);

create or replace function app_private.refresh_workout_calorie_estimate(
  p_workout_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  workout_row public.workouts%rowtype;
  weight_kg_value numeric;
  confirmed_set_count integer := 0;
  duration_set_count integer := 0;
  exercise_count integer := 0;
  recorded_duration_min numeric := 0;
  average_rpe numeric;
  has_circuit boolean := false;
  has_interval boolean := false;
  bodyweight_only boolean := false;
  has_heavy_compound boolean := false;
  raw_duration_min numeric;
  structural_duration_min numeric;
  effective_duration_min numeric;
  met_value numeric;
  calories_value integer;
begin
  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  if workout_row.id is null then
    return;
  end if;

  if workout_row.status <> 'done' then
    if workout_row.active_calories_kcal is not null then
      update public.workouts workout
      set active_calories_kcal = null,
          calorie_estimate_version = null,
          calorie_estimate_weight_kg = null,
          calorie_estimate_duration_min = null,
          calorie_estimated_at = null
      where workout.id = p_workout_id;
    end if;
    return;
  end if;

  select progress.weight_kg into weight_kg_value
  from public.client_progress progress
  where progress.client_id = workout_row.client_id
    and progress.deleted_at is null
    and progress.weight_kg > 0
  order by
    (progress.recorded_on > workout_row.workout_date),
    case
      when progress.recorded_on <= workout_row.workout_date
        then workout_row.workout_date - progress.recorded_on
      else progress.recorded_on - workout_row.workout_date
    end,
    progress.recorded_on desc,
    progress.id desc
  limit 1;

  select
    count(*)::integer,
    count(*) filter (
      where exercise.input_kind in ('duration', 'distance')
        and coalesce(workout_set.fact_duration_min, 0) * 60
          + coalesce(workout_set.fact_duration_sec, 0) > 0
    )::integer,
    count(distinct exercise.id)::integer,
    coalesce(sum(
      coalesce(workout_set.fact_duration_min, 0)
      + coalesce(workout_set.fact_duration_sec, 0) / 60.0
    ), 0),
    avg(coalesce(workout_set.fact_rpe, workout_set.plan_rpe)),
    coalesce(bool_or(exercise.block_preset = 'circuit'), false),
    coalesce(bool_or(exercise.block_preset = 'interval'), false),
    coalesce(bool_and(
      exercise.input_kind = 'reps'
      and coalesce(workout_set.fact_weight_kg, workout_set.plan_weight_kg, 0) = 0
    ), false),
    coalesce(bool_or(
      exercise.exercise_ref ~* '(squat|deadlift|leg[-_ ]?press)'
      or exercise.exercise_name ~* '(присед|станов|жим ногами|squat|deadlift|leg press)'
    ), false)
  into
    confirmed_set_count,
    duration_set_count,
    exercise_count,
    recorded_duration_min,
    average_rpe,
    has_circuit,
    has_interval,
    bodyweight_only,
    has_heavy_compound
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where exercise.workout_id = p_workout_id
    and workout_set.confirmed_at is not null;

  if weight_kg_value is null or confirmed_set_count = 0 then
    update public.workouts workout
    set active_calories_kcal = null,
        calorie_estimate_version = null,
        calorie_estimate_weight_kg = null,
        calorie_estimate_duration_min = null,
        calorie_estimated_at = null
    where workout.id = p_workout_id
      and (
        workout.active_calories_kcal is not null
        or workout.calorie_estimate_version is not null
        or workout.calorie_estimate_weight_kg is not null
        or workout.calorie_estimate_duration_min is not null
        or workout.calorie_estimated_at is not null
      );
    return;
  end if;

  raw_duration_min := case
    when workout_row.started_at is not null
      and workout_row.completed_at is not null
      and workout_row.completed_at > workout_row.started_at
      then extract(epoch from (workout_row.completed_at - workout_row.started_at)) / 60.0
    when workout_row.start_time is not null
      and workout_row.end_time is not null
      and workout_row.end_time > workout_row.start_time
      then extract(epoch from (workout_row.end_time - workout_row.start_time)) / 60.0
    else null
  end;

  -- 3.5 minutes per ordinary strength set includes work and the usual rest.
  -- Recorded cardio/duration sets keep their measured time instead.
  structural_duration_min := recorded_duration_min
    + greatest(confirmed_set_count - duration_set_count, 0) * 3.5
    + exercise_count * 2
    + 5;

  effective_duration_min := least(
    180,
    case
      when raw_duration_min is not null and raw_duration_min >= 5 then
        least(raw_duration_min, greatest(structural_duration_min * 1.25, recorded_duration_min, 10))
      else greatest(structural_duration_min, recorded_duration_min, 10)
    end
  );

  met_value := case
    when has_interval then 6.5
    when has_circuit then 5.8
    when bodyweight_only and coalesce(workout_row.session_rpe, average_rpe, 0) >= 8 then 6.5
    when bodyweight_only then 3.0
    when coalesce(workout_row.session_rpe, average_rpe, 0) >= 8.5 then 6.0
    when has_heavy_compound then 5.0
    else 3.5
  end;

  -- Active energy only: subtract the resting 1 MET before applying the
  -- standard MET formula. Rounded to 5 kcal to avoid false precision.
  calories_value := greatest(5, (
    round((((met_value - 1) * 3.5 * weight_kg_value / 200)
      * effective_duration_min) / 5) * 5
  )::integer);

  update public.workouts workout
  set active_calories_kcal = calories_value,
      calorie_estimate_version = 1,
      calorie_estimate_weight_kg = weight_kg_value,
      calorie_estimate_duration_min = round(effective_duration_min, 1),
      calorie_estimated_at = now()
  where workout.id = p_workout_id
    and (
      workout.active_calories_kcal is distinct from calories_value
      or workout.calorie_estimate_version is distinct from 1
      or workout.calorie_estimate_weight_kg is distinct from weight_kg_value
      or workout.calorie_estimate_duration_min is distinct from round(effective_duration_min, 1)
    );
end;
$$;

revoke all on function app_private.refresh_workout_calorie_estimate(uuid)
  from public;

create or replace function app_private.refresh_workout_calories_from_workout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_workout_calorie_estimate(new.id);
  return new;
end;
$$;

create or replace function app_private.refresh_workout_calories_from_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workout_id_value uuid;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_exercises exercise
  where exercise.id = case
    when tg_op = 'DELETE' then old.workout_exercise_id
    else new.workout_exercise_id
  end;
  if workout_id_value is not null then
    perform app_private.refresh_workout_calorie_estimate(workout_id_value);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app_private.refresh_workout_calories_from_exercise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_workout_calorie_estimate(case
    when tg_op = 'DELETE' then old.workout_id
    else new.workout_id
  end);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.refresh_workout_calories_from_workout(),
  app_private.refresh_workout_calories_from_set(),
  app_private.refresh_workout_calories_from_exercise() from public;

create trigger refresh_workout_calories_on_workout
after insert or update of status, workout_date, start_time, end_time,
  started_at, completed_at, session_rpe
on public.workouts for each row
execute function app_private.refresh_workout_calories_from_workout();

create trigger refresh_workout_calories_on_set
after insert or update of fact_weight_kg, fact_reps, fact_duration_min,
  fact_duration_sec, fact_distance_km, fact_rpe, confirmed_at or delete
on public.workout_sets for each row
execute function app_private.refresh_workout_calories_from_set();

create trigger refresh_workout_calories_on_exercise
after insert or update of input_kind, exercise_ref, exercise_name, block_preset or delete
on public.workout_exercises for each row
execute function app_private.refresh_workout_calories_from_exercise();

do $$
declare
  workout_id_value uuid;
begin
  for workout_id_value in
    select workout.id
    from public.workouts workout
    where workout.status = 'done'
      and workout.deleted_at is null
  loop
    perform app_private.refresh_workout_calorie_estimate(workout_id_value);
  end loop;
end;
$$;

drop function if exists public.list_workouts(date, date, uuid, integer, integer);
create function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, trainer_id uuid, client_name text, created_by uuid,
  started_by uuid, completed_by uuid,
  workout_date date, start_time time, end_time time,
  started_at timestamptz, completed_at timestamptz,
  status text, notes text, trainer_review text, trainer_reaction text,
  trainer_review_author_id uuid, trainer_reviewed_at timestamptz,
  client_comment text, session_rpe smallint, wellbeing text, discomfort boolean,
  active_calories_kcal integer, has_pr boolean, version bigint, stage_id uuid, stage_title text,
  total_count bigint, exercises jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  return query
  with paged_workouts as materialized (
    select
      workout.id, workout.trainer_id, workout.client_id, client.full_name as client_name,
      workout.created_by, workout.started_by, workout.completed_by,
      workout.workout_date, workout.start_time, workout.end_time,
      workout.started_at, workout.completed_at, workout.status, workout.notes,
      workout.trainer_review, workout.trainer_reaction,
      workout.trainer_review_author_id, workout.trainer_reviewed_at,
      workout.client_comment, workout.session_rpe, workout.wellbeing,
      workout.discomfort, workout.active_calories_kcal,
      case when workout.status = 'done'
        then public.workout_has_personal_record(workout.id)
        else false
      end as has_pr,
      workout.version, workout.stage_id, stage.title as stage_title,
      workout.created_at, count(*) over() as total_count
    from public.workouts workout
    join public.clients client
      on client.id = workout.client_id and client.trainer_id = workout.trainer_id
    left join public.goal_stages stage on stage.id = workout.stage_id
    where workout.deleted_at is null
      and (p_from is null or workout.workout_date >= p_from)
      and (p_to is null or workout.workout_date <= p_to)
      and (p_client_id is null or workout.client_id = p_client_id)
      and (
        client.auth_user_id = actor_id
        or (
          (
            client.trainer_id = actor_id
            or exists (
              select 1
              from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = actor_id
            )
          )
          and (
            workout.created_by = actor_id
            or (workout.created_by is null and workout.trainer_id = actor_id)
            or (
              workout.status = 'done'
              and workout.created_by = client.auth_user_id
            )
          )
        )
      )
    order by workout.workout_date desc, workout.start_time desc nulls last,
      workout.created_at desc, workout.id desc
    limit page_limit offset page_offset
  )
  select
    workout.id, workout.client_id, workout.trainer_id, workout.client_name,
    workout.created_by, workout.started_by, workout.completed_by,
    workout.workout_date, workout.start_time, workout.end_time,
    workout.started_at, workout.completed_at, workout.status, workout.notes,
    workout.trainer_review, workout.trainer_reaction,
    workout.trainer_review_author_id, workout.trainer_reviewed_at,
    workout.client_comment, workout.session_rpe, workout.wellbeing,
    workout.discomfort, workout.active_calories_kcal, workout.has_pr, workout.version,
    workout.stage_id, workout.stage_title, workout.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exercise.id, 'position', exercise.position,
        'exercise_source', exercise.exercise_source,
        'exercise_ref', exercise.exercise_ref,
        'custom_exercise_id', exercise.custom_exercise_id,
        'exercise_name', exercise.exercise_name,
        'muscle_group', exercise.muscle_group,
        'input_kind', exercise.input_kind,
        'block_id', exercise.block_id, 'block_type', exercise.block_type,
        'block_rounds', exercise.block_rounds,
        'trainer_comment', exercise.trainer_comment,
        'block_preset', exercise.block_preset,
        'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
        'rest_between_rounds_sec', exercise.rest_between_rounds_sec,
        'rest_between_sets_sec', exercise.rest_between_sets_sec,
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', workout_set.id, 'position', workout_set.position,
            'plan_weight_kg', workout_set.plan_weight_kg,
            'plan_reps', workout_set.plan_reps,
            'plan_duration_min', workout_set.plan_duration_min,
            'plan_duration_sec', workout_set.plan_duration_sec,
            'plan_distance_km', workout_set.plan_distance_km,
            'plan_rpe', workout_set.plan_rpe,
            'fact_weight_kg', workout_set.fact_weight_kg,
            'fact_reps', workout_set.fact_reps,
            'fact_duration_min', workout_set.fact_duration_min,
            'fact_duration_sec', workout_set.fact_duration_sec,
            'fact_distance_km', workout_set.fact_distance_km,
            'fact_rpe', workout_set.fact_rpe,
            'confirmed_at', workout_set.confirmed_at,
            'version', workout_set.version
          ) order by workout_set.position)
          from public.workout_sets workout_set
          where workout_set.workout_exercise_id = exercise.id
            and workout_set.trainer_id = workout.trainer_id
            and workout_set.client_id = workout.client_id
        ), '[]'::jsonb)
      ) order by exercise.position)
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = workout.trainer_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from paged_workouts workout
  order by workout.workout_date desc, workout.start_time desc nulls last,
    workout.created_at desc, workout.id desc;
end;
$$;

comment on function public.list_workouts(date, date, uuid, integer, integer) is
  'Accessible paginated workouts with explicit workout actors and the persisted FIT calorie estimate.';

revoke all on function public.list_workouts(date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer)
  to authenticated;
