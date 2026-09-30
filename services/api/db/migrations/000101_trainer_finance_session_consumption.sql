-- Up Migration

alter table public.trainer_finance_sessions
  add column version bigint not null default 1;

create function app_private.sync_trainer_finance_workout()
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

  -- Самостоятельные тренировки клиента и записи другого тренера не списывают
  -- занятие у владельца карточки.
  if new.created_by is not null and new.created_by <> new.trainer_id then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.trainer_id::text || ':' || new.client_id::text, 0
  ));
  if exists (
    select 1 from public.trainer_finance_sessions session
    where session.workout_id = new.id and session.voided_at is null
  ) then
    return new;
  end if;
  -- Finance starts only after the trainer has created the client's first
  -- package. Existing workouts stay untouched until that explicit opt-in.
  if not exists (
    select 1 from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id
  ) then
    return new;
  end if;

  select count(*)::integer, (array_agg(candidate.id))[1]
  into candidate_count, candidate_package_id
  from (
    select package.id
    from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id
      and package.client_id = new.client_id
      and package.closed_at is null
      and package.starts_on <= new.workout_date
      and (package.ends_on is null or package.ends_on >= new.workout_date)
      and package.opening_used_sessions + (
        select count(*) from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null
      ) < package.sessions_total
    order by package.starts_on desc, package.created_at desc
    limit 2
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
    case when candidate_count > 1 then 'Выберите абонемент' when candidate_count = 0 then 'Нет подходящего абонемента' else null end
  ) on conflict do nothing;
  return new;
end;
$$;

create trigger sync_trainer_finance_workout
after insert or update of status, deleted_at on public.workouts
for each row execute function app_private.sync_trainer_finance_workout();

create or replace function public.list_trainer_finance_client(p_client_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if not app_private.trainer_finance_has_connection(actor_id, p_client_id)
    and not exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;

  return jsonb_build_object(
    'clientId', p_client_id,
    'packages', coalesce((
      select jsonb_agg(app_private.trainer_finance_package_payload(package.id)
        order by package.starts_on desc, package.created_at desc)
      from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id, 'packageId', payment.package_id,
        'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
        'source', payment.source, 'comment', payment.comment,
        'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
        'version', payment.version, 'createdAt', payment.created_at,
        'updatedAt', payment.updated_at
      ) order by payment.received_on desc, payment.created_at desc)
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.client_id = p_client_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', session.id, 'packageId', session.package_id,
        'workoutId', session.workout_id, 'disposition', session.disposition,
        'source', session.source, 'comment', session.comment,
        'workoutDate', workout.workout_date, 'voidedAt', session.voided_at,
        'voidReason', session.void_reason, 'version', session.version,
        'createdAt', session.created_at, 'updatedAt', session.updated_at
      ) order by workout.workout_date desc, session.created_at desc)
      from public.trainer_finance_sessions session
      join public.workouts workout on workout.id = session.workout_id
      where session.trainer_id = actor_id and session.client_id = p_client_id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.update_trainer_finance_session(
  p_session_id uuid,
  p_expected_version bigint,
  p_disposition text,
  p_package_id uuid,
  p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  current_session public.trainer_finance_sessions;
  updated_session public.trainer_finance_sessions;
begin
  if p_disposition not in ('charged', 'unassigned', 'free', 'trial')
    or (p_disposition = 'charged') <> (p_package_id is not null)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select * into current_session from public.trainer_finance_sessions session
  where session.id = p_session_id and session.trainer_id = actor_id
    and session.voided_at is null;
  if current_session.id is null then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    current_session.trainer_id::text || ':' || current_session.client_id::text, 0
  ));
  if p_disposition = 'charged' and not exists (
    select 1 from public.trainer_finance_packages package
    join public.workouts workout on workout.id = current_session.workout_id
    where package.id = p_package_id and package.trainer_id = actor_id
      and package.client_id = current_session.client_id and package.closed_at is null
      and package.starts_on <= workout.workout_date
      and (package.ends_on is null or package.ends_on >= workout.workout_date)
      and package.opening_used_sessions + (
        select count(*) from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null and used.id <> current_session.id
      ) < package.sessions_total
  ) then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.trainer_finance_sessions session
  set disposition = p_disposition,
    package_id = case when p_disposition = 'charged' then p_package_id else null end,
    comment = nullif(btrim(coalesce(p_comment, '')), ''),
    version = session.version + 1
  where session.id = p_session_id and session.trainer_id = actor_id
    and session.version = p_expected_version and session.voided_at is null
  returning * into updated_session;
  if updated_session.id is null then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  return jsonb_build_object(
    'id', updated_session.id, 'packageId', updated_session.package_id,
    'workoutId', updated_session.workout_id,
    'workoutDate', (select workout.workout_date from public.workouts workout where workout.id = updated_session.workout_id),
    'disposition', updated_session.disposition, 'source', updated_session.source,
    'comment', updated_session.comment, 'voidedAt', updated_session.voided_at,
    'voidReason', updated_session.void_reason, 'version', updated_session.version,
    'createdAt', updated_session.created_at, 'updatedAt', updated_session.updated_at
  );
end;
$$;

revoke all on function app_private.sync_trainer_finance_workout(),
  public.update_trainer_finance_session(uuid, bigint, text, uuid, text) from public;
grant execute on function public.update_trainer_finance_session(uuid, bigint, text, uuid, text) to fit_api;

-- Down Migration

revoke execute on function public.update_trainer_finance_session(uuid, bigint, text, uuid, text) from fit_api;
drop function public.update_trainer_finance_session(uuid, bigint, text, uuid, text);
drop trigger sync_trainer_finance_workout on public.workouts;
drop function app_private.sync_trainer_finance_workout();
create or replace function public.list_trainer_finance_client(p_client_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if not app_private.trainer_finance_has_connection(actor_id, p_client_id)
    and not exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'clientId', p_client_id,
    'packages', coalesce((
      select jsonb_agg(app_private.trainer_finance_package_payload(package.id)
        order by package.starts_on desc, package.created_at desc)
      from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id, 'packageId', payment.package_id,
        'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
        'source', payment.source, 'comment', payment.comment,
        'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
        'version', payment.version, 'createdAt', payment.created_at,
        'updatedAt', payment.updated_at
      ) order by payment.received_on desc, payment.created_at desc)
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.client_id = p_client_id
    ), '[]'::jsonb)
  );
end;
$$;
alter table public.trainer_finance_sessions drop column version;
