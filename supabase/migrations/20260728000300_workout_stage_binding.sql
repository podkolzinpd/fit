-- Периодизация M2: мягкая привязка тренировки к этапу цели.
-- stage_id nullable; удаление этапа не ломает тренировку (set null).
alter table public.workouts
  add column stage_id uuid,
  add constraint workouts_stage_fk foreign key (stage_id)
    references public.goal_stages (id) on delete set null;
create index workouts_stage_idx on public.workouts (stage_id) where stage_id is not null;

-- Пересобираем legacy_save_workout с учётом stageId (тело идентично
-- 20260726000200, плюс stage_id в insert/update). Этап должен принадлежать
-- клиенту тренировки, иначе не привязываем (пишем null) — защита от чужого этапа.
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
      nullif(btrim(p_workout->>'notes'), ''),
      stage_id_value
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

revoke all on function private.legacy_save_workout(jsonb, bigint) from public, anon, authenticated;

-- list_workouts (security invoker) джойнит goal_stages напрямую, поэтому нужен
-- табличный GRANT (в M1 читали только через security-definer RPC). RLS-политики
-- уже ограничивают строки; grant даёт лишь право select на уровне таблицы.
grant select on public.client_goals, public.goal_stages to authenticated;

-- list_workouts + stage_id / stage_title (join goal_stages).
-- Меняется набор OUT-колонок, поэтому дропаем прежнюю сигнатуру перед пересозданием.
drop function if exists public.list_workouts(date, date, uuid, integer, integer);
create or replace function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, client_name text, workout_date date,
  start_time time, end_time time, started_at timestamptz, completed_at timestamptz,
  status text, notes text, version bigint, stage_id uuid, stage_title text,
  total_count bigint, exercises jsonb
)
language plpgsql stable security invoker set search_path = ''
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
  select workout.id, workout.client_id, client.full_name, workout.workout_date,
    workout.start_time, workout.end_time, workout.started_at, workout.completed_at,
    workout.status, workout.notes, workout.version, workout.stage_id, stage.title,
    count(*) over(),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', exercise.id, 'position', exercise.position,
          'exercise_source', exercise.exercise_source, 'exercise_ref', exercise.exercise_ref,
          'custom_exercise_id', exercise.custom_exercise_id, 'exercise_name', exercise.exercise_name,
          'muscle_group', exercise.muscle_group, 'input_kind', exercise.input_kind,
          'block_id', exercise.block_id, 'block_type', exercise.block_type,
          'block_rounds', exercise.block_rounds, 'trainer_comment', exercise.trainer_comment,
          'block_preset', exercise.block_preset,
          'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
          'rest_between_rounds_sec', exercise.rest_between_rounds_sec,
          'rest_between_sets_sec', exercise.rest_between_sets_sec,
          'sets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', workout_set.id, 'position', workout_set.position,
                'plan_weight_kg', workout_set.plan_weight_kg, 'plan_reps', workout_set.plan_reps,
                'plan_duration_min', workout_set.plan_duration_min, 'plan_distance_km', workout_set.plan_distance_km,
                'fact_weight_kg', workout_set.fact_weight_kg, 'fact_reps', workout_set.fact_reps,
                'fact_duration_min', workout_set.fact_duration_min, 'fact_distance_km', workout_set.fact_distance_km,
                'confirmed_at', workout_set.confirmed_at, 'version', workout_set.version
              ) order by workout_set.position
            )
            from public.workout_sets workout_set
            where workout_set.workout_exercise_id = exercise.id
              and workout_set.trainer_id = workout.trainer_id
              and workout_set.client_id = workout.client_id
          ), '[]'::jsonb)
        ) order by exercise.position
      )
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = workout.trainer_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
    and client.trainer_id = workout.trainer_id
  left join public.goal_stages stage on stage.id = workout.stage_id
  where public.can_access_client(workout.client_id)
    and workout.deleted_at is null
    and (p_from is null or workout.workout_date >= p_from)
    and (p_to is null or workout.workout_date <= p_to)
    and (p_client_id is null or workout.client_id = p_client_id)
  order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id
  limit page_limit offset page_offset;
end;
$$;

-- drop function сбросил гранты — восстанавливаем прежний доступ.
revoke all on function public.list_workouts(date, date, uuid, integer, integer) from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer) to authenticated;
