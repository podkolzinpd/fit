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

-- Down Migration

drop trigger refresh_workout_calories_on_exercise on public.workout_exercises;
drop trigger refresh_workout_calories_on_set on public.workout_sets;
drop trigger refresh_workout_calories_on_workout on public.workouts;
drop function app_private.refresh_workout_calories_from_exercise();
drop function app_private.refresh_workout_calories_from_set();
drop function app_private.refresh_workout_calories_from_workout();
drop function app_private.refresh_workout_calorie_estimate(uuid);

alter table public.workouts
  drop constraint workouts_calorie_estimate_duration_positive,
  drop constraint workouts_calorie_estimate_weight_positive,
  drop constraint workouts_calorie_estimate_version_positive,
  drop constraint workouts_active_calories_positive,
  drop column calorie_estimated_at,
  drop column calorie_estimate_duration_min,
  drop column calorie_estimate_weight_kg,
  drop column calorie_estimate_version,
  drop column active_calories_kcal;
