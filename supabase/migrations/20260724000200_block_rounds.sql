-- Раунды/круги блока: у блока (суперсет/трисет/круговая) есть число проходов.
-- Одинаково у всех упражнений блока, как block_type. 1 круг = 1 подход каждого.
-- Обратная совместимость: колонка с DEFAULT 1, старые вызовы валидны.

alter table public.workout_exercises
  add column if not exists block_rounds smallint not null default 1;

alter table public.workout_exercises
  drop constraint if exists workout_exercises_block_rounds_positive;
alter table public.workout_exercises
  add constraint workout_exercises_block_rounds_positive check (block_rounds >= 1);

-- save_workout: читает block_id / block_type / block_rounds из JSON упражнения.
create or replace function public.save_workout(
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

  if root_id is null then
    insert into public.workouts (
      trainer_id, client_id, workout_date, start_time, end_time, notes
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), '')
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
      version = version + 1
    where id = root_id and trainer_id = actor_id
      and status = 'planned'
      and version = p_expected_version;
    if not found then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;
    delete from public.workout_exercises where workout_id = root_id and trainer_id = actor_id;
  end if;

  for exercise in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds
    ) values (
      root_id, actor_id, client_id_value, (exercise->>'position')::smallint,
      exercise->>'source', exercise->>'ref', nullif(exercise->>'customExerciseId', '')::uuid,
      exercise->>'name', exercise->>'muscleGroup', exercise->>'inputKind',
      coalesce(nullif(exercise->>'blockId', '')::uuid, gen_random_uuid()),
      coalesce(nullif(exercise->>'blockType', ''), 'single'),
      greatest(coalesce(nullif(exercise->>'blockRounds', '')::smallint, 1), 1)
    ) returning id into exercise_id;

    for set_item in select value from jsonb_array_elements(coalesce(exercise->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_distance_km
      ) values (
        exercise_id, actor_id, client_id_value, (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'distanceKm', '')::numeric
      );
    end loop;
  end loop;

  return root_id;
end;
$$;

-- append_live_exercise: новое упражнение — свой одиночный блок, 1 круг.
create or replace function public.append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
  exercise_id uuid;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if source_value = 'custom' then
    select c.id::text, c.id, c.name, c.muscle_group, c.input_kind
      into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises c
    where c.id = custom_id and c.trainer_id = actor_id and c.archived_at is null;
    if not found then
      raise exception 'exercise_not_found' using errcode = 'PT404';
    end if;
  elsif source_value <> 'system' then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning client_id, version into client_id_value, next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select coalesce(max(e.position) + 1, 0)::smallint into next_position
  from public.workout_exercises e where e.workout_id = p_workout_id;

  insert into public.workout_exercises (
    workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
    custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds
  ) values (
    p_workout_id, actor_id, client_id_value, next_position, source_value, ref_value,
    custom_id, name_value, group_value, kind_value, gen_random_uuid(), 'single', 1
  ) returning id into exercise_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position
  ) values (exercise_id, actor_id, client_id_value, 0);

  return next_version;
end;
$$;

-- list_workouts: возвращает block_rounds в JSON упражнения.
create or replace function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  workout_date date,
  start_time time,
  end_time time,
  started_at timestamptz,
  completed_at timestamptz,
  status text,
  notes text,
  version bigint,
  total_count bigint,
  exercises jsonb
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
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'PT422';
  end if;

  return query
  select
    workout.id,
    workout.client_id,
    client.full_name,
    workout.workout_date,
    workout.start_time,
    workout.end_time,
    workout.started_at,
    workout.completed_at,
    workout.status,
    workout.notes,
    workout.version,
    count(*) over(),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', exercise.id,
          'position', exercise.position,
          'exercise_source', exercise.exercise_source,
          'exercise_ref', exercise.exercise_ref,
          'custom_exercise_id', exercise.custom_exercise_id,
          'exercise_name', exercise.exercise_name,
          'muscle_group', exercise.muscle_group,
          'input_kind', exercise.input_kind,
          'block_id', exercise.block_id,
          'block_type', exercise.block_type,
          'block_rounds', exercise.block_rounds,
          'sets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', workout_set.id,
                'position', workout_set.position,
                'plan_weight_kg', workout_set.plan_weight_kg,
                'plan_reps', workout_set.plan_reps,
                'plan_duration_min', workout_set.plan_duration_min,
                'plan_distance_km', workout_set.plan_distance_km,
                'fact_weight_kg', workout_set.fact_weight_kg,
                'fact_reps', workout_set.fact_reps,
                'fact_duration_min', workout_set.fact_duration_min,
                'fact_distance_km', workout_set.fact_distance_km,
                'confirmed_at', workout_set.confirmed_at,
                'version', workout_set.version
              )
              order by workout_set.position
            )
            from public.workout_sets workout_set
            where workout_set.workout_exercise_id = exercise.id
              and workout_set.trainer_id = actor_id
              and workout_set.client_id = workout.client_id
          ), '[]'::jsonb)
        )
        order by exercise.position
      )
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = actor_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from public.workouts workout
  join public.clients client
    on client.id = workout.client_id
    and client.trainer_id = workout.trainer_id
  where workout.trainer_id = actor_id
    and workout.deleted_at is null
    and (p_from is null or workout.workout_date >= p_from)
    and (p_to is null or workout.workout_date <= p_to)
    and (p_client_id is null or workout.client_id = p_client_id)
  order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id
  limit page_limit
  offset page_offset;
end;
$$;

revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.append_live_exercise(uuid, jsonb, bigint) from public, anon;
revoke all on function public.list_workouts(date, date, uuid, integer, integer) from public, anon;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.append_live_exercise(uuid, jsonb, bigint) to authenticated;
grant execute on function public.list_workouts(date, date, uuid, integer, integer) to authenticated;
