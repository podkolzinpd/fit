-- Up Migration

create or replace function public.list_trainer_finance_overview(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  result jsonb;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  with settings as (
    select (now() at time zone profile.timezone)::date as today,
      p_month as month_start,
      (p_month + interval '1 month')::date as month_end
    from public.profiles profile where profile.id = actor_id
  ), client_scope as (
    select client.id, client.full_name, client.archived_at
    from public.clients client
    where client.trainer_id = actor_id
      or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = client.id and membership.trainer_id = actor_id
      )
    union
    select client.id, client.full_name, client.archived_at
    from public.clients client
    join public.trainer_finance_packages package on package.client_id = client.id
    where package.trainer_id = actor_id
  ), package_state as (
    select package.*,
      greatest(package.sessions_total - package.opening_used_sessions
        - coalesce(session_totals.used_sessions, 0), 0)::integer as sessions_remaining,
      greatest(package.price_cents - coalesce(payment_totals.paid_cents, 0), 0)::bigint as due_cents,
      package.closed_at is null
        and package.starts_on <= settings.today
        and (package.ends_on is null or package.ends_on >= settings.today)
        and package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) < package.sessions_total
        as is_active,
      package.closed_at is null
        and package.starts_on > settings.today
        and package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) < package.sessions_total
        as is_upcoming,
      package.closed_at is null
        and package.payment_due_on is not null
        and package.payment_due_on < settings.today
        and package.price_cents > coalesce(payment_totals.paid_cents, 0)
        as is_overdue
    from public.trainer_finance_packages package
    cross join settings
    left join lateral (
      select count(*)::integer as used_sessions
      from public.trainer_finance_sessions session
      where session.package_id = package.id and session.disposition = 'charged'
        and session.voided_at is null
    ) session_totals on true
    left join lateral (
      select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
      from public.trainer_finance_payments payment
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.trainer_id = actor_id
  ), client_state as (
    select scope.id, scope.full_name, scope.archived_at,
      count(package.id) filter (where package.is_active)::integer as active_package_count,
      count(package.id) filter (where package.is_upcoming)::integer as upcoming_package_count,
      case when count(package.id) filter (where package.is_active) = 1
        then max(package.sessions_remaining) filter (where package.is_active)
        else null end as sessions_remaining,
      coalesce(sum(package.due_cents) filter (where package.closed_at is null), 0)::bigint as due_cents,
      coalesce(bool_or(package.is_overdue), false) as overdue,
      coalesce(bool_or(package.is_active and package.sessions_remaining between 1 and 2), false) as low_sessions,
      (select count(*)::integer
       from public.trainer_finance_sessions session
       where session.trainer_id = actor_id and session.client_id = scope.id
         and session.disposition = 'unassigned' and session.voided_at is null) as unassigned_sessions,
      (select coalesce(sum(payment.amount_cents), 0)::bigint
       from public.trainer_finance_payments payment cross join settings
       where payment.trainer_id = actor_id and payment.client_id = scope.id
         and payment.voided_at is null and payment.received_on >= settings.month_start
         and payment.received_on < settings.month_end) as received_cents
    from client_scope scope
    left join package_state package on package.client_id = scope.id
    group by scope.id, scope.full_name, scope.archived_at
  ), normalized as (
    select state.*,
      state.overdue or state.low_sessions or state.unassigned_sessions > 0
        or state.active_package_count > 1 as needs_attention
    from client_state state
  )
  select jsonb_build_object(
    'month', to_char(settings.month_start, 'YYYY-MM'),
    'receivedCents', coalesce((
      select sum(payment.amount_cents)::bigint
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= settings.month_start and payment.received_on < settings.month_end
    ), 0),
    'dueCents', coalesce((
      select sum(package.due_cents)::bigint from package_state package
      where package.closed_at is null
    ), 0),
    'attentionCount', (select count(*)::integer from normalized where needs_attention),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', state.id, 'fullName', state.full_name,
        'archivedAt', state.archived_at,
        'receivedCents', state.received_cents, 'dueCents', state.due_cents,
        'activePackageCount', state.active_package_count,
        'upcomingPackageCount', state.upcoming_package_count,
        'sessionsRemaining', state.sessions_remaining,
        'overdue', state.overdue, 'lowSessions', state.low_sessions,
        'unassignedSessions', state.unassigned_sessions,
        'needsAttention', state.needs_attention
      ) order by state.needs_attention desc, state.full_name, state.id)
      from normalized state
    ), '[]'::jsonb)
  ) into result
  from settings;
  return result;
end;
$$;

