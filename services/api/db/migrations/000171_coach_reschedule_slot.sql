-- Up Migration
-- Extend the existing operation ledger; retain all existing Live receipts.
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (action in (
    'start','save_set','confirm_set','finish','append_exercise','append_set',
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
    or p_action not in ('start','save_set','confirm_set','finish','append_exercise',
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

-- The four-argument lifecycle command remains unchanged for cancelled/past plans.
-- Explicit interval + operation ID opt into the coach-only planned-slot command.
create function public.reschedule_workout(
  p_workout_id uuid, p_workout_date date, p_start_time time,
  p_expected_version bigint, p_end_time time, p_operation_id uuid
)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  workout_row public.workouts;
  replayed_version bigint;
  next_version bigint;
begin
  select permission.actor_role into actor_role
    from app_private.authorize_workout_lifecycle(p_workout_id,false) permission;
  if actor_role is distinct from 'trainer' then
    raise exception 'workout_forbidden' using errcode='PT403';
  end if;
  if p_workout_date is null or p_expected_version is null or p_expected_version<1
    or (p_end_time is not null and (p_start_time is null or p_end_time<=p_start_time)) then
    raise exception 'workout_invalid' using errcode='PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'reschedule',p_workout_id,p_operation_id,
    encode(sha256(convert_to(jsonb_build_array(p_workout_date,p_start_time,
      p_expected_version,p_end_time)::text,'UTF8')),'hex')
  );
  -- A disconnected/archived client cannot replay a formerly permitted command.
  select w.* into workout_row from public.workouts w
    join public.clients c on c.id=w.client_id
    where w.id=p_workout_id and w.deleted_at is null and c.archived_at is null
    for update of w;
  if workout_row.id is null then raise exception 'workout_forbidden' using errcode='PT403'; end if;
  if replayed_version is not null then return replayed_version; end if;
  if workout_row.version<>p_expected_version then raise exception 'workout_conflict' using errcode='PT409'; end if;
  if workout_row.status<>'planned' then raise exception 'workout_not_resolvable' using errcode='PT422'; end if;
  update public.workouts w set workout_date=p_workout_date,start_time=p_start_time,
    end_time=p_end_time,updated_by=actor_id,version=w.version+1
    where w.id=p_workout_id returning w.version into next_version;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_workout_id);
  return next_version;
end;
$$;
revoke all on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) from public;
grant execute on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) to fit_api;

-- Down Migration
-- Receipts and the additive private action remain valid across an API rollback.
drop function public.reschedule_workout(uuid,date,time,bigint,time,uuid);
