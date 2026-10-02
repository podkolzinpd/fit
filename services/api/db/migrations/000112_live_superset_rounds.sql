-- Up Migration
-- A round is one set at the same position for every exercise in the group.
-- Existing sparse/uneven groups are left unchanged; a new round follows the
-- highest existing position and is inserted in one transaction.
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (action in (
    'start', 'save_set', 'confirm_set', 'finish', 'append_exercise', 'append_set',
    'remove_set', 'reorder_block', 'replace_exercise', 'set_comment',
    'remove_exercise', 'merge_block', 'append_round', 'remove_round'
  ));

create or replace function app_private.claim_live_workout_operation(
  p_action text, p_resource_id uuid, p_operation_id uuid, p_request_sha256 text
)
returns bigint language plpgsql security definer set search_path = '' as $$
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
  if p_operation_id is null or p_resource_id is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_action not in ('start','save_set','confirm_set','finish','append_exercise',
      'append_set','remove_set','reorder_block','replace_exercise','set_comment',
      'remove_exercise','merge_block','append_round','remove_round') then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  delete from app_private.live_workout_operations operation
    where operation.actor_id = current_actor_id and operation.created_at < now() - interval '30 days';
  insert into app_private.live_workout_operations(actor_id,operation_id,action,resource_id,request_sha256)
    values(current_actor_id,p_operation_id,p_action,p_resource_id,p_request_sha256)
    on conflict(actor_id,operation_id) do nothing;
  select operation.action,operation.resource_id,operation.request_sha256,operation.result_version
    into stored_action,stored_resource_id,stored_request_sha256,stored_result
    from app_private.live_workout_operations operation
    where operation.actor_id=current_actor_id and operation.operation_id=p_operation_id for update;
  if stored_action is distinct from p_action or stored_resource_id is distinct from p_resource_id
    or stored_request_sha256 is distinct from p_request_sha256 then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;
  return stored_result;
end;
$$;

create function public.append_live_round(
  p_workout_id uuid, p_block_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  root_trainer_id uuid;
  replayed_version bigint;
  next_version bigint;
  next_position integer;
  member_count integer;
  exercise_row record;
begin
  root_trainer_id := app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'append_round', p_block_id, p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_block_id, replayed_version, true;
    return;
  end if;

  update public.workouts workout set updated_by = auth.uid(), version = workout.version + 1
    where workout.id = p_workout_id and workout.status = 'in_progress'
      and workout.deleted_at is null and workout.version = p_expected_version
    returning workout.version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;

  select count(distinct exercise.id)::integer, coalesce(max(workout_set.position), -1) + 1
    into member_count, next_position
    from public.workout_exercises exercise
    left join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
    where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
      and exercise.block_type = 'group' and exercise.block_preset = 'set';
  if member_count < 2 or next_position < 1 or next_position > 19
    or exists (
      select 1 from public.workout_exercises exercise
      where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
        and (exercise.block_type <> 'group' or exercise.block_preset <> 'set')
    ) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  for exercise_row in
    select exercise.id, exercise.client_id
    from public.workout_exercises exercise
    where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
    order by exercise.position, exercise.id
  loop
    insert into public.workout_sets (
      workout_exercise_id, trainer_id, client_id, position,
      plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
      plan_distance_km, plan_rpe, updated_by
    )
    select exercise_row.id, root_trainer_id, exercise_row.client_id,
      next_position::smallint,
      coalesce(previous.fact_weight_kg, previous.plan_weight_kg),
      coalesce(previous.fact_reps, previous.plan_reps),
      coalesce(previous.fact_duration_min, previous.plan_duration_min),
      coalesce(previous.fact_duration_sec, previous.plan_duration_sec,
        round(previous.fact_duration_min * 60)::integer,
        round(previous.plan_duration_min * 60)::integer),
      coalesce(previous.fact_distance_km, previous.plan_distance_km),
      coalesce(previous.fact_rpe, previous.plan_rpe), auth.uid()
    from (select 1) placeholder
    left join lateral (
      select workout_set.* from public.workout_sets workout_set
      where workout_set.workout_exercise_id = exercise_row.id
      order by workout_set.position desc, workout_set.id limit 1
    ) previous on true;
  end loop;

  update public.workout_exercises exercise
    set block_rounds = greatest(exercise.block_rounds, next_position + 1)::smallint,
      updated_by = auth.uid()
    where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_block_id);
  return query select p_block_id, next_version, false;
exception
  when check_violation or foreign_key_violation or numeric_value_out_of_range or unique_violation
  then raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;
revoke all on function public.append_live_round(uuid,uuid,bigint,uuid) from public;
grant execute on function public.append_live_round(uuid,uuid,bigint,uuid) to fit_api;

create function public.remove_last_live_round(
  p_workout_id uuid, p_block_id uuid, p_position smallint,
  p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  replayed_version bigint;
  next_version bigint;
  member_count integer;
  matching_count integer;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'remove_round', p_block_id, p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_position::text || ':' || p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_block_id, replayed_version, true;
    return;
  end if;

  update public.workouts workout set updated_by = auth.uid(), version = workout.version + 1
    where workout.id = p_workout_id and workout.status = 'in_progress'
      and workout.deleted_at is null and workout.version = p_expected_version
    returning workout.version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;

  select count(distinct exercise.id)::integer, count(workout_set.id)::integer
    into member_count, matching_count
    from public.workout_exercises exercise
    left join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id and workout_set.position = p_position
    where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
      and exercise.block_type = 'group' and exercise.block_preset = 'set';
  if member_count < 2 or matching_count <> member_count or p_position <= 0
    or exists (
      select 1 from public.workout_exercises exercise
      where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
        and (exercise.block_type <> 'group' or exercise.block_preset <> 'set')
    )
    or exists (
      select 1 from public.workout_exercises exercise
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
        and workout_set.position > p_position
    )
    or exists (
      select 1 from public.workout_exercises exercise
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
        and workout_set.position = p_position
        and (workout_set.confirmed_at is not null
          or workout_set.fact_weight_kg is not null or workout_set.fact_reps is not null
          or workout_set.fact_duration_min is not null or workout_set.fact_duration_sec is not null
          or workout_set.fact_distance_km is not null or workout_set.fact_rpe is not null)
    )
    or exists (
      select 1 from public.workout_exercises exercise
      where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
        and not exists (
          select 1 from public.workout_sets workout_set
          where workout_set.workout_exercise_id = exercise.id and workout_set.position < p_position
        )
    ) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  delete from public.workout_sets workout_set
    using public.workout_exercises exercise
    where workout_set.workout_exercise_id = exercise.id
      and exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
      and workout_set.position = p_position;
  update public.workout_exercises exercise
    set block_rounds = case when exercise.block_rounds = p_position + 1
      then greatest(1, p_position)::smallint else exercise.block_rounds end,
      updated_by = auth.uid()
    where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_block_id);
  return query select p_block_id, next_version, false;
exception
  when check_violation or foreign_key_violation or numeric_value_out_of_range or unique_violation
  then raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;
revoke all on function public.remove_last_live_round(uuid,uuid,smallint,bigint,uuid) from public;
grant execute on function public.remove_last_live_round(uuid,uuid,smallint,bigint,uuid) to fit_api;

-- Down Migration
-- Forward only: committed operation receipts and user results remain readable.
