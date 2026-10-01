-- Up Migration

-- A client-row lock serializes starts from different devices and trainers.
-- The operation ledger makes a retried request return its original result.
create table app_private.quick_start_operations (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);
revoke all on app_private.quick_start_operations from public, fit_api;

-- The read model must expose a client's active session to connected trainers;
-- otherwise quick-start could succeed but its Live screen would return 403.
create or replace function public.can_read_workout(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and (
        client.auth_user_id = auth.uid()
        or (
          (
            client.trainer_id = auth.uid()
            or exists (
              select 1 from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = auth.uid()
            )
          )
          and (
            workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid())
            or (workout.status in ('in_progress', 'done')
              and client.auth_user_id is not null
              and workout.created_by = client.auth_user_id)
          )
        )
      )
  )
$$;

-- Connected trainers may conduct a session the client started for themselves,
-- but still cannot take over a different trainer's session.
create or replace function app_private.authorize_live_workout(p_workout_id uuid)
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
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = current_actor_id;
  select workout.trainer_id into root_trainer_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null and client.archived_at is null
    and (
      (actor_role = 'trainer'
        and (workout.created_by = current_actor_id
          or (workout.created_by is null and workout.trainer_id = current_actor_id)
          or (workout.status = 'in_progress' and client.auth_user_id is not null
            and workout.created_by = client.auth_user_id))
        and (client.trainer_id = current_actor_id or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id and membership.trainer_id = current_actor_id
        )))
      or (actor_role = 'client' and client.auth_user_id = current_actor_id)
    );
  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

create function public.quick_start_live_workout(p_client_id uuid, p_operation_id uuid)
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
      or (actor_role = 'trainer' and (client.trainer_id = current_actor_id or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = client.id and membership.trainer_id = current_actor_id
      )))
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

  begin
    insert into public.workouts (
      trainer_id, client_id, created_by, updated_by, started_by,
      workout_date, status, started_at, origin
    ) values (
      root_trainer_id, target_client_id, current_actor_id, current_actor_id, current_actor_id,
      app_private.client_today(target_client_id), 'in_progress', now(), 'manual'
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
revoke all on function public.quick_start_live_workout(uuid, uuid) from public;
grant execute on function public.quick_start_live_workout(uuid, uuid) to fit_api;

create function public.cancel_empty_live_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  if exists (select 1 from public.workout_exercises exercise where exercise.workout_id = p_workout_id) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  update public.workouts workout
  set deleted_at = now(), updated_by = actor_id, version = workout.version + 1
  where workout.id = p_workout_id and workout.status = 'in_progress'
    and workout.deleted_at is null and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;
revoke all on function public.cancel_empty_live_workout(uuid, bigint) from public;
grant execute on function public.cancel_empty_live_workout(uuid, bigint) to fit_api;

-- Empty quick-start sessions can be resumed or removed, but not completed.
create or replace function public.finish_live_workout(
  p_workout_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'finish', p_workout_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  if not exists (
    select 1 from public.workout_exercises exercise
    where exercise.workout_id = p_workout_id
  ) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  update public.workouts workout
  set status = 'done', completed_at = now(), completed_by = actor_id,
      updated_by = actor_id, version = workout.version + 1
  where workout.id = p_workout_id and workout.status = 'in_progress'
    and workout.deleted_at is null and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
  return query select next_version, false;
end;
$$;

-- Down Migration

create or replace function public.can_read_workout(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and (
        client.auth_user_id = auth.uid()
        or (
          (
            client.trainer_id = auth.uid()
            or exists (
              select 1 from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = auth.uid()
            )
          )
          and (
            workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid())
            or (
              workout.status = 'done'
              and workout.created_by = client.auth_user_id
            )
          )
        )
      )
  )
$$;

create or replace function app_private.authorize_live_workout(p_workout_id uuid)
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
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = current_actor_id;
  select workout.trainer_id into root_trainer_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null and client.archived_at is null
    and (
      (actor_role = 'trainer'
        and (workout.created_by = current_actor_id
          or (workout.created_by is null and workout.trainer_id = current_actor_id))
        and (client.trainer_id = current_actor_id or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id and membership.trainer_id = current_actor_id
        )))
      or (actor_role = 'client' and client.auth_user_id = current_actor_id)
    );
  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

create or replace function public.finish_live_workout(
  p_workout_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'finish', p_workout_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  update public.workouts workout
  set status = 'done', completed_at = now(), completed_by = actor_id,
      updated_by = actor_id, version = workout.version + 1
  where workout.id = p_workout_id and workout.status = 'in_progress'
    and workout.deleted_at is null and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
  return query select next_version, false;
end;
$$;
revoke execute on function public.quick_start_live_workout(uuid, uuid) from fit_api;
drop function public.quick_start_live_workout(uuid, uuid);
revoke execute on function public.cancel_empty_live_workout(uuid, bigint) from fit_api;
drop function public.cancel_empty_live_workout(uuid, bigint);
drop table app_private.quick_start_operations;
