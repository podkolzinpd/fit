-- Up Migration

-- Existing workouts retain their format; only new creations need the initial choice.
alter table public.workouts add column training_format_initialized boolean not null default true;
alter table public.workouts alter column training_format_initialized set default false;

create or replace function public.set_workout_training_format(
  p_workout_id uuid,
  p_requested_format text,
  p_expected_version bigint,
  p_apply_default boolean default false
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  current_client_id uuid;
  current_trainer_id uuid;
  current_created_by uuid;
  current_version bigint;
  current_format text;
  format_initialized boolean;
  current_workout_date date;
  client_owner_id uuid;
  finance_trainer_id uuid;
  next_format text;
  next_version bigint;
begin
  if actor_id is null or (p_requested_format is not null
    and p_requested_format not in ('self', 'with_trainer')) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
  select workout.client_id, workout.trainer_id, workout.created_by,
    workout.version, workout.training_format, workout.training_format_initialized, workout.workout_date,
    client.auth_user_id
  into current_client_id, current_trainer_id, current_created_by,
    current_version, current_format, format_initialized, current_workout_date, client_owner_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;
  if current_client_id is null then
    raise exception 'workout_not_found' using errcode = 'PT404';
  end if;
  if not (
    (actor_role = 'trainer'
      and (current_created_by = actor_id
        or (current_created_by is null and current_trainer_id = actor_id))
      and exists (
        select 1 from public.clients client
        where client.id = current_client_id
          and (client.trainer_id = actor_id or exists (
            select 1 from public.client_trainers membership
            where membership.client_id = client.id and membership.trainer_id = actor_id
          ))
      ))
    or (actor_role = 'client' and client_owner_id = actor_id
      and current_created_by = actor_id)
  ) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_expected_version is not null and current_version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  -- Creation retries preserve the committed choice, including the last package slot.
  if p_apply_default and format_initialized then return current_version; end if;

  finance_trainer_id := app_private.workout_finance_trainer(p_workout_id);
  if actor_role = 'client' then
    next_format := 'self';
  elsif p_requested_format is not null then
    next_format := p_requested_format;
  elsif p_apply_default then
    if exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'online_coaching' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and package.ends_on >= current_workout_date
    ) then
      next_format := 'self';
    elsif exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'session_pack' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and (package.ends_on is null or package.ends_on >= current_workout_date)
        and package.opening_used_sessions + (
          select count(*) from public.trainer_finance_sessions session
          where session.package_id = package.id and session.disposition = 'charged'
            and session.voided_at is null
        ) < package.sessions_total
    ) then
      next_format := 'with_trainer';
    else
      next_format := 'self';
    end if;
  else
    next_format := current_format;
  end if;

  if next_format = current_format then
    update public.workouts set training_format_initialized = true where id = p_workout_id;
    return current_version;
  end if;
  update public.workouts workout
  set training_format = next_format, training_format_initialized = true, updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;


create table app_private.finance_manual_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
revoke all on app_private.finance_manual_requests from public, fit_api;

