-- Up Migration

create or replace function public.update_trainer_finance_session_details_v2(
  p_session_id uuid, p_expected_version bigint, p_disposition text,
  p_package_id uuid, p_comment text, p_workout_date date
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  current_session public.trainer_finance_sessions;
  updated_session public.trainer_finance_sessions;
  next_disposition text := p_disposition;
  next_package_id uuid := p_package_id;
begin
  if p_workout_date is null or p_disposition not in ('charged', 'unassigned', 'free', 'trial')
    or (p_disposition = 'charged') <> (p_package_id is not null)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select * into current_session from public.trainer_finance_sessions session
  where session.id = p_session_id and session.trainer_id = actor_id and session.voided_at is null;
  if current_session.id is null then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  -- Keep the lock order consistent with workout triggers: workout, then client ledger.
  perform 1 from public.workouts where id = current_session.workout_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    current_session.trainer_id::text || ':' || current_session.client_id::text, 0
  ));
  if p_disposition = 'charged' and not exists (
    select 1 from public.trainer_finance_packages package
    where package.id = p_package_id and package.trainer_id = actor_id
      and package.client_id = current_session.client_id
      and package.kind = 'session_pack' and package.closed_at is null
      and package.starts_on <= p_workout_date
      and (package.ends_on is null or package.ends_on >= p_workout_date)
      and package.opening_used_sessions + (select count(*)
        from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null and used.id <> current_session.id) < package.sessions_total
  ) then
    if p_package_id = current_session.package_id and exists (
      select 1 from public.workouts w where w.id = current_session.workout_id and w.workout_date <> p_workout_date
    ) then
      next_disposition := 'unassigned';
      next_package_id := null;
    else
      raise exception 'trainer_finance_invalid' using errcode = 'PT422';
    end if;
  end if;
  update public.trainer_finance_sessions session
  set disposition = next_disposition,
    package_id = case when next_disposition = 'charged' then next_package_id else null end,
    comment = nullif(btrim(coalesce(p_comment, '')), ''), version = session.version + 1
  where session.id = p_session_id and session.trainer_id = actor_id
    and session.version = p_expected_version and session.voided_at is null
  returning * into updated_session;
  if updated_session.id is null then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  update public.workouts workout set workout_date = p_workout_date
  where workout.id = current_session.workout_id
    and coalesce(workout.created_by, workout.trainer_id) = actor_id and workout.client_id = current_session.client_id;
  if not found then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'id', updated_session.id, 'packageId', updated_session.package_id,
    'workoutId', updated_session.workout_id, 'workoutDate', p_workout_date,
    'disposition', updated_session.disposition, 'source', updated_session.source,
    'comment', updated_session.comment, 'voidedAt', updated_session.voided_at,
    'voidReason', updated_session.void_reason, 'version', updated_session.version,
    'createdAt', updated_session.created_at, 'updatedAt', updated_session.updated_at
  );
end;
$$;


create function app_private.revalidate_finance_workout_date()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare current_session public.trainer_finance_sessions;
begin
  if new.workout_date is not distinct from old.workout_date
    or new.status <> 'done' or new.deleted_at is not null or new.training_format <> 'with_trainer' then return new; end if;
  select * into current_session from public.trainer_finance_sessions s
  where s.workout_id = new.id and s.voided_at is null and s.disposition = 'charged';
  if current_session.id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    current_session.trainer_id::text || ':' || current_session.client_id::text, 0
  ));
  if not exists (select 1 from public.trainer_finance_packages p
    where p.id = current_session.package_id and p.trainer_id = current_session.trainer_id
      and p.client_id = new.client_id and p.kind = 'session_pack' and p.closed_at is null
      and p.starts_on <= new.workout_date and (p.ends_on is null or p.ends_on >= new.workout_date)) then
    update public.trainer_finance_sessions set disposition = 'unassigned', package_id = null, version = version + 1
    where id = current_session.id and voided_at is null and disposition = 'charged';
  end if;
  return new;
end;
$$;
revoke all on function app_private.revalidate_finance_workout_date() from public, fit_api;
create trigger revalidate_finance_workout_date after update of workout_date on public.workouts
for each row execute function app_private.revalidate_finance_workout_date();

-- Down Migration
drop trigger revalidate_finance_workout_date on public.workouts;
drop function app_private.revalidate_finance_workout_date();
create or replace function public.update_trainer_finance_session_details_v2(
  p_session_id uuid, p_expected_version bigint, p_disposition text,
  p_package_id uuid, p_comment text, p_workout_date date
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  current_session public.trainer_finance_sessions;
  updated_session public.trainer_finance_sessions;
begin
  if p_workout_date is null or p_disposition not in ('charged', 'unassigned', 'free', 'trial')
    or (p_disposition = 'charged') <> (p_package_id is not null)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select * into current_session from public.trainer_finance_sessions session
  where session.id = p_session_id and session.trainer_id = actor_id and session.voided_at is null;
  if current_session.id is null then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    current_session.trainer_id::text || ':' || current_session.client_id::text, 0
  ));
  if p_disposition = 'charged' and not exists (
    select 1 from public.trainer_finance_packages package
    where package.id = p_package_id and package.trainer_id = actor_id
      and package.client_id = current_session.client_id
      and package.kind = 'session_pack' and package.closed_at is null
      and package.starts_on <= p_workout_date
      and (package.ends_on is null or package.ends_on >= p_workout_date)
      and package.opening_used_sessions + (select count(*)
        from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null and used.id <> current_session.id) < package.sessions_total
  ) then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.workouts workout set workout_date = p_workout_date
  where workout.id = current_session.workout_id
    and coalesce(workout.created_by, workout.trainer_id) = actor_id and workout.client_id = current_session.client_id;
  if not found then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  update public.trainer_finance_sessions session
  set disposition = p_disposition,
    package_id = case when p_disposition = 'charged' then p_package_id else null end,
    comment = nullif(btrim(coalesce(p_comment, '')), ''), version = session.version + 1
  where session.id = p_session_id and session.trainer_id = actor_id
    and session.version = p_expected_version and session.voided_at is null
  returning * into updated_session;
  if updated_session.id is null then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  return jsonb_build_object(
    'id', updated_session.id, 'packageId', updated_session.package_id,
    'workoutId', updated_session.workout_id, 'workoutDate', p_workout_date,
    'disposition', updated_session.disposition, 'source', updated_session.source,
    'comment', updated_session.comment, 'voidedAt', updated_session.voided_at,
    'voidReason', updated_session.void_reason, 'version', updated_session.version,
    'createdAt', updated_session.created_at, 'updatedAt', updated_session.updated_at
  );
end;
$$;


