-- Up Migration

-- Structural commands reuse the idempotency receipt introduced by the Live
-- core. Add only the UUID of a created/affected child so an exact retry can
-- return the original API result without persisting workout facts.
alter table app_private.live_workout_operations
  add column result_resource_id uuid;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_structure_result_resource check (
    result_version is null
    or action in ('start', 'save_set', 'confirm_set', 'finish')
    or result_resource_id is not null
  );

alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (
    action in (
      'start', 'save_set', 'confirm_set', 'finish',
      'append_exercise', 'append_set', 'remove_set', 'reorder_block',
      'replace_exercise', 'set_comment'
    )
  );

-- Reordering several positions in one statement must validate uniqueness at
-- statement completion, not against transient row-by-row positions.
alter table public.workout_exercises
  drop constraint workout_exercises_position_unique;
alter table public.workout_exercises
  add constraint workout_exercises_position_unique
  unique (workout_id, position) deferrable initially immediate;

alter table public.workout_sets
  drop constraint workout_sets_position_unique;
alter table public.workout_sets
  add constraint workout_sets_position_unique
  unique (workout_exercise_id, position) deferrable initially immediate;

create or replace function app_private.claim_live_workout_operation(
  p_action text,
  p_resource_id uuid,
  p_operation_id uuid,
  p_request_sha256 text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  stored_action text;
  stored_resource_id uuid;
  stored_request_sha256 text;
  stored_result bigint;
begin
  if current_actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_operation_id is null
    or p_resource_id is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_action not in (
      'start', 'save_set', 'confirm_set', 'finish',
      'append_exercise', 'append_set', 'remove_set', 'reorder_block',
      'replace_exercise', 'set_comment'
    )
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  delete from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.created_at < now() - interval '30 days';

  insert into app_private.live_workout_operations (
    actor_id, operation_id, action, resource_id, request_sha256
  ) values (
    current_actor_id, p_operation_id, p_action, p_resource_id, p_request_sha256
  )
  on conflict (actor_id, operation_id) do nothing;

  select
    operation.action,
    operation.resource_id,
    operation.request_sha256,
    operation.result_version
  into
    stored_action,
    stored_resource_id,
    stored_request_sha256,
    stored_result
  from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.operation_id = p_operation_id
  for update;

  if stored_action is distinct from p_action
    or stored_resource_id is distinct from p_resource_id
    or stored_request_sha256 is distinct from p_request_sha256
  then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;

  return stored_result;
end;
$$;

create or replace function app_private.complete_live_workout_operation(
  p_operation_id uuid,
  p_result_version bigint,
  p_result_resource_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.live_workout_operations operation
  set
    result_version = p_result_version,
    result_resource_id = p_result_resource_id
  where operation.actor_id = auth.uid()
    and operation.operation_id = p_operation_id
    and operation.result_version is null;

  if not found then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;
end;
$$;

revoke all on function app_private.complete_live_workout_operation(
  uuid, bigint, uuid
) from public, fit_api;

create or replace function app_private.authorize_live_exercise_comment(
  p_workout_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
begin
  root_trainer_id := app_private.authorize_live_workout(p_workout_id);
  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = current_actor_id;

  if actor_role = 'client' and not exists (
    select 1
    from public.workouts workout
    where workout.id = p_workout_id
      and workout.created_by = current_actor_id
  ) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

revoke all on function app_private.authorize_live_exercise_comment(uuid)
  from public, fit_api;

create or replace function public.append_live_exercise(
  p_workout_id uuid,
  p_exercise jsonb,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  root_trainer_id uuid;
  client_id_value uuid;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
  next_position smallint;
  inserted_id uuid;
  replayed_id uuid;
  replayed_version bigint;
  next_version bigint;
begin
  root_trainer_id := app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'append_exercise',
    p_workout_id,
    p_operation_id,
    encode(sha256(convert_to(
      p_expected_version::text || ':' || p_exercise::text,
      'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    select operation.result_resource_id
    into replayed_id
    from app_private.live_workout_operations operation
    where operation.actor_id = current_actor_id
      and operation.operation_id = p_operation_id;
    return query select replayed_id, replayed_version, true;
    return;
  end if;

  if source_value = 'custom' then
    select custom.id::text, custom.id, custom.name,
      custom.muscle_group, custom.input_kind
    into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises custom
    where custom.id = custom_id
      and custom.trainer_id = root_trainer_id
      and custom.archived_at is null;
    if not found then
      raise exception 'exercise_not_found' using errcode = 'PT404';
    end if;
  elsif source_value <> 'system'
    or custom_id is not null
    or nullif(btrim(ref_value), '') is null
    or nullif(btrim(name_value), '') is null
    or length(ref_value) > 300
    or length(name_value) > 300
    or group_value not in (
      'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
      'cardio', 'other'
    )
    or kind_value not in ('strength', 'distance', 'reps', 'duration')
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    updated_by = current_actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.client_id, workout.version
  into client_id_value, next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select coalesce(max(exercise.position) + 1, 0)::smallint
  into next_position
  from public.workout_exercises exercise
  where exercise.workout_id = p_workout_id;

  insert into public.workout_exercises (
    workout_id, trainer_id, client_id, position, exercise_source,
    exercise_ref, custom_exercise_id, exercise_name, muscle_group, input_kind,
    block_id, block_type, block_preset, block_rounds,
    rest_between_exercises_sec, rest_between_rounds_sec,
    rest_between_sets_sec, updated_by
  ) values (
    p_workout_id, root_trainer_id, client_id_value, next_position, source_value,
    ref_value, custom_id, name_value, group_value, kind_value,
    gen_random_uuid(), 'single', 'set', 1, 0, 90, 90, current_actor_id
  ) returning id into inserted_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position, updated_by
  ) values (
    inserted_id, root_trainer_id, client_id_value, 0, current_actor_id
  );

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, inserted_id
  );
  return query select inserted_id, next_version, false;
exception
  when check_violation
    or foreign_key_violation
    or invalid_text_representation
    or numeric_value_out_of_range
    or unique_violation
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.append_live_set(
  p_workout_exercise_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  root_trainer_id uuid;
  workout_id_value uuid;
  client_id_value uuid;
  next_position smallint;
  inserted_id uuid;
  replayed_id uuid;
  replayed_version bigint;
  next_version bigint;
begin
  select exercise.workout_id, exercise.client_id
  into workout_id_value, client_id_value
  from public.workout_exercises exercise
  where exercise.id = p_workout_exercise_id;
  root_trainer_id := app_private.authorize_live_workout(workout_id_value);
  replayed_version := app_private.claim_live_workout_operation(
    'append_set',
    p_workout_exercise_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    select operation.result_resource_id
    into replayed_id
    from app_private.live_workout_operations operation
    where operation.actor_id = current_actor_id
      and operation.operation_id = p_operation_id;
    return query select replayed_id, replayed_version, true;
    return;
  end if;

  update public.workouts workout
  set
    updated_by = current_actor_id,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select coalesce(max(workout_set.position) + 1, 0)::smallint
  into next_position
  from public.workout_sets workout_set
  where workout_set.workout_exercise_id = p_workout_exercise_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position,
    plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
    plan_distance_km, plan_rpe, updated_by
  )
  select
    p_workout_exercise_id, root_trainer_id, client_id_value, next_position,
    coalesce(previous.fact_weight_kg, previous.plan_weight_kg),
    coalesce(previous.fact_reps, previous.plan_reps),
    coalesce(previous.fact_duration_min, previous.plan_duration_min),
    coalesce(
      previous.fact_duration_sec,
      previous.plan_duration_sec,
      round(previous.fact_duration_min * 60)::integer,
      round(previous.plan_duration_min * 60)::integer
    ),
    coalesce(previous.fact_distance_km, previous.plan_distance_km),
    coalesce(previous.fact_rpe, previous.plan_rpe),
    current_actor_id
  from (select 1) placeholder
  left join lateral (
    select workout_set.*
    from public.workout_sets workout_set
    where workout_set.workout_exercise_id = p_workout_exercise_id
    order by workout_set.position desc, workout_set.id
    limit 1
  ) previous on true
  returning id into inserted_id;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, inserted_id
  );
  return query select inserted_id, next_version, false;
exception
  when check_violation
    or foreign_key_violation
    or numeric_value_out_of_range
    or unique_violation
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.remove_live_set(
  p_set_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  exercise_id_value uuid;
  remaining_count integer;
  replayed_version bigint;
  next_version bigint;
begin
  replayed_version := app_private.claim_live_workout_operation(
    'remove_set',
    p_set_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_set_id, replayed_version, true;
    return;
  end if;

  select exercise.workout_id, workout_set.workout_exercise_id
  into workout_id_value, exercise_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  perform app_private.authorize_live_workout(workout_id_value);

  update public.workouts workout
  set
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select count(*)::integer
  into remaining_count
  from public.workout_sets workout_set
  where workout_set.workout_exercise_id = exercise_id_value;
  if remaining_count <= 1 then
    raise exception 'last_set_cannot_be_removed' using errcode = 'PT422';
  end if;

  delete from public.workout_sets workout_set
  where workout_set.id = p_set_id;
  if not found then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  set constraints all deferred;
  with ordered_sets as (
    select
      workout_set.id,
      (row_number() over (
        order by workout_set.position, workout_set.id
      ) - 1)::smallint as new_position
    from public.workout_sets workout_set
    where workout_set.workout_exercise_id = exercise_id_value
  )
  update public.workout_sets workout_set
  set
    position = ordered.new_position,
    updated_by = actor_id
  from ordered_sets ordered
  where workout_set.id = ordered.id
    and workout_set.position <> ordered.new_position;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, p_set_id
  );
  return query select p_set_id, next_version, false;
end;
$$;

create or replace function public.reorder_live_block(
  p_workout_id uuid,
  p_block_id uuid,
  p_direction smallint,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_order integer;
  neighbour_order integer;
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  if p_direction not in (-1, 1) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'reorder_block',
    p_block_id,
    p_operation_id,
    encode(sha256(convert_to(
      p_expected_version::text || ':' || p_direction::text,
      'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    return query select p_block_id, replayed_version, true;
    return;
  end if;

  update public.workouts workout
  set
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select blocks.block_order
  into target_order
  from (
    select
      exercise.block_id,
      row_number() over (
        order by min(exercise.position), exercise.block_id
      )::integer as block_order
    from public.workout_exercises exercise
    where exercise.workout_id = p_workout_id
    group by exercise.block_id
  ) blocks
  where blocks.block_id = p_block_id;
  if target_order is null then
    raise exception 'block_not_found' using errcode = 'PT404';
  end if;
  neighbour_order := target_order + p_direction;

  if not exists (
    select 1
    from (
      select row_number() over (
        order by min(exercise.position), exercise.block_id
      )::integer as block_order
      from public.workout_exercises exercise
      where exercise.workout_id = p_workout_id
      group by exercise.block_id
    ) blocks
    where blocks.block_order = neighbour_order
  ) then
    perform app_private.complete_live_workout_operation(
      p_operation_id, next_version, p_block_id
    );
    return query select p_block_id, next_version, false;
    return;
  end if;

  set constraints all deferred;
  with block_orders as (
    select
      exercise.block_id,
      row_number() over (
        order by min(exercise.position), exercise.block_id
      )::integer as block_order
    from public.workout_exercises exercise
    where exercise.workout_id = p_workout_id
    group by exercise.block_id
  ), swapped_blocks as (
    select
      block.block_id,
      case
        when block.block_order = target_order then neighbour_order
        when block.block_order = neighbour_order then target_order
        else block.block_order
      end as new_block_order
    from block_orders block
  ), ordered_exercises as (
    select
      exercise.id,
      (row_number() over (
        order by swapped.new_block_order, exercise.position, exercise.id
      ) - 1)::smallint as new_position
    from public.workout_exercises exercise
    join swapped_blocks swapped on swapped.block_id = exercise.block_id
    where exercise.workout_id = p_workout_id
  )
  update public.workout_exercises exercise
  set
    position = ordered.new_position,
    updated_by = actor_id
  from ordered_exercises ordered
  where exercise.id = ordered.id
    and exercise.position <> ordered.new_position;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, p_block_id
  );
  return query select p_block_id, next_version, false;
end;
$$;

create or replace function public.replace_live_exercise(
  p_workout_id uuid,
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  root_trainer_id uuid;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
  old_kind text;
  replayed_version bigint;
  next_version bigint;
begin
  root_trainer_id := app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'replace_exercise',
    p_exercise_id,
    p_operation_id,
    encode(sha256(convert_to(
      p_expected_version::text || ':' || p_exercise::text,
      'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    return query select p_exercise_id, replayed_version, true;
    return;
  end if;

  if source_value = 'custom' then
    select custom.id::text, custom.id, custom.name,
      custom.muscle_group, custom.input_kind
    into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises custom
    where custom.id = custom_id
      and custom.trainer_id = root_trainer_id
      and custom.archived_at is null;
    if not found then
      raise exception 'exercise_not_found' using errcode = 'PT404';
    end if;
  elsif source_value <> 'system'
    or custom_id is not null
    or nullif(btrim(ref_value), '') is null
    or nullif(btrim(name_value), '') is null
    or length(ref_value) > 300
    or length(name_value) > 300
    or group_value not in (
      'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
      'cardio', 'other'
    )
    or kind_value not in ('strength', 'distance', 'reps', 'duration')
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select exercise.input_kind
  into old_kind
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id
    and exercise.workout_id = p_workout_id;
  if old_kind is null then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;
  if exists (
    select 1
    from public.workout_sets workout_set
    where workout_set.workout_exercise_id = p_exercise_id
      and workout_set.confirmed_at is not null
  ) then
    raise exception 'exercise_already_started' using errcode = 'PT409';
  end if;

  update public.workout_exercises exercise
  set
    exercise_source = source_value,
    exercise_ref = ref_value,
    custom_exercise_id = custom_id,
    exercise_name = name_value,
    muscle_group = group_value,
    input_kind = kind_value,
    updated_by = actor_id
  where exercise.id = p_exercise_id;

  if old_kind is distinct from kind_value then
    update public.workout_sets workout_set
    set
      plan_weight_kg = null,
      plan_reps = null,
      plan_duration_min = null,
      plan_duration_sec = null,
      plan_distance_km = null,
      plan_rpe = null,
      fact_weight_kg = null,
      fact_reps = null,
      fact_duration_min = null,
      fact_duration_sec = null,
      fact_distance_km = null,
      fact_rpe = null,
      updated_by = actor_id
    where workout_set.workout_exercise_id = p_exercise_id;
  end if;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, p_exercise_id
  );
  return query select p_exercise_id, next_version, false;
exception
  when check_violation
    or foreign_key_violation
    or invalid_text_representation
    or numeric_value_out_of_range
    or unique_violation
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.set_live_exercise_comment(
  p_exercise_id uuid,
  p_comment text,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  normalized_comment text := nullif(btrim(p_comment), '');
  replayed_version bigint;
  next_version bigint;
begin
  if length(coalesce(normalized_comment, '')) > 5000 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  select exercise.workout_id
  into workout_id_value
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id;
  perform app_private.authorize_live_exercise_comment(workout_id_value);
  replayed_version := app_private.claim_live_workout_operation(
    'set_comment',
    p_exercise_id,
    p_operation_id,
    encode(sha256(convert_to(
      p_expected_version::text || ':' || coalesce(normalized_comment, ''),
      'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    return query select p_exercise_id, replayed_version, true;
    return;
  end if;

  update public.workouts workout
  set
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workout_exercises exercise
  set
    trainer_comment = normalized_comment,
    updated_by = actor_id
  where exercise.id = p_exercise_id;
  if not found then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, p_exercise_id
  );
  return query select p_exercise_id, next_version, false;
end;
$$;

revoke all on function public.append_live_exercise(
  uuid, jsonb, bigint, uuid
) from public;
revoke all on function public.append_live_set(uuid, bigint, uuid) from public;
revoke all on function public.remove_live_set(uuid, bigint, uuid) from public;
revoke all on function public.reorder_live_block(
  uuid, uuid, smallint, bigint, uuid
) from public;
revoke all on function public.replace_live_exercise(
  uuid, uuid, jsonb, bigint, uuid
) from public;
revoke all on function public.set_live_exercise_comment(
  uuid, text, bigint, uuid
) from public;

grant execute on function public.append_live_exercise(
  uuid, jsonb, bigint, uuid
) to fit_api;
grant execute on function public.append_live_set(uuid, bigint, uuid)
  to fit_api;
grant execute on function public.remove_live_set(uuid, bigint, uuid)
  to fit_api;
grant execute on function public.reorder_live_block(
  uuid, uuid, smallint, bigint, uuid
) to fit_api;
grant execute on function public.replace_live_exercise(
  uuid, uuid, jsonb, bigint, uuid
) to fit_api;
grant execute on function public.set_live_exercise_comment(
  uuid, text, bigint, uuid
) to fit_api;

-- Down Migration

revoke execute on function public.set_live_exercise_comment(
  uuid, text, bigint, uuid
) from fit_api;
revoke execute on function public.replace_live_exercise(
  uuid, uuid, jsonb, bigint, uuid
) from fit_api;
revoke execute on function public.reorder_live_block(
  uuid, uuid, smallint, bigint, uuid
) from fit_api;
revoke execute on function public.remove_live_set(uuid, bigint, uuid)
  from fit_api;
revoke execute on function public.append_live_set(uuid, bigint, uuid)
  from fit_api;
revoke execute on function public.append_live_exercise(
  uuid, jsonb, bigint, uuid
) from fit_api;
drop function public.set_live_exercise_comment(uuid, text, bigint, uuid);
drop function public.replace_live_exercise(uuid, uuid, jsonb, bigint, uuid);
drop function public.reorder_live_block(uuid, uuid, smallint, bigint, uuid);
drop function public.remove_live_set(uuid, bigint, uuid);
drop function public.append_live_set(uuid, bigint, uuid);
drop function public.append_live_exercise(uuid, jsonb, bigint, uuid);
drop function app_private.authorize_live_exercise_comment(uuid);
drop function app_private.complete_live_workout_operation(uuid, bigint, uuid);

alter table public.workout_sets
  drop constraint workout_sets_position_unique;
alter table public.workout_sets
  add constraint workout_sets_position_unique
  unique (workout_exercise_id, position);
alter table public.workout_exercises
  drop constraint workout_exercises_position_unique;
alter table public.workout_exercises
  add constraint workout_exercises_position_unique
  unique (workout_id, position);

alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (
    action in ('start', 'save_set', 'confirm_set', 'finish')
  );
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_structure_result_resource;
alter table app_private.live_workout_operations
  drop column result_resource_id;

create or replace function app_private.claim_live_workout_operation(
  p_action text,
  p_resource_id uuid,
  p_operation_id uuid,
  p_request_sha256 text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  stored_action text;
  stored_resource_id uuid;
  stored_request_sha256 text;
  stored_result bigint;
begin
  if current_actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_operation_id is null
    or p_resource_id is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_action not in ('start', 'save_set', 'confirm_set', 'finish')
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  delete from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.created_at < now() - interval '30 days';

  insert into app_private.live_workout_operations (
    actor_id, operation_id, action, resource_id, request_sha256
  ) values (
    current_actor_id, p_operation_id, p_action, p_resource_id, p_request_sha256
  )
  on conflict (actor_id, operation_id) do nothing;

  select
    operation.action,
    operation.resource_id,
    operation.request_sha256,
    operation.result_version
  into
    stored_action,
    stored_resource_id,
    stored_request_sha256,
    stored_result
  from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.operation_id = p_operation_id
  for update;

  if stored_action is distinct from p_action
    or stored_resource_id is distinct from p_resource_id
    or stored_request_sha256 is distinct from p_request_sha256
  then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;

  return stored_result;
end;
$$;
