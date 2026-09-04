-- Up Migration
alter table app_private.live_workout_operations
  drop constraint live_workout_operations_action_allowed;
alter table app_private.live_workout_operations
  add constraint live_workout_operations_action_allowed check (action in (
    'start', 'save_set', 'confirm_set', 'finish', 'append_exercise', 'append_set',
    'remove_set', 'reorder_block', 'replace_exercise', 'set_comment', 'remove_exercise'
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
      'append_set','remove_set','reorder_block','replace_exercise','set_comment','remove_exercise') then
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

create function public.remove_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid,version bigint,replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation('remove_exercise',p_exercise_id,p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_expected_version::text,'UTF8')),'hex'));
  if replayed_version is not null then
    return query select p_exercise_id,replayed_version,true;
    return;
  end if;
  update public.workouts workout set updated_by=auth.uid(),version=workout.version+1
    where workout.id=p_workout_id and workout.status='in_progress'
      and workout.deleted_at is null and workout.version=p_expected_version
    returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  delete from public.workout_exercises exercise
    where exercise.id=p_exercise_id and exercise.workout_id=p_workout_id;
  if not found then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_exercise_id);
  return query select p_exercise_id,next_version,false;
end;
$$;
revoke all on function public.remove_live_exercise(uuid,uuid,bigint,uuid) from public;
grant execute on function public.remove_live_exercise(uuid,uuid,bigint,uuid) to fit_api;

-- Down Migration
-- Forward-only rollout: do not remove operation receipts on rollback.
drop function public.remove_live_exercise(uuid,uuid,bigint,uuid);
