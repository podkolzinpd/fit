-- Up Migration
-- A Live grouping changes only unfinished exercises. Confirmed facts are never
-- reinterpreted as a different round or moved to another block.
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (action in (
    'start', 'save_set', 'confirm_set', 'finish', 'append_exercise', 'append_set',
    'remove_set', 'reorder_block', 'replace_exercise', 'set_comment',
    'remove_exercise', 'merge_block'
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
      'remove_exercise','merge_block') then
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

create function public.merge_live_block_with_next(
  p_workout_id uuid, p_block_id uuid, p_preset text,
  p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  next_block_id uuid;
  next_version bigint;
  replayed_version bigint;
  round_count integer;
  target_position integer;
  next_position integer;
  target_size integer;
  next_size integer;
  existing_exercise_rest smallint;
  existing_round_rest smallint;
  exercise_row record;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  if p_preset not in ('set', 'circuit') then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'merge_block', p_block_id, p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_expected_version::text || ':' || p_preset, 'UTF8')), 'hex')
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

  with ordered_blocks as (
    select exercise.block_id, min(exercise.position) as first_position,
      count(*)::integer as exercise_count,
      lead(exercise.block_id) over (order by min(exercise.position), exercise.block_id) as following_id
    from public.workout_exercises exercise
    where exercise.workout_id = p_workout_id
    group by exercise.block_id
  )
  select block.first_position, block.exercise_count, following.block_id,
    following.first_position, following.exercise_count
  into target_position, target_size, next_block_id, next_position, next_size
  from ordered_blocks block
  left join ordered_blocks following on following.block_id = block.following_id
  where block.block_id = p_block_id;
  if target_position is null or next_block_id is null
    or next_position <> target_position + target_size
    or next_size <> 1 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    where exercise.workout_id = p_workout_id
      and exercise.block_id in (p_block_id, next_block_id)
      and workout_set.confirmed_at is not null
  ) then raise exception 'workout_invalid' using errcode = 'PT422'; end if;

  select exercise.rest_between_exercises_sec, exercise.rest_between_rounds_sec
  into existing_exercise_rest, existing_round_rest
  from public.workout_exercises exercise
  where exercise.workout_id = p_workout_id and exercise.block_id = p_block_id
  order by exercise.position limit 1;

  select max(set_count)::integer into round_count from (
    select count(workout_set.id) as set_count
    from public.workout_exercises exercise
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
    where exercise.workout_id = p_workout_id
      and exercise.block_id in (p_block_id, next_block_id)
    group by exercise.id
  ) counts;
  if round_count is null or round_count < 1 or round_count > 20 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  -- Synchronise rounds without dropping or rewriting any existing set.
  for exercise_row in
    select exercise.id, exercise.trainer_id, exercise.client_id,
      count(workout_set.id)::integer as existing_sets
    from public.workout_exercises exercise
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
    where exercise.workout_id = p_workout_id
      and exercise.block_id in (p_block_id, next_block_id)
    group by exercise.id
  loop
    insert into public.workout_sets (
      workout_exercise_id, trainer_id, client_id, position,
      plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
      plan_distance_km, plan_rpe, updated_by
    )
    select exercise_row.id, exercise_row.trainer_id, exercise_row.client_id,
      series.position::smallint, prior.plan_weight_kg, prior.plan_reps,
      prior.plan_duration_min, prior.plan_duration_sec, prior.plan_distance_km,
      prior.plan_rpe, auth.uid()
    from (
      select workout_set.plan_weight_kg, workout_set.plan_reps,
        workout_set.plan_duration_min, workout_set.plan_duration_sec,
        workout_set.plan_distance_km, workout_set.plan_rpe
      from public.workout_sets workout_set
      where workout_set.workout_exercise_id = exercise_row.id
      order by workout_set.position desc
      limit 1
    ) prior
    cross join generate_series(exercise_row.existing_sets, round_count - 1) as series(position)
    ;
  end loop;

  update public.workout_exercises exercise
  set block_id = p_block_id, block_type = 'group', block_preset = p_preset,
    block_rounds = round_count::smallint,
    rest_between_exercises_sec = case when target_size > 1 then existing_exercise_rest
      when p_preset = 'set' then 0 else 15 end,
    rest_between_rounds_sec = case when target_size > 1 then existing_round_rest
      when p_preset = 'set' then 90 else 60 end,
    updated_by = auth.uid()
  where exercise.workout_id = p_workout_id
    and exercise.block_id in (p_block_id, next_block_id);

  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_block_id);
  return query select p_block_id, next_version, false;
end;
$$;
revoke all on function public.merge_live_block_with_next(uuid,uuid,text,bigint,uuid) from public;
grant execute on function public.merge_live_block_with_next(uuid,uuid,text,bigint,uuid) to fit_api;

-- Down Migration
-- Forward-only: existing grouped workouts and operation receipts must remain valid.