grant execute on function public.list_trainer_finance_overview(date) to fit_api;

create or replace function public.create_trainer_finance_package(
  p_client_id uuid,
  p_title text,
  p_sessions_total integer,
  p_opening_used_sessions integer,
  p_price_cents bigint,
  p_opening_paid_cents bigint,
  p_starts_on date,
  p_ends_on date,
  p_payment_due_on date,
  p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  package_id uuid;
begin
  if not app_private.trainer_finance_has_connection(actor_id, p_client_id) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
    or p_sessions_total not between 1 and 10000
    or p_opening_used_sessions not between 0 and p_sessions_total
    or p_price_cents not between 0 and 100000000000
    or p_opening_paid_cents not between 0 and 100000000000
    or p_opening_paid_cents > p_price_cents
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  insert into public.trainer_finance_packages (
    trainer_id, client_id, title, sessions_total, opening_used_sessions,
    price_cents, starts_on, ends_on, payment_due_on, comment
  ) values (
    actor_id, p_client_id, btrim(p_title), p_sessions_total,
    p_opening_used_sessions, p_price_cents, p_starts_on, p_ends_on,
    p_payment_due_on, nullif(btrim(coalesce(p_comment, '')), '')
  ) returning id into package_id;

  if p_opening_paid_cents > 0 then
    insert into public.trainer_finance_payments (
      package_id, trainer_id, client_id, amount_cents, received_on, source,
      comment
    ) values (
      package_id, actor_id, p_client_id, p_opening_paid_cents, p_starts_on,
      'opening', 'Начальный оплаченный остаток'
    );
  end if;

  return app_private.trainer_finance_package_payload(package_id);
end;
$$;

create function public.update_trainer_finance_session_details(
  p_session_id uuid,
  p_expected_version bigint,
  p_disposition text,
  p_package_id uuid,
  p_comment text,
  p_workout_date date
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  current_session public.trainer_finance_sessions;
  updated_session public.trainer_finance_sessions;
begin
  if p_workout_date is null
    or p_disposition not in ('charged', 'unassigned', 'free', 'trial')
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
    where package.id = p_package_id and package.trainer_id = actor_id
      and package.client_id = current_session.client_id and package.closed_at is null
      and package.starts_on <= p_workout_date
      and (package.ends_on is null or package.ends_on >= p_workout_date)
      and package.opening_used_sessions + (
        select count(*) from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null and used.id <> current_session.id
      ) < package.sessions_total
  ) then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.workouts workout set workout_date = p_workout_date
  where workout.id = current_session.workout_id
    and workout.trainer_id = actor_id and workout.client_id = current_session.client_id;
  if not found then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
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
    'workoutId', updated_session.workout_id, 'workoutDate', p_workout_date,
    'disposition', updated_session.disposition, 'source', updated_session.source,
    'comment', updated_session.comment, 'voidedAt', updated_session.voided_at,
    'voidReason', updated_session.void_reason, 'version', updated_session.version,
    'createdAt', updated_session.created_at, 'updatedAt', updated_session.updated_at
  );
end;
$$;

revoke all on function public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date) from public;
grant execute on function public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date) to fit_api;

-- Down Migration

revoke execute on function public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date) from fit_api;
drop function public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date);

