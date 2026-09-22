-- Up Migration

-- Mirrors supabase/migrations/20260922130000_workout_origin_status.sql.
-- Third client-authored workout status: origin distinguishes a workout the
-- client typed themselves from one an assistant-generated program created.
-- Written once at creation (only in the insert branch below), never updated
-- - no "AI, but edited" intermediate state by design. The trainer-authored
-- branch never reads this column at all.
alter table public.workouts
  add column origin text not null default 'manual'
    check (origin in ('manual', 'ai'));

-- Backfill: workouts already created by an applied create_program_draft/
-- schedule_program assistant action are retroactively AI-authored. Anything
-- else (including record_workout - the client dictating an already-done
-- workout, not an AI-authored plan) stays at the 'manual' default.
update public.workouts workout
set origin = 'ai'
from public.assistant_actions action,
  jsonb_array_elements_text(action.result->'workoutIds') as workout_id
where action.status = 'applied'
  and action.tool in ('create_program_draft', 'schedule_program')
  and workout.id = workout_id::uuid;

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
      start_time, end_time, status, notes, origin
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
      case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end
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

create or replace function public.apply_assistant_action(p_action_id uuid, p_input jsonb default '{}'::jsonb, p_expected_version bigint default 1)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id uuid := app_private.require_assistant_trainer();
  actor_role text;
  actor_client_id uuid;
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
begin
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'client' then
    select id into actor_client_id
    from public.clients
    where auth_user_id = actor_id and archived_at is null
    limit 1;
    if actor_client_id is null then
      raise exception 'assistant_client_card_required' using errcode = 'PT403';
    end if;
  end if;

  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if actor_role = 'client' and (
    action_row.tool not in ('record_workout', 'create_program_draft', 'schedule_program')
    or nullif(action_row.payload->>'clientId', '')::uuid is distinct from actor_client_id
    or (
      action_row.tool in ('create_program_draft', 'schedule_program')
      and action_row.payload->>'schemaVersion' is distinct from 'program-v1'
    )
  ) then
    raise exception 'assistant_action_forbidden' using errcode = 'PT403';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'))
      || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed')
    or action_row.version <> p_expected_version
  then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  update public.assistant_actions set status = 'applying', error_code = null
  where id = action_row.id;

  begin
    if action_row.tool = 'record_workout' then
      workout_item := p_input->'workout';
      if jsonb_typeof(workout_item) <> 'object'
        or jsonb_typeof(workout_item->'exercises') <> 'array'
        or jsonb_array_length(workout_item->'exercises') < 1
        or nullif(workout_item->>'requestId', '') is null
        or (workout_item->>'clientId')::uuid
          <> (action_row.payload->>'clientId')::uuid
      then
        raise exception 'assistant_workout_invalid' using errcode = 'PT422';
      end if;
      -- No 'ai' origin here: the client is dictating a workout they already
      -- did, not applying an AI-authored plan (see design doc part 1).
      select saved.workout_id into workout_id
      from public.save_completed_workout(workout_item, null) saved;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutId', workout_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutId', workout_id,
        'version', action_row.version + 1
      );
    elsif action_row.tool in ('create_program_draft', 'schedule_program') then
      if jsonb_typeof(p_input->'workouts') is distinct from 'array'
        or jsonb_array_length(p_input->'workouts') not between 1 and 12
      then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;
      if action_row.payload->>'schemaVersion' = 'program-v1' then
        perform 1 from public.clients where id = (action_row.payload->>'clientId')::uuid for update;
        if jsonb_array_length(p_input->'workouts') not in (4, 8, 12)
          or p_input->'workouts' is distinct from action_row.payload->'canonicalWorkouts'
          or nullif(action_row.payload->>'sourceCapturedAt', '') is null
          or (action_row.payload->>'sourceCapturedAt')::timestamptz < now() - interval '24 hours'
        then
          raise exception 'assistant_program_requires_validation' using errcode = 'PT422';
        end if;
        if exists (select 1 from public.workouts workout
          where workout.client_id = (action_row.payload->>'clientId')::uuid
            and workout.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
          or exists (select 1 from public.clients client
            where client.id = (action_row.payload->>'clientId')::uuid
              and client.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
        then
          raise exception 'assistant_program_source_changed' using errcode = 'PT409';
        end if;
      elsif jsonb_array_length(p_input->'workouts') > 4 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      for workout_item in select value from jsonb_array_elements(p_input->'workouts')
      loop
        if jsonb_typeof(workout_item) <> 'object'
          or jsonb_typeof(workout_item->'exercises') <> 'array'
          or jsonb_array_length(workout_item->'exercises') < 1
          or nullif(workout_item->>'requestId', '') is null
          or (workout_item->>'clientId')::uuid
            <> (action_row.payload->>'clientId')::uuid
        then
          raise exception 'assistant_program_invalid' using errcode = 'PT422';
        end if;
        -- The assistant authored this workout as part of a generated
        -- program - the one place origin='ai' is legitimate.
        select saved.workout_id into workout_id
        from public.save_planned_workout(workout_item || jsonb_build_object('origin', 'ai'), null) saved;
        workout_ids := workout_ids || jsonb_build_array(workout_id);
      end loop;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutIds', workout_ids),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutIds', workout_ids,
        'version', action_row.version + 1
      );
    elsif action_row.tool = 'create_client_draft' then
      if jsonb_typeof(p_input) <> 'object'
        or nullif(btrim(p_input->>'fullName'), '') is null
      then
        raise exception 'assistant_client_invalid' using errcode = 'PT422';
      end if;
      select created.client_id into created_id
      from public.create_client_card(p_input) created;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'clientId', created_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'clientId', created_id,
        'version', action_row.version + 1
      );
    else
      raise exception 'assistant_action_external_only' using errcode = 'PT422';
    end if;
  exception when others then
    update public.assistant_actions set
      status = 'failed', error_code = 'assistant_action_failed'
    where id = action_row.id;
    return jsonb_build_object(
      'status', 'failed', 'errorCode', 'assistant_action_failed',
      'version', action_row.version
    );
  end;
