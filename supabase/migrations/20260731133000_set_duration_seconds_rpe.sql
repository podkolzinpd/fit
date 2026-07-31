-- Точные длительности и субъективная нагрузка подхода.
-- Минуты оставляем для чтения истории, новые записи используют *_duration_sec.

alter table public.custom_exercises
  drop constraint custom_exercises_kind_allowed,
  add constraint custom_exercises_kind_allowed
    check (input_kind in ('strength', 'distance', 'reps', 'duration'));

alter table public.workout_exercises
  drop constraint workout_exercises_kind_allowed,
  add constraint workout_exercises_kind_allowed
    check (input_kind in ('strength', 'distance', 'reps', 'duration'));

alter table public.workout_sets
  add column plan_duration_sec integer,
  add column fact_duration_sec integer,
  add column plan_rpe numeric(3, 1),
  add column fact_rpe numeric(3, 1),
  add constraint workout_sets_duration_sec_non_negative check (
    coalesce(plan_duration_sec, 0) >= 0 and coalesce(fact_duration_sec, 0) >= 0
  ),
  add constraint workout_sets_rpe_valid check (
    (plan_rpe is null or (plan_rpe between 6 and 10 and mod(plan_rpe * 10, 5) = 0))
    and (fact_rpe is null or (fact_rpe between 6 and 10 and mod(fact_rpe * 10, 5) = 0))
  );

-- Исторические значения кратны 0,5 минуты, но round безопасен для всех данных.
update public.workout_sets
set plan_duration_sec = round(plan_duration_min * 60)::integer
where plan_duration_min is not null;

update public.workout_sets
set fact_duration_sec = round(fact_duration_min * 60)::integer
where fact_duration_min is not null;

