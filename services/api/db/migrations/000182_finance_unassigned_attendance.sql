-- Up Migration

create or replace function app_private.sync_trainer_finance_workout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  finance_trainer_id uuid;
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
  finance_trainer_id := app_private.workout_finance_trainer(new.id);
  if finance_trainer_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    finance_trainer_id::text || ':' || new.client_id::text, 0
  ));
  if exists (select 1 from public.trainer_finance_sessions session
    where session.workout_id = new.id and session.voided_at is null) then return new; end if;
  -- Online-only coaching is period-based. Other trainer attendance must
  -- remain visible for review even before the first session pack is created.
  if not exists (select 1 from public.trainer_finance_packages package
    where package.trainer_id = finance_trainer_id and package.client_id = new.client_id
      and package.kind = 'session_pack') and exists (
    select 1 from public.trainer_finance_packages package
    where package.trainer_id = finance_trainer_id and package.client_id = new.client_id
      and package.kind = 'online_coaching' and package.closed_at is null
      and package.starts_on <= new.workout_date and package.ends_on >= new.workout_date
  ) then return new; end if;
  select count(*)::integer, (array_agg(candidate.id))[1]
  into candidate_count, candidate_package_id
  from (
    select package.id from public.trainer_finance_packages package
    where package.trainer_id = finance_trainer_id and package.client_id = new.client_id
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
    new.id, finance_trainer_id, new.client_id,
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

-- Down Migration

create or replace function app_private.sync_trainer_finance_workout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  finance_trainer_id uuid;
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
  finance_trainer_id := app_private.workout_finance_trainer(new.id);
  if finance_trainer_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    finance_trainer_id::text || ':' || new.client_id::text, 0
  ));
  if exists (select 1 from public.trainer_finance_sessions session
    where session.workout_id = new.id and session.voided_at is null) then return new; end if;
  if not exists (select 1 from public.trainer_finance_packages package
    where package.trainer_id = finance_trainer_id and package.client_id = new.client_id
      and package.kind = 'session_pack') then return new; end if;
  select count(*)::integer, (array_agg(candidate.id))[1]
  into candidate_count, candidate_package_id
  from (
    select package.id from public.trainer_finance_packages package
    where package.trainer_id = finance_trainer_id and package.client_id = new.client_id
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
    new.id, finance_trainer_id, new.client_id,
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
