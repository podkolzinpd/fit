-- Up Migration

-- One transaction timestamp and the existing client/trainer timezone precedence.
create or replace function app_private.client_local_now(p_client_id uuid)
returns timestamp
language plpgsql
stable
security definer
set search_path = ''
as $$
declare client_timezone text;
begin
  select coalesce(client_profile.timezone, trainer_profile.timezone, 'Europe/Moscow')
    into client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id;
  if not exists (select 1 from pg_catalog.pg_timezone_names zone
    where zone.name = client_timezone) then client_timezone := 'Europe/Moscow'; end if;
  return (now() at time zone client_timezone);
end;
$$;
revoke all on function app_private.client_local_now(uuid) from public, fit_api;

create or replace function app_private.client_today(p_client_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select app_private.client_local_now(p_client_id)::date;
$$;

create or replace function public.quick_start_live_workout(p_client_id uuid, p_operation_id uuid)
returns table (workout_id uuid, resumed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  target_client_id uuid;
  root_trainer_id uuid;
  owner_actor_id uuid;
  previous_client_id uuid;
  previous_workout_id uuid;
  active_workout_id uuid;
  active_author_id uuid;
  local_started_at timestamp;
begin
  if current_actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_operation_id is null then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  select profile.account_role into actor_role
  from public.profiles profile where profile.id = current_actor_id;

  -- Self-managed clients must have their own linked client partition.
  if actor_role = 'client' then
    select client.id into target_client_id
    from public.clients client
    where client.auth_user_id = current_actor_id and client.archived_at is null;
    if p_client_id is not null and p_client_id is distinct from target_client_id then
      raise exception 'client_forbidden' using errcode = 'PT403';
    end if;
  elsif actor_role = 'trainer' then
    target_client_id := p_client_id;
  else
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if target_client_id is null then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select client.trainer_id, client.auth_user_id into root_trainer_id, owner_actor_id
  from public.clients client
  where client.id = target_client_id
    and client.archived_at is null
    and (
      (actor_role = 'client' and client.auth_user_id = current_actor_id)
      or (actor_role = 'trainer' and (public.is_active_client_trainer_connection(client.id, current_actor_id)))
    )
  for update of client;
  if root_trainer_id is null then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select operation.client_id, operation.workout_id
    into previous_client_id, previous_workout_id
  from app_private.quick_start_operations operation
  where operation.actor_id = current_actor_id and operation.operation_id = p_operation_id;
  if previous_workout_id is not null then
    if previous_client_id is distinct from target_client_id then
      raise exception 'operation_reused' using errcode = 'PT422';
    end if;
    return query select previous_workout_id, true;
    return;
  end if;

  select workout.id, workout.created_by into active_workout_id, active_author_id
  from public.workouts workout
  where workout.client_id = target_client_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null;

  if active_workout_id is not null then
    -- A connected trainer cannot edit another trainer's live session.
    if actor_role = 'trainer' and active_author_id is distinct from current_actor_id
      and not (owner_actor_id is not null and active_author_id = owner_actor_id)
      and not (active_author_id is null and root_trainer_id = current_actor_id) then
      raise exception 'active_workout_exists' using errcode = 'PT409';
    end if;
    insert into app_private.quick_start_operations(actor_id, operation_id, client_id, workout_id)
    values (current_actor_id, p_operation_id, target_client_id, active_workout_id);
    return query select active_workout_id, true;
    return;
  end if;

  local_started_at := app_private.client_local_now(target_client_id);
  begin
    insert into public.workouts (
      trainer_id, client_id, created_by, updated_by, started_by,
      workout_date, start_time, status, started_at, origin
    ) values (
      root_trainer_id, target_client_id, current_actor_id, current_actor_id, current_actor_id,
      local_started_at::date, local_started_at::time, 'in_progress', now(), 'manual'
    ) returning id into active_workout_id;
  exception when unique_violation then
    -- A planned workout could have started while this request waited for the row.
    raise exception 'active_workout_exists' using errcode = 'PT409';
  end;
  insert into app_private.quick_start_operations(actor_id, operation_id, client_id, workout_id)
  values (current_actor_id, p_operation_id, target_client_id, active_workout_id);
  return query select active_workout_id, false;
end;
$$;

-- Down Migration
-- Forward-only; recorded start times must never be removed by rollback.