create or replace function private.legacy_save_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  root_id uuid := nullif(p_workout->>'id', '')::uuid;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  stage_id_value uuid := nullif(p_workout->>'stageId', '')::uuid;
  exercise jsonb;
  set_item jsonb;
  exercise_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.clients c
    where c.id = client_id_value and c.trainer_id = actor_id and c.archived_at is null
  ) then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;
  if stage_id_value is not null and not exists (
    select 1 from public.goal_stages stage
    where stage.id = stage_id_value and stage.client_id = client_id_value
  ) then
    stage_id_value := null;
  end if;

  if root_id is null then
    insert into public.workouts (
      trainer_id, client_id, workout_date, start_time, end_time, notes, stage_id
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), ''), stage_id_value
    ) returning id into root_id;
  else
    perform 1 from public.workouts
      where id = root_id and trainer_id = actor_id and deleted_at is null
      for update;
    if not found then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
    update public.workouts set
      client_id = client_id_value,
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      stage_id = stage_id_value,
      version = version + 1
    where id = root_id and trainer_id = actor_id
      and status = 'planned' and version = p_expected_version;
    if not found then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;
    delete from public.workout_exercises where workout_id = root_id and trainer_id = actor_id;
  end if;

  for exercise in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds, trainer_comment,
      block_preset, rest_between_exercises_sec, rest_between_rounds_sec, rest_between_sets_sec
    ) values (
      root_id, actor_id, client_id_value, (exercise->>'position')::smallint,
      exercise->>'source', exercise->>'ref', nullif(exercise->>'customExerciseId', '')::uuid,
      exercise->>'name', exercise->>'muscleGroup', exercise->>'inputKind',
      coalesce(nullif(exercise->>'blockId', '')::uuid, gen_random_uuid()),
      coalesce(nullif(exercise->>'blockType', ''), 'single'),
      greatest(coalesce(nullif(exercise->>'blockRounds', '')::smallint, 1), 1),
      nullif(btrim(exercise->>'trainerComment'), ''),
      coalesce(nullif(exercise->>'blockPreset', ''), 'set'),
      coalesce(nullif(exercise->>'restBetweenExercisesSec', '')::smallint, 0),
      coalesce(nullif(exercise->>'restBetweenRoundsSec', '')::smallint, 90),
      coalesce(nullif(exercise->>'restBetweenSetsSec', '')::smallint, 90)
    ) returning id into exercise_id;

    for set_item in select value from jsonb_array_elements(coalesce(exercise->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec, plan_distance_km, plan_rpe
      ) values (
        exercise_id, actor_id, client_id_value, (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'durationSec', '')::integer,
        nullif(set_item->>'distanceKm', '')::numeric,
        nullif(set_item->>'rpe', '')::numeric
      );
    end loop;
  end loop;
  return root_id;
end;
$$;

create or replace function private.legacy_save_live_set_draft(
  p_set_id uuid, p_draft jsonb, p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workout_sets s set
    fact_weight_kg = nullif(p_draft->>'weightKg', '')::numeric,
    fact_reps = nullif(p_draft->>'reps', '')::integer,
    fact_duration_min = nullif(p_draft->>'durationMin', '')::numeric,
    fact_duration_sec = coalesce(
      nullif(p_draft->>'durationSec', '')::integer,
      round(nullif(p_draft->>'durationMin', '')::numeric * 60)::integer
    ),
    fact_distance_km = nullif(p_draft->>'distanceKm', '')::numeric,
    fact_rpe = nullif(p_draft->>'rpe', '')::numeric,
    version = s.version + 1
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function private.legacy_confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workout_sets s set
    confirmed_at = now(),
    fact_weight_kg = coalesce(s.fact_weight_kg, s.plan_weight_kg),
    fact_reps = coalesce(s.fact_reps, s.plan_reps),
    fact_duration_min = coalesce(s.fact_duration_min, s.plan_duration_min),
    fact_duration_sec = coalesce(
      s.fact_duration_sec, s.plan_duration_sec,
      round(s.fact_duration_min * 60)::integer, round(s.plan_duration_min * 60)::integer
    ),
    fact_distance_km = coalesce(s.fact_distance_km, s.plan_distance_km),
    version = s.version + 1
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function private.legacy_append_live_set(
  p_workout_exercise_id uuid, p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select e.workout_id, e.client_id into workout_id_value, client_id_value
  from public.workout_exercises e where e.id = p_workout_exercise_id and e.trainer_id = actor_id;
  if not found then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  update public.workouts set version = version + 1
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  select coalesce(max(s.position) + 1, 0)::smallint into next_position
  from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id;
  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position,
    plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec, plan_distance_km, plan_rpe
  )
  select
    p_workout_exercise_id, actor_id, client_id_value, next_position,
    coalesce(last_set.fact_weight_kg, last_set.plan_weight_kg),
    coalesce(last_set.fact_reps, last_set.plan_reps),
    coalesce(last_set.fact_duration_min, last_set.plan_duration_min),
    coalesce(last_set.fact_duration_sec, last_set.plan_duration_sec,
      round(last_set.fact_duration_min * 60)::integer, round(last_set.plan_duration_min * 60)::integer),
    coalesce(last_set.fact_distance_km, last_set.plan_distance_km),
    coalesce(last_set.fact_rpe, last_set.plan_rpe)
  from (
    select s.plan_weight_kg, s.plan_reps, s.plan_duration_min, s.plan_duration_sec, s.plan_distance_km, s.plan_rpe,
           s.fact_weight_kg, s.fact_reps, s.fact_duration_min, s.fact_duration_sec, s.fact_distance_km, s.fact_rpe
    from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id
    order by s.position desc limit 1
  ) last_set right join (select 1) placeholder on true;
  return next_version;
end;
$$;

-- Заменяемое до начала упражнение не должно нести RPE/секунды старого типа.
create or replace function private.legacy_replace_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid(); next_version bigint; old_kind text;
  source_value text := p_exercise->>'source'; ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name'; group_value text := p_exercise->>'muscleGroup'; kind_value text := p_exercise->>'inputKind';
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if source_value = 'custom' then
    select c.id::text, c.id, c.name, c.muscle_group, c.input_kind
    into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises c where c.id = custom_id and c.trainer_id = actor_id and c.archived_at is null;
    if not found then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  elsif source_value <> 'system' then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  update public.workouts set version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version returning version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  select e.input_kind into old_kind from public.workout_exercises e
  where e.id = p_exercise_id and e.workout_id = p_workout_id and e.trainer_id = actor_id;
  if old_kind is null then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  if exists (select 1 from public.workout_sets s where s.workout_exercise_id = p_exercise_id and s.confirmed_at is not null) then
    raise exception 'exercise_already_started' using errcode = 'PT409';
  end if;
  update public.workout_exercises e set
    exercise_source = source_value, exercise_ref = ref_value, custom_exercise_id = custom_id,
    exercise_name = name_value, muscle_group = group_value, input_kind = kind_value
  where e.id = p_exercise_id;
  if old_kind is distinct from kind_value then
    update public.workout_sets s set
      plan_weight_kg = null, plan_reps = null, plan_duration_min = null, plan_duration_sec = null,
      plan_distance_km = null, plan_rpe = null,
      fact_weight_kg = null, fact_reps = null, fact_duration_min = null, fact_duration_sec = null,
      fact_distance_km = null, fact_rpe = null
    where s.workout_exercise_id = p_exercise_id;
  end if;
  return next_version;
end;
$$;

create or replace function public.list_workouts(
  p_from date default null, p_to date default null, p_client_id uuid default null,
  p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, client_name text, workout_date date,
  start_time time, end_time time, started_at timestamptz, completed_at timestamptz,
  status text, notes text, version bigint, stage_id uuid, stage_title text,
  total_count bigint, exercises jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query
  with paged_workouts as materialized (
    select workout.id, workout.trainer_id, workout.client_id, client.full_name as client_name,
      workout.workout_date, workout.start_time, workout.end_time, workout.started_at, workout.completed_at,
      workout.status, workout.notes, workout.version, workout.stage_id, stage.title as stage_title,
      workout.created_at, count(*) over() as total_count
    from public.workouts workout
    join public.clients client on client.id = workout.client_id and client.trainer_id = workout.trainer_id
    left join public.goal_stages stage on stage.id = workout.stage_id
    where workout.deleted_at is null
      and (p_from is null or workout.workout_date >= p_from)
      and (p_to is null or workout.workout_date <= p_to)
      and (p_client_id is null or workout.client_id = p_client_id)
      and (client.auth_user_id = actor_id or (
        (workout.created_by = actor_id or (workout.created_by is null and workout.trainer_id = actor_id))
        and (client.trainer_id = actor_id or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = workout.client_id and membership.trainer_id = actor_id
        ))
      ))
    order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id
    limit page_limit offset page_offset
  )
  select workout.id, workout.client_id, workout.client_name, workout.workout_date,
    workout.start_time, workout.end_time, workout.started_at, workout.completed_at,
    workout.status, workout.notes, workout.version, workout.stage_id, workout.stage_title,
    workout.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exercise.id, 'position', exercise.position,
        'exercise_source', exercise.exercise_source, 'exercise_ref', exercise.exercise_ref,
        'custom_exercise_id', exercise.custom_exercise_id, 'exercise_name', exercise.exercise_name,
        'muscle_group', exercise.muscle_group, 'input_kind', exercise.input_kind,
        'block_id', exercise.block_id, 'block_type', exercise.block_type, 'block_rounds', exercise.block_rounds,
        'trainer_comment', exercise.trainer_comment, 'block_preset', exercise.block_preset,
        'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
        'rest_between_rounds_sec', exercise.rest_between_rounds_sec,
        'rest_between_sets_sec', exercise.rest_between_sets_sec,
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', workout_set.id, 'position', workout_set.position,
            'plan_weight_kg', workout_set.plan_weight_kg, 'plan_reps', workout_set.plan_reps,
            'plan_duration_min', workout_set.plan_duration_min, 'plan_duration_sec', workout_set.plan_duration_sec,
            'plan_distance_km', workout_set.plan_distance_km, 'plan_rpe', workout_set.plan_rpe,
            'fact_weight_kg', workout_set.fact_weight_kg, 'fact_reps', workout_set.fact_reps,
            'fact_duration_min', workout_set.fact_duration_min, 'fact_duration_sec', workout_set.fact_duration_sec,
            'fact_distance_km', workout_set.fact_distance_km, 'fact_rpe', workout_set.fact_rpe,
            'confirmed_at', workout_set.confirmed_at, 'version', workout_set.version
          ) order by workout_set.position)
          from public.workout_sets workout_set
          where workout_set.workout_exercise_id = exercise.id
            and workout_set.trainer_id = workout.trainer_id and workout_set.client_id = workout.client_id
        ), '[]'::jsonb)
      ) order by exercise.position)
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = workout.trainer_id and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from paged_workouts workout
  order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id;
end;
$$;