end;
$function$;

-- Down Migration

create or replace function public.apply_assistant_action(p_action_id uuid, p_input jsonb default '{}'::jsonb, p_expected_version bigint default 1)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id uuid := app_private.require_assistant_trainer();
  actor_role text;
  actor_client_id uuid;
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
begin
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'client' then
    select id into actor_client_id
    from public.clients
    where auth_user_id = actor_id and archived_at is null
    limit 1;
    if actor_client_id is null then
      raise exception 'assistant_client_card_required' using errcode = 'PT403';
    end if;
  end if;

  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if actor_role = 'client' and (
    action_row.tool not in ('record_workout', 'create_program_draft', 'schedule_program')
    or nullif(action_row.payload->>'clientId', '')::uuid is distinct from actor_client_id
    or (
      action_row.tool in ('create_program_draft', 'schedule_program')
      and action_row.payload->>'schemaVersion' is distinct from 'program-v1'
    )
  ) then
    raise exception 'assistant_action_forbidden' using errcode = 'PT403';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'))
      || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed')
    or action_row.version <> p_expected_version
  then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  update public.assistant_actions set status = 'applying', error_code = null
  where id = action_row.id;

  begin
    if action_row.tool = 'record_workout' then
      workout_item := p_input->'workout';
      if jsonb_typeof(workout_item) <> 'object'
        or jsonb_typeof(workout_item->'exercises') <> 'array'
        or jsonb_array_length(workout_item->'exercises') < 1
        or nullif(workout_item->>'requestId', '') is null
        or (workout_item->>'clientId')::uuid
          <> (action_row.payload->>'clientId')::uuid
      then
        raise exception 'assistant_workout_invalid' using errcode = 'PT422';
      end if;
      select saved.workout_id into workout_id
      from public.save_completed_workout(workout_item, null) saved;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutId', workout_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutId', workout_id,
        'version', action_row.version + 1
      );
    elsif action_row.tool in ('create_program_draft', 'schedule_program') then
      if jsonb_typeof(p_input->'workouts') is distinct from 'array'
        or jsonb_array_length(p_input->'workouts') not between 1 and 12
      then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;
      if action_row.payload->>'schemaVersion' = 'program-v1' then
        perform 1 from public.clients where id = (action_row.payload->>'clientId')::uuid for update;
        if jsonb_array_length(p_input->'workouts') not in (4, 8, 12)
          or p_input->'workouts' is distinct from action_row.payload->'canonicalWorkouts'
          or nullif(action_row.payload->>'sourceCapturedAt', '') is null
          or (action_row.payload->>'sourceCapturedAt')::timestamptz < now() - interval '24 hours'
        then
          raise exception 'assistant_program_requires_validation' using errcode = 'PT422';
        end if;
        if exists (select 1 from public.workouts workout
          where workout.client_id = (action_row.payload->>'clientId')::uuid
            and workout.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
          or exists (select 1 from public.clients client
            where client.id = (action_row.payload->>'clientId')::uuid
              and client.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
        then
          raise exception 'assistant_program_source_changed' using errcode = 'PT409';
        end if;
      elsif jsonb_array_length(p_input->'workouts') > 4 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      for workout_item in select value from jsonb_array_elements(p_input->'workouts')
      loop
        if jsonb_typeof(workout_item) <> 'object'
          or jsonb_typeof(workout_item->'exercises') <> 'array'
          or jsonb_array_length(workout_item->'exercises') < 1
          or nullif(workout_item->>'requestId', '') is null
          or (workout_item->>'clientId')::uuid
            <> (action_row.payload->>'clientId')::uuid
        then
          raise exception 'assistant_program_invalid' using errcode = 'PT422';
        end if;
        select saved.workout_id into workout_id
        from public.save_planned_workout(workout_item, null) saved;
        workout_ids := workout_ids || jsonb_build_array(workout_id);
      end loop;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutIds', workout_ids),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutIds', workout_ids,
        'version', action_row.version + 1
      );
    elsif action_row.tool = 'create_client_draft' then
      if jsonb_typeof(p_input) <> 'object'
        or nullif(btrim(p_input->>'fullName'), '') is null
      then
        raise exception 'assistant_client_invalid' using errcode = 'PT422';
      end if;
      select created.client_id into created_id
      from public.create_client_card(p_input) created;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'clientId', created_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'clientId', created_id,
        'version', action_row.version + 1
      );
    else
      raise exception 'assistant_action_external_only' using errcode = 'PT422';
    end if;
  exception when others then
    update public.assistant_actions set
      status = 'failed', error_code = 'assistant_action_failed'
    where id = action_row.id;
    return jsonb_build_object(
      'status', 'failed', 'errorCode', 'assistant_action_failed',
      'version', action_row.version
    );
  end;
end;
$function$;

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
      start_time, end_time, status, notes
    ) values (
      root_trainer_id,
      requested_client_id,
      actor_id,
      actor_id,
      (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      'planned',
      nullif(btrim(p_workout->>'notes'), '')
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

alter table public.workouts drop column origin;
