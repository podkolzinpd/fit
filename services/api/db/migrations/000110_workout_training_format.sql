-- Up Migration

alter table public.workouts
  add column training_format text not null default 'self'
  constraint workouts_training_format_valid check (training_format in ('self', 'with_trainer'));

create function public.set_workout_training_format(
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

  if actor_role = 'client' then
    next_format := 'self';
  elsif p_requested_format is not null then
    next_format := p_requested_format;
  elsif p_apply_default then
    if exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = current_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'online_coaching' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and package.ends_on >= current_workout_date
    ) then
      next_format := 'self';
    elsif exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = current_trainer_id
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

drop trigger sync_trainer_finance_workout on public.workouts;
create or replace function app_private.sync_trainer_finance_workout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  candidate_count integer;
  candidate_package_id uuid;
begin
  if new.status <> 'done' or new.deleted_at is not null then
    update public.trainer_finance_sessions session
    set voided_at = now(), void_reason = 'Тренировка больше не завершена',
      version = session.version + 1
    where session.workout_id = new.id and session.voided_at is null;
    return new;
  end if;
  if new.training_format <> 'with_trainer' then
    update public.trainer_finance_sessions session
    set voided_at = now(), void_reason = 'Самостоятельная тренировка',
      version = session.version + 1
    where session.workout_id = new.id and session.voided_at is null;
    return new;
  end if;
  if new.created_by is not null and new.created_by <> new.trainer_id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.trainer_id::text || ':' || new.client_id::text, 0
  ));
  if exists (select 1 from public.trainer_finance_sessions session
    where session.workout_id = new.id and session.voided_at is null) then return new; end if;
  if not exists (select 1 from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id
      and package.kind = 'session_pack') then return new; end if;
  select count(*)::integer, (array_agg(candidate.id))[1]
  into candidate_count, candidate_package_id
  from (
    select package.id from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id
      and package.kind = 'session_pack' and package.closed_at is null
      and package.starts_on <= new.workout_date
      and (package.ends_on is null or package.ends_on >= new.workout_date)
      and package.opening_used_sessions + (select count(*)
        from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null) < package.sessions_total
    order by package.starts_on desc, package.created_at desc limit 2
  ) candidate;
  insert into public.trainer_finance_sessions (
    package_id, workout_id, trainer_id, client_id, disposition, source, comment
  ) values (
    case when candidate_count = 1 then candidate_package_id else null end,
    new.id, new.trainer_id, new.client_id,
    case when candidate_count = 1 then 'charged' else 'unassigned' end,
    case when coalesce(new.notes, '') = 'Проведённое занятие' and not exists (
      select 1 from public.workout_exercises exercise where exercise.workout_id = new.id
    ) then 'manual' else 'automatic' end,
    case when candidate_count > 1 then 'Выберите абонемент'
      when candidate_count = 0 then 'Нет подходящего абонемента' else null end
  ) on conflict do nothing;
  return new;
end;
$$;
create trigger sync_trainer_finance_workout
after insert or update of status, deleted_at, training_format on public.workouts
for each row execute function app_private.sync_trainer_finance_workout();

revoke all on function public.set_workout_training_format(uuid, text, bigint, boolean) from public;
grant execute on function public.set_workout_training_format(uuid, text, bigint, boolean) to fit_api;

-- Down Migration

revoke execute on function public.set_workout_training_format(uuid, text, bigint, boolean) from fit_api;
drop trigger sync_trainer_finance_workout on public.workouts;
drop function public.set_workout_training_format(uuid, text, bigint, boolean);

create or replace function app_private.sync_trainer_finance_workout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare candidate_count integer; candidate_package_id uuid;
begin
  if new.status <> 'done' or new.deleted_at is not null then
    update public.trainer_finance_sessions session
    set voided_at = now(), void_reason = 'Тренировка больше не завершена', version = session.version + 1
    where session.workout_id = new.id and session.voided_at is null;
    return new;
  end if;
  if new.created_by is not null and new.created_by <> new.trainer_id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.trainer_id::text || ':' || new.client_id::text, 0));
  if exists (select 1 from public.trainer_finance_sessions session where session.workout_id = new.id and session.voided_at is null) then return new; end if;
  if not exists (select 1 from public.trainer_finance_packages package where package.trainer_id = new.trainer_id and package.client_id = new.client_id and package.kind = 'session_pack') then return new; end if;
  select count(*)::integer, (array_agg(candidate.id))[1] into candidate_count, candidate_package_id
  from (select package.id from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id and package.kind = 'session_pack'
      and package.closed_at is null and package.starts_on <= new.workout_date
      and (package.ends_on is null or package.ends_on >= new.workout_date)
      and package.opening_used_sessions + (select count(*) from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged' and used.voided_at is null) < package.sessions_total
    order by package.starts_on desc, package.created_at desc limit 2) candidate;
  insert into public.trainer_finance_sessions (package_id, workout_id, trainer_id, client_id, disposition, source, comment)
  values (case when candidate_count = 1 then candidate_package_id else null end, new.id, new.trainer_id, new.client_id,
    case when candidate_count = 1 then 'charged' else 'unassigned' end,
    case when coalesce(new.notes, '') = 'Проведённое занятие' and not exists (select 1 from public.workout_exercises exercise where exercise.workout_id = new.id) then 'manual' else 'automatic' end,
    case when candidate_count > 1 then 'Выберите абонемент' when candidate_count = 0 then 'Нет подходящего абонемента' else null end)
  on conflict do nothing;
  return new;
end;
$$;
create trigger sync_trainer_finance_workout
after insert or update of status, deleted_at on public.workouts
for each row execute function app_private.sync_trainer_finance_workout();
alter table public.workouts drop column training_format;
