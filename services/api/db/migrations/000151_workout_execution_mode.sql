-- Up Migration

-- Режим выполнения тренировки (YAFIT-627, docs/design/live-execution-mode.md):
-- "timer" — таймер ведёт подходы со временем и засчитывает их на нуле,
-- "manual" — человек подтверждает подходы сам (поведение #1509). NULL у старых
-- тренировок читается клиентом как "manual". Как и prep_seconds (000132), это
-- настройка плана: отсутствующий ключ executionMode сохраняет прежнее значение.
alter table public.workouts
  add column execution_mode text
    constraint workouts_execution_mode_valid check (execution_mode is null or execution_mode in ('timer', 'manual'));

create or replace function app_private.save_planned_workout_without_cross_partition_snapshots(p_workout jsonb, p_expected_version bigint default null::bigint)
returns table(workout_id uuid, version bigint)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
  requested_client_id uuid := (p_workout->>'clientId')::uuid;
  requested_workout_id uuid := nullif(p_workout->>'id', '')::uuid;
  existing_client_id uuid;
  existing_status text;
  exercise_item jsonb;
  set_item jsonb;
  exercise_id uuid;
  custom_exercise_id_value uuid;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select client.trainer_id
  into root_trainer_id
  from public.clients client
  where client.id = requested_client_id
    and client.archived_at is null
    and (
      (
        actor_role = 'trainer'
        and (
          client.trainer_id = actor_id
          or exists (
            select 1
            from public.client_trainers membership
            where membership.client_id = client.id
              and membership.trainer_id = actor_id
          )
        )
      )
      or (
        actor_role = 'client'
        and client.auth_user_id = actor_id
      )
    );

  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  if requested_workout_id is null then
    if p_expected_version is not null then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    insert into public.workouts (
      trainer_id, client_id, created_by, updated_by, workout_date,
      start_time, end_time, status, notes, origin, favorite_title, prep_seconds, execution_mode
    ) values (
      root_trainer_id,
      requested_client_id,
      actor_id,
      actor_id,
      (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      'planned',
      nullif(btrim(p_workout->>'notes'), ''),
      case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end,
      nullif(btrim(p_workout->>'favoriteTitle'), ''),
      nullif(nullif(p_workout->>'prepSeconds', '')::smallint, 0),
      nullif(p_workout->>'executionMode', '')
    )
    returning id, public.workouts.version
    into requested_workout_id, next_version;
  else
    select
      workout.client_id,
      workout.status
    into
      existing_client_id,
      existing_status
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = requested_workout_id
      and workout.deleted_at is null
      and workout.trainer_id = root_trainer_id
      and (
        (
          actor_role = 'trainer'
          and (
            workout.created_by = actor_id
            or (workout.created_by is null and workout.trainer_id = actor_id)
          )
          and (
            client.trainer_id = actor_id
            or exists (
              select 1
              from public.client_trainers membership
              where membership.client_id = client.id
                and membership.trainer_id = actor_id
            )
          )
        )
        or (
          actor_role = 'client'
          and client.auth_user_id = actor_id
          and workout.created_by = actor_id
        )
      )
    for update of workout;

    if existing_client_id is null then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
    if existing_client_id <> requested_client_id or existing_status <> 'planned' then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    if p_expected_version is null then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    update public.workouts
    set
      updated_by = actor_id,
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      prep_seconds = case when p_workout ? 'prepSeconds'
        then nullif(nullif(p_workout->>'prepSeconds', '')::smallint, 0)
        else public.workouts.prep_seconds end,
      execution_mode = case when p_workout ? 'executionMode'
        then nullif(p_workout->>'executionMode', '')
        else public.workouts.execution_mode end,
      version = public.workouts.version + 1
    where id = requested_workout_id
      and public.workouts.version = p_expected_version
    returning public.workouts.version into next_version;

    if next_version is null then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;

    delete from public.workout_exercises
    where public.workout_exercises.workout_id = requested_workout_id;
  end if;

  for exercise_item in
    select value
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    custom_exercise_id_value := nullif(
      exercise_item->>'customExerciseId',
      ''
    )::uuid;

    if exercise_item->>'source' = 'custom' then
      if custom_exercise_id_value is null or not exists (
        select 1
        from public.custom_exercises custom_exercise
        where custom_exercise.id = custom_exercise_id_value
          and custom_exercise.trainer_id = root_trainer_id
          and custom_exercise.archived_at is null
      ) then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;
    elsif exercise_item->>'source' <> 'system'
      or custom_exercise_id_value is not null
    then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position,
      exercise_source, exercise_ref, custom_exercise_id, exercise_name,
      muscle_group, input_kind, block_id, block_type, block_preset,
      block_rounds, rest_between_exercises_sec, rest_between_rounds_sec,
      rest_between_sets_sec, trainer_comment, updated_by
    ) values (
      requested_workout_id,
      root_trainer_id,
      requested_client_id,
      (exercise_item->>'position')::smallint,
      exercise_item->>'source',
      exercise_item->>'ref',
      custom_exercise_id_value,
      exercise_item->>'name',
      exercise_item->>'muscleGroup',
      exercise_item->>'inputKind',
      (exercise_item->>'blockId')::uuid,
      exercise_item->>'blockType',
      exercise_item->>'blockPreset',
      (exercise_item->>'blockRounds')::smallint,
      (exercise_item->>'restBetweenExercisesSec')::smallint,
      (exercise_item->>'restBetweenRoundsSec')::smallint,
      (exercise_item->>'restBetweenSetsSec')::smallint,
      case
        when actor_role = 'client' then null
        else nullif(btrim(exercise_item->>'trainerComment'), '')
      end,
      actor_id
    )
    returning id into exercise_id;

    for set_item in
      select value
      from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
        plan_distance_km, plan_rpe, updated_by
      ) values (
        exercise_id,
        root_trainer_id,
        requested_client_id,
        (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'durationSec', '')::integer,
        nullif(set_item->>'distanceKm', '')::numeric,
        nullif(set_item->>'rpe', '')::numeric,
        actor_id
      );
    end loop;
  end loop;

  return query select requested_workout_id, next_version;
