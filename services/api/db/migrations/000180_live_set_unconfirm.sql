-- Up Migration
-- Extend the existing operation ledger; retain all existing Live receipts.
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (action in (
    'start','save_set','confirm_set','unconfirm_set','finish','append_exercise','append_set',
    'remove_set','reorder_block','replace_exercise','set_comment','remove_exercise',
    'merge_block','append_round','remove_round','split_block','reschedule'
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
    or p_action not in ('start','save_set','confirm_set','unconfirm_set','finish','append_exercise',
      'append_set','remove_set','reorder_block','replace_exercise','set_comment',
      'remove_exercise','merge_block','append_round','remove_round','split_block','reschedule') then
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

create or replace function public.unconfirm_live_set(
  p_set_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  workout_id_value uuid;
  replayed_version bigint;
  next_version bigint;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  select exercise.workout_id into workout_id_value
    from public.workout_sets s join public.workout_exercises exercise
      on exercise.id = s.workout_exercise_id where s.id = p_set_id;
  perform app_private.authorize_live_workout(workout_id_value);
  replayed_version := app_private.claim_live_workout_operation(
    'unconfirm_set', p_set_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  perform 1 from public.workouts w where w.id = workout_id_value
    and w.status = 'in_progress' and w.deleted_at is null for update;
  if not found then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  update public.workout_sets s set confirmed_at = null, timer_confirmed = false,
    updated_by = auth.uid(), version = s.version + 1
    where s.id = p_set_id and s.version = p_expected_version
      and s.confirmed_at is not null returning s.version into next_version;
  if next_version is null then raise exception 'live_set_conflict' using errcode = 'PT409'; end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_set_id);
  return query select next_version, false;
end;
$$;
revoke all on function public.unconfirm_live_set(uuid,bigint,uuid) from public;
grant execute on function public.unconfirm_live_set(uuid,bigint,uuid) to fit_api;

-- Down Migration
-- Retain operation receipts and the superset of accepted action names for safe replay.
drop function public.unconfirm_live_set(uuid,bigint,uuid);