create or replace function public.create_trainer_finance_package(
  p_client_id uuid,
  p_title text,
  p_sessions_total integer,
  p_opening_used_sessions integer,
  p_price_cents bigint,
  p_opening_paid_cents bigint,
  p_starts_on date,
  p_ends_on date,
  p_payment_due_on date,
  p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  package_id uuid;
begin
  if not app_private.trainer_finance_has_connection(actor_id, p_client_id) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
    or p_sessions_total not between 1 and 10000
    or p_opening_used_sessions not between 0 and p_sessions_total
    or p_price_cents not between 0 and 100000000000
    or p_opening_paid_cents not between 0 and 100000000000
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  insert into public.trainer_finance_packages (
    trainer_id, client_id, title, sessions_total, opening_used_sessions,
    price_cents, starts_on, ends_on, payment_due_on, comment
  ) values (
    actor_id, p_client_id, btrim(p_title), p_sessions_total,
    p_opening_used_sessions, p_price_cents, p_starts_on, p_ends_on,
    p_payment_due_on, nullif(btrim(coalesce(p_comment, '')), '')
  ) returning id into package_id;

  if p_opening_paid_cents > 0 then
    insert into public.trainer_finance_payments (
      package_id, trainer_id, client_id, amount_cents, received_on, source,
      comment
    ) values (
      package_id, actor_id, p_client_id, p_opening_paid_cents, p_starts_on,
      'opening', 'Начальный оплаченный остаток'
    );
  end if;

  return app_private.trainer_finance_package_payload(package_id);
end;
$$;

create or replace function public.list_trainer_finance_overview(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  result jsonb;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  with settings as (
    select (now() at time zone profile.timezone)::date as today,
      p_month as month_start,
      (p_month + interval '1 month')::date as month_end
    from public.profiles profile where profile.id = actor_id
  ), client_scope as (
    select client.id, client.full_name, client.archived_at
    from public.clients client
    where client.trainer_id = actor_id
      or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = client.id and membership.trainer_id = actor_id
      )
    union
    select client.id, client.full_name, client.archived_at
    from public.clients client
    join public.trainer_finance_packages package on package.client_id = client.id
    where package.trainer_id = actor_id
  ), package_state as (
    select package.*,
      greatest(package.sessions_total - package.opening_used_sessions
        - coalesce(session_totals.used_sessions, 0), 0)::integer as sessions_remaining,
      greatest(package.price_cents - coalesce(payment_totals.paid_cents, 0), 0)::bigint as due_cents,
      package.closed_at is null
        and package.starts_on <= settings.today
        and (package.ends_on is null or package.ends_on >= settings.today)
        and package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) < package.sessions_total
        as is_active,
      package.closed_at is null
        and package.payment_due_on is not null
        and package.payment_due_on < settings.today
        and package.price_cents > coalesce(payment_totals.paid_cents, 0)
        as is_overdue
    from public.trainer_finance_packages package
    cross join settings
    left join lateral (
      select count(*)::integer as used_sessions
      from public.trainer_finance_sessions session
      where session.package_id = package.id and session.disposition = 'charged'
        and session.voided_at is null
    ) session_totals on true
    left join lateral (
      select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
      from public.trainer_finance_payments payment
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.trainer_id = actor_id
  ), client_state as (
    select scope.id, scope.full_name, scope.archived_at,
      count(package.id) filter (where package.is_active)::integer as active_package_count,
      case when count(package.id) filter (where package.is_active) = 1
        then max(package.sessions_remaining) filter (where package.is_active)
        else null end as sessions_remaining,
      coalesce(sum(package.due_cents) filter (where package.closed_at is null), 0)::bigint as due_cents,
      coalesce(bool_or(package.is_overdue), false) as overdue,
      coalesce(bool_or(package.is_active and package.sessions_remaining between 1 and 2), false) as low_sessions,
      (select count(*)::integer
       from public.trainer_finance_sessions session
       where session.trainer_id = actor_id and session.client_id = scope.id
         and session.disposition = 'unassigned' and session.voided_at is null) as unassigned_sessions,
      (select coalesce(sum(payment.amount_cents), 0)::bigint
       from public.trainer_finance_payments payment cross join settings
       where payment.trainer_id = actor_id and payment.client_id = scope.id
         and payment.voided_at is null and payment.received_on >= settings.month_start
         and payment.received_on < settings.month_end) as received_cents
    from client_scope scope
    left join package_state package on package.client_id = scope.id
    group by scope.id, scope.full_name, scope.archived_at
  ), normalized as (
    select state.*,
      state.overdue or state.low_sessions or state.unassigned_sessions > 0
        or state.active_package_count > 1 as needs_attention
    from client_state state
  )
  select jsonb_build_object(
    'month', to_char(settings.month_start, 'YYYY-MM'),
    'receivedCents', coalesce((
      select sum(payment.amount_cents)::bigint
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= settings.month_start and payment.received_on < settings.month_end
    ), 0),
    'dueCents', coalesce((
      select sum(package.due_cents)::bigint from package_state package
      where package.closed_at is null
    ), 0),
    'attentionCount', (select count(*)::integer from normalized where needs_attention),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', state.id, 'fullName', state.full_name,
        'archivedAt', state.archived_at,
        'receivedCents', state.received_cents, 'dueCents', state.due_cents,
        'activePackageCount', state.active_package_count,
        'sessionsRemaining', state.sessions_remaining,
        'overdue', state.overdue, 'lowSessions', state.low_sessions,
        'unassignedSessions', state.unassigned_sessions,
        'needsAttention', state.needs_attention
      ) order by state.needs_attention desc, state.full_name, state.id)
      from normalized state
    ), '[]'::jsonb)
  ) into result
  from settings;
  return result;
end;
$$;

grant execute on function public.list_trainer_finance_overview(date) to fit_api;