exception
  when check_violation
    or foreign_key_violation
    or unique_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$function$;

-- Подход, засчитанный таймером без участия человека, помечается до его
-- подтверждения: признак ставит черновик с timerConfirmed=true перед
-- автоподтверждением, любое последующее сохранение черновика (ручная правка
-- или «Всё верно» в конце тренировки) снимает его.
alter table public.workout_sets
  add column timer_confirmed boolean not null default false;

alter function public.save_live_set_draft(uuid, jsonb, bigint, uuid)
  rename to save_live_set_draft_without_timer_flag;
alter function public.save_live_set_draft_without_timer_flag(uuid, jsonb, bigint, uuid)
  set schema app_private;
revoke all on function app_private.save_live_set_draft_without_timer_flag(uuid, jsonb, bigint, uuid) from public, fit_api;

create function public.save_live_set_draft(
  p_set_id uuid, p_draft jsonb, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  saved_version bigint;
  was_replayed boolean;
begin
  select saved.version, saved.replayed into saved_version, was_replayed
  from app_private.save_live_set_draft_without_timer_flag(
    p_set_id, p_draft, p_expected_version, p_operation_id
  ) saved;

  if was_replayed then
    return query select saved_version, true;
    return;
  end if;

  update public.workout_sets workout_set
  set timer_confirmed = coalesce(p_draft->>'timerConfirmed' = 'true', false)
  where workout_set.id = p_set_id;
  return query select saved_version, false;
end;
$$;
revoke all on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) from public;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) to fit_api;

-- Down Migration

drop function public.save_live_set_draft(uuid, jsonb, bigint, uuid);
alter function app_private.save_live_set_draft_without_timer_flag(uuid, jsonb, bigint, uuid)
  set schema public;
alter function public.save_live_set_draft_without_timer_flag(uuid, jsonb, bigint, uuid)
  rename to save_live_set_draft;
revoke all on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) from public;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) to fit_api;
alter table public.workout_sets drop column timer_confirmed;

