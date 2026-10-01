-- Up Migration

create function public.list_client_finance_self()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  client_id_value uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_id is null or actor_role <> 'client' then
    raise exception 'trainer_finance_forbidden' using errcode = 'PT403';
  end if;

  select client.id into client_id_value
  from public.clients client
  where client.auth_user_id = actor_id
    and client.merged_into_client_id is null
    and client.archived_at is null;

  if client_id_value is null then
    return jsonb_build_object('trainers', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'trainers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trainerId', scope.trainer_id,
        'trainerName', coalesce(
          nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          'Тренер'
        ),
        'packages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', state.id,
            'title', state.title,
            'sessionsTotal', state.sessions_total,
            'sessionsUsed', least(state.sessions_total, state.sessions_used),
            'sessionsRemaining', greatest(state.sessions_total - state.sessions_used, 0),
            'priceCents', state.price_cents,
            'paidCents', state.paid_cents,
            'dueCents', greatest(state.price_cents - state.paid_cents, 0),
            'startsOn', state.starts_on,
            'endsOn', state.ends_on,
            'paymentDueOn', state.payment_due_on,
            'packageStatus', case
              when state.closed_at is not null then 'closed'
              when state.sessions_used >= state.sessions_total then 'completed'
              when state.ends_on is not null and state.ends_on < state.today then 'expired'
              when state.starts_on > state.today then 'upcoming'
              else 'active'
            end,
            'paymentStatus', case
              when state.paid_cents >= state.price_cents then 'paid'
              when state.payment_due_on is not null and state.payment_due_on < state.today then 'overdue'
              when state.paid_cents > 0 then 'partial'
              else 'unpaid'
            end
          ) order by state.starts_on desc, state.created_at desc)
          from (
            select package.*,
              package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) as sessions_used,
              coalesce(payment_totals.paid_cents, 0)::bigint as paid_cents,
              (now() at time zone profile.timezone)::date as today
            from public.trainer_finance_packages package
            left join lateral (
              select count(*)::integer as used_sessions
              from public.trainer_finance_sessions session
              where session.package_id = package.id
                and session.disposition = 'charged'
                and session.voided_at is null
            ) session_totals on true
            left join lateral (
              select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
              from public.trainer_finance_payments payment
              where payment.package_id = package.id
                and payment.voided_at is null
            ) payment_totals on true
            where package.client_id = client_id_value
              and package.trainer_id = scope.trainer_id
          ) state
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', payment.id,
            'packageId', payment.package_id,
            'amountCents', payment.amount_cents,
            'receivedOn', payment.received_on
          ) order by payment.received_on desc, payment.created_at desc)
          from public.trainer_finance_payments payment
          where payment.client_id = client_id_value
            and payment.trainer_id = scope.trainer_id
            and payment.voided_at is null
        ), '[]'::jsonb)
      ) order by profile.first_name nulls last, profile.last_name nulls last, scope.trainer_id)
      from (
        select distinct package.trainer_id
        from public.trainer_finance_packages package
        where package.client_id = client_id_value
      ) scope
      join public.profiles profile on profile.id = scope.trainer_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_client_finance_self() from public;
grant execute on function public.list_client_finance_self() to fit_api;

-- Down Migration

revoke execute on function public.list_client_finance_self() from fit_api;
drop function public.list_client_finance_self();
