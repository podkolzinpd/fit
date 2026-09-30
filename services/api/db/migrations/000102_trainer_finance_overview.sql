-- Up Migration

create function public.list_trainer_finance_overview(p_month date)
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

revoke all on function public.list_trainer_finance_overview(date) from public;
grant execute on function public.list_trainer_finance_overview(date) to fit_api;

-- Down Migration

revoke execute on function public.list_trainer_finance_overview(date) from fit_api;
drop function public.list_trainer_finance_overview(date);