create or replace function app_private.save_planned_workout_without_cross_partition_snapshots(p_workout jsonb, p_expected_version bigint default null::bigint)
returns table(workout_id uuid, version bigint)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
  requested_client_id uuid := (p_workout->>'clientId')::uuid;
  requested_workout_id uuid := nullif(p_workout->>'id', '')::uuid;
  existing_client_id uuid;
  existing_status text;
  exercise_item jsonb;
  set_item jsonb;
  exercise_id uuid;
  custom_exercise_id_value uuid;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select client.trainer_id
  into root_trainer_id
  from public.clients client
  where client.id = requested_client_id
    and client.archived_at is null
    and (
      (
        actor_role = 'trainer'
        and (
          client.trainer_id = actor_id
          or exists (
            select 1
            from public.client_trainers membership
            where membership.client_id = client.id
              and membership.trainer_id = actor_id
          )
        )
      )
      or (
        actor_role = 'client'
        and client.auth_user_id = actor_id
      )
    );

  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  if requested_workout_id is null then
    if p_expected_version is not null then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    insert into public.workouts (
      trainer_id, client_id, created_by, updated_by, workout_date,
      start_time, end_time, status, notes, origin, favorite_title, prep_seconds
    ) values (
      root_trainer_id,
      requested_client_id,
      actor_id,
      actor_id,
      (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      'planned',
      nullif(btrim(p_workout->>'notes'), ''),
      case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end,
      nullif(btrim(p_workout->>'favoriteTitle'), ''),
      nullif(nullif(p_workout->>'prepSeconds', '')::smallint, 0)
    )
    returning id, public.workouts.version
    into requested_workout_id, next_version;
  else
    select
      workout.client_id,
      workout.status
    into
      existing_client_id,
      existing_status
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = requested_workout_id
      and workout.deleted_at is null
      and workout.trainer_id = root_trainer_id
      and (
        (
          actor_role = 'trainer'
          and (
            workout.created_by = actor_id
            or (workout.created_by is null and workout.trainer_id = actor_id)
          )
          and (
            client.trainer_id = actor_id
            or exists (
              select 1
              from public.client_trainers membership
              where membership.client_id = client.id
                and membership.trainer_id = actor_id
            )
          )
        )
        or (
          actor_role = 'client'
          and client.auth_user_id = actor_id
          and workout.created_by = actor_id
        )
      )
    for update of workout;

    if existing_client_id is null then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
    if existing_client_id <> requested_client_id or existing_status <> 'planned' then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    if p_expected_version is null then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    update public.workouts
    set
      updated_by = actor_id,
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      prep_seconds = case when p_workout ? 'prepSeconds'
        then nullif(nullif(p_workout->>'prepSeconds', '')::smallint, 0)
        else public.workouts.prep_seconds end,
      version = public.workouts.version + 1
    where id = requested_workout_id
      and public.workouts.version = p_expected_version
    returning public.workouts.version into next_version;

    if next_version is null then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;

    delete from public.workout_exercises
    where public.workout_exercises.workout_id = requested_workout_id;
  end if;

  for exercise_item in
    select value
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    custom_exercise_id_value := nullif(
      exercise_item->>'customExerciseId',
      ''
    )::uuid;

    if exercise_item->>'source' = 'custom' then
      if custom_exercise_id_value is null or not exists (
        select 1
        from public.custom_exercises custom_exercise
        where custom_exercise.id = custom_exercise_id_value
          and custom_exercise.trainer_id = root_trainer_id
          and custom_exercise.archived_at is null
      ) then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;
    elsif exercise_item->>'source' <> 'system'
      or custom_exercise_id_value is not null
    then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;

    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position,
      exercise_source, exercise_ref, custom_exercise_id, exercise_name,
      muscle_group, input_kind, block_id, block_type, block_preset,
      block_rounds, rest_between_exercises_sec, rest_between_rounds_sec,
      rest_between_sets_sec, trainer_comment, updated_by
    ) values (
      requested_workout_id,
      root_trainer_id,
      requested_client_id,
      (exercise_item->>'position')::smallint,
      exercise_item->>'source',
      exercise_item->>'ref',
      custom_exercise_id_value,
      exercise_item->>'name',
      exercise_item->>'muscleGroup',
      exercise_item->>'inputKind',
      (exercise_item->>'blockId')::uuid,
      exercise_item->>'blockType',
      exercise_item->>'blockPreset',
      (exercise_item->>'blockRounds')::smallint,
      (exercise_item->>'restBetweenExercisesSec')::smallint,
      (exercise_item->>'restBetweenRoundsSec')::smallint,
      (exercise_item->>'restBetweenSetsSec')::smallint,
      case
        when actor_role = 'client' then null
        else nullif(btrim(exercise_item->>'trainerComment'), '')
      end,
      actor_id
    )
    returning id into exercise_id;

    for set_item in
      select value
      from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
        plan_distance_km, plan_rpe, updated_by
      ) values (
        exercise_id,
        root_trainer_id,
        requested_client_id,
        (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'durationSec', '')::integer,
        nullif(set_item->>'distanceKm', '')::numeric,
        nullif(set_item->>'rpe', '')::numeric,
        actor_id
      );
    end loop;
  end loop;

  return query select requested_workout_id, next_version;
exception
  when check_violation
    or foreign_key_violation
    or unique_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$function$;
alter table public.workouts drop column execution_mode;