create function public.create_trainer_finance_manual_session(
  p_client_id uuid, p_request_id uuid, p_workout_date date,
  p_disposition text, p_package_id uuid, p_comment text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_id_value uuid := app_private.trainer_finance_assert_trainer();
  request_payload jsonb := jsonb_build_object('clientId', p_client_id, 'workoutDate', p_workout_date,
    'disposition', p_disposition, 'packageId', p_package_id, 'comment', p_comment);
  receipt app_private.finance_manual_requests;
  saved record;
  finance_session public.trainer_finance_sessions;
  result_value jsonb;
begin
  if not app_private.trainer_finance_has_connection(actor_id_value, p_client_id) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;
  if p_request_id is null or p_workout_date is null or p_disposition is null
    or p_disposition not in ('charged', 'unassigned', 'free', 'trial')
    or (p_disposition = 'charged') <> (p_package_id is not null)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  insert into app_private.finance_manual_requests (actor_id, request_id, payload)
  values (actor_id_value, p_request_id, request_payload) on conflict do nothing;
  select * into receipt from app_private.finance_manual_requests r
  where r.actor_id = actor_id_value and r.request_id = p_request_id for update;
  if receipt.payload <> request_payload then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  if receipt.result is not null then return receipt.result; end if;

  select * into saved from public.save_completed_workout(jsonb_build_object(
    'clientId', p_client_id, 'workoutDate', p_workout_date,
    'notes', 'Проведённое занятие', 'exercises', '[]'::jsonb
  ), null);
  perform public.set_workout_training_format(saved.workout_id, 'with_trainer', saved.version, true);
  -- Explicit manual accounting also exists without a session pack.
  insert into public.trainer_finance_sessions(workout_id, trainer_id, client_id, disposition, source)
  values(saved.workout_id, actor_id_value, p_client_id, 'unassigned', 'manual') on conflict do nothing;
  select * into finance_session from public.trainer_finance_sessions s
  where s.workout_id = saved.workout_id and s.trainer_id = actor_id_value and s.voided_at is null;
  if finance_session.id is null then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.trainer_finance_sessions set source = 'manual' where id = finance_session.id;
  result_value := public.update_trainer_finance_session_details_v2(finance_session.id,
    finance_session.version, p_disposition, p_package_id, p_comment, p_workout_date);
  update app_private.finance_manual_requests r set result = result_value
  where r.actor_id = actor_id_value and r.request_id = p_request_id;
  return result_value;
end;
$$;
revoke all on function public.create_trainer_finance_manual_session(uuid,uuid,date,text,uuid,text) from public;
grant execute on function public.create_trainer_finance_manual_session(uuid,uuid,date,text,uuid,text) to fit_api;

-- Down Migration
drop function public.create_trainer_finance_manual_session(uuid,uuid,date,text,uuid,text);
drop table app_private.finance_manual_requests;
create or replace function public.set_workout_training_format(
  p_workout_id uuid,
  p_requested_format text,
  p_expected_version bigint,
  p_apply_default boolean default false
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  current_client_id uuid;
  current_trainer_id uuid;
  current_created_by uuid;
  current_version bigint;
  current_format text;
  current_workout_date date;
  client_owner_id uuid;
  finance_trainer_id uuid;
  next_format text;
  next_version bigint;
begin
  if actor_id is null or (p_requested_format is not null
    and p_requested_format not in ('self', 'with_trainer')) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
  select workout.client_id, workout.trainer_id, workout.created_by,
    workout.version, workout.training_format, workout.workout_date,
    client.auth_user_id
  into current_client_id, current_trainer_id, current_created_by,
    current_version, current_format, current_workout_date, client_owner_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;
  if current_client_id is null then
    raise exception 'workout_not_found' using errcode = 'PT404';
  end if;
  if not (
    (actor_role = 'trainer'
      and (current_created_by = actor_id
        or (current_created_by is null and current_trainer_id = actor_id))
      and exists (
        select 1 from public.clients client
        where client.id = current_client_id
          and (client.trainer_id = actor_id or exists (
            select 1 from public.client_trainers membership
            where membership.client_id = client.id and membership.trainer_id = actor_id
          ))
      ))
    or (actor_role = 'client' and client_owner_id = actor_id
      and current_created_by = actor_id)
  ) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_expected_version is not null and current_version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  finance_trainer_id := app_private.workout_finance_trainer(p_workout_id);
  if actor_role = 'client' then
    next_format := 'self';
  elsif p_requested_format is not null then
    next_format := p_requested_format;
  elsif p_apply_default then
    if exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'online_coaching' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and package.ends_on >= current_workout_date
    ) then
      next_format := 'self';
    elsif exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'session_pack' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and (package.ends_on is null or package.ends_on >= current_workout_date)
        and package.opening_used_sessions + (
          select count(*) from public.trainer_finance_sessions session
          where session.package_id = package.id and session.disposition = 'charged'
            and session.voided_at is null
        ) < package.sessions_total
    ) then
      next_format := 'with_trainer';
    else
      next_format := 'self';
    end if;
  else
    next_format := current_format;
  end if;

  if next_format = current_format then return current_version; end if;
  update public.workouts workout
  set training_format = next_format, updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;


alter table public.workouts drop column training_format_initialized;
