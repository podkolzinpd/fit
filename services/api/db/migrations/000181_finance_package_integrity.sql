-- Up Migration

-- Serialize service edits with existing workout/session accounting commands.
create or replace function public.update_trainer_finance_service(
  p_package_id uuid,
  p_expected_version bigint,
  p_kind text,
  p_title text,
  p_sessions_total integer,
  p_price_cents bigint,
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
  current_kind text;
  current_starts_on date;
  current_ends_on date;
  client_id_value uuid;
  used_sessions integer;
begin
  select package.client_id into client_id_value
  from public.trainer_finance_packages package
  where package.id = p_package_id and package.trainer_id = actor_id;
  if client_id_value is null then
    raise exception 'trainer_finance_package_not_found' using errcode = 'PT404';
  end if;
  -- Workout commands lock their workout first, then this ledger. Do not lock
  -- workouts here: a service edit only reads their committed dates.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor_id::text || ':' || client_id_value::text, 0
  ));
  select package.kind, package.starts_on, package.ends_on
  into current_kind, current_starts_on, current_ends_on
  from public.trainer_finance_packages package
  where package.id = p_package_id and package.trainer_id = actor_id
    and package.version = p_expected_version
  for update;
  if not found then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  select package.opening_used_sessions + count(session.id)::integer
  into used_sessions
  from public.trainer_finance_packages package
  left join public.trainer_finance_sessions session
    on session.package_id = package.id
   and session.disposition = 'charged' and session.voided_at is null
  where package.id = p_package_id and package.trainer_id = actor_id
  group by package.opening_used_sessions;
  if p_kind is null or p_kind <> current_kind
    or nullif(btrim(coalesce(p_title, '')), '') is null
    or (p_kind = 'session_pack' and p_sessions_total not between greatest(used_sessions, 1) and 10000)
    or (p_kind = 'online_coaching' and (p_sessions_total <> 0 or p_ends_on is null))
    or p_price_cents not between 0 and 100000000000
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  -- Do not turn an existing period discrepancy into a ban on unrelated edits.
  -- Only a requested period change must contain every currently charged date.
  if p_kind = 'session_pack'
    and (p_starts_on is distinct from current_starts_on or p_ends_on is distinct from current_ends_on)
    and exists (
    select 1 from public.trainer_finance_sessions session
    join public.workouts workout on workout.id = session.workout_id
    where session.package_id = p_package_id and session.trainer_id = actor_id
      and session.disposition = 'charged' and session.voided_at is null
      and (workout.workout_date < p_starts_on
        or (p_ends_on is not null and workout.workout_date > p_ends_on))
  ) then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  update public.trainer_finance_packages package
  set title = btrim(p_title), sessions_total = p_sessions_total,
    price_cents = p_price_cents, starts_on = p_starts_on,
    ends_on = p_ends_on, payment_due_on = p_payment_due_on,
    comment = nullif(btrim(coalesce(p_comment, '')), ''),
    version = package.version + 1
  where package.id = p_package_id and package.trainer_id = actor_id
    and package.version = p_expected_version;
  if not found then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  return app_private.trainer_finance_package_payload_v2(p_package_id);
end;
$$;

create or replace function app_private.trainer_finance_package_payload_v2(p_package_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with package_state as (
    select package.*,
      package.opening_used_sessions
        + coalesce(session_totals.used_sessions, 0) as sessions_used,
      coalesce(payment_totals.paid_cents, 0) as paid_cents,
      (now() at time zone profile.timezone)::date as today
    from public.trainer_finance_packages package
    join public.profiles profile on profile.id = package.trainer_id
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
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.id = p_package_id and package.trainer_id = auth.uid()
  )
  select jsonb_build_object(
    'id', id,
    'clientId', client_id,
    'trainerId', trainer_id,
    'kind', kind,
    'title', title,
    'sessionsTotal', sessions_total,
    'sessionsUsed', case when kind = 'session_pack'
      then sessions_used else 0 end,
    'sessionsRemaining', case when kind = 'session_pack'
      then greatest(sessions_total - sessions_used, 0) else 0 end,
    'priceCents', price_cents,
    'paidCents', paid_cents,
    'dueCents', greatest(price_cents - paid_cents, 0),
    'startsOn', starts_on,
    'endsOn', ends_on,
    'paymentDueOn', payment_due_on,
    'comment', comment,
    'packageStatus', case
      when closed_at is not null then 'closed'
      when kind = 'session_pack' and sessions_used >= sessions_total then 'completed'
      when ends_on is not null and ends_on < today then 'expired'
      when starts_on > today then 'upcoming'
      else 'active'
    end,
    'paymentStatus', case
      when paid_cents >= price_cents then 'paid'
      when payment_due_on is not null and payment_due_on < today then 'overdue'
      when paid_cents > 0 then 'partial'
      else 'unpaid'
    end,
    'closedAt', closed_at,
    'version', version,
    'createdAt', created_at,
    'updatedAt', updated_at
  )
  from package_state
$$;

create or replace function public.list_client_finance_self_v2()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  client_id_value uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
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
            'id', state.id, 'kind', state.kind, 'title', state.title,
            'sessionsTotal', state.sessions_total,
            'sessionsUsed', case when state.kind = 'session_pack'
              then state.sessions_used else 0 end,
            'sessionsRemaining', case when state.kind = 'session_pack'
              then greatest(state.sessions_total - state.sessions_used, 0) else 0 end,
            'priceCents', state.price_cents, 'paidCents', state.paid_cents,
            'dueCents', greatest(state.price_cents - state.paid_cents, 0),
            'startsOn', state.starts_on, 'endsOn', state.ends_on,
            'paymentDueOn', state.payment_due_on,
            'packageStatus', case
              when state.closed_at is not null then 'closed'
              when state.kind = 'session_pack' and state.sessions_used >= state.sessions_total then 'completed'
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
              where payment.package_id = package.id and payment.voided_at is null
            ) payment_totals on true
            where package.client_id = client_id_value
              and package.trainer_id = scope.trainer_id
          ) state
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', payment.id, 'packageId', payment.package_id,
            'amountCents', payment.amount_cents, 'receivedOn', payment.received_on
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



-- Down Migration

create or replace function public.update_trainer_finance_service(
  p_package_id uuid,
  p_expected_version bigint,
  p_kind text,
  p_title text,
  p_sessions_total integer,
  p_price_cents bigint,
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
  current_kind text;
  used_sessions integer;
begin
  select package.kind,
    package.opening_used_sessions + count(session.id)::integer
  into current_kind, used_sessions
  from public.trainer_finance_packages package
  left join public.trainer_finance_sessions session
    on session.package_id = package.id
   and session.disposition = 'charged'
   and session.voided_at is null
  where package.id = p_package_id and package.trainer_id = actor_id
  group by package.kind, package.opening_used_sessions;
  if current_kind is null then
    raise exception 'trainer_finance_package_not_found' using errcode = 'PT404';
  end if;
  if p_kind is null or p_kind <> current_kind
    or nullif(btrim(coalesce(p_title, '')), '') is null
    or (p_kind = 'session_pack' and p_sessions_total not between greatest(used_sessions, 1) and 10000)
    or (p_kind = 'online_coaching' and (p_sessions_total <> 0 or p_ends_on is null))
    or p_price_cents not between 0 and 100000000000
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  update public.trainer_finance_packages package
  set title = btrim(p_title), sessions_total = p_sessions_total,
    price_cents = p_price_cents, starts_on = p_starts_on,
    ends_on = p_ends_on, payment_due_on = p_payment_due_on,
    comment = nullif(btrim(coalesce(p_comment, '')), ''),
    version = package.version + 1
  where package.id = p_package_id and package.trainer_id = actor_id
    and package.version = p_expected_version;
  if not found then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  return app_private.trainer_finance_package_payload_v2(p_package_id);
end;
$$;

create or replace function app_private.trainer_finance_package_payload_v2(p_package_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with package_state as (
    select package.*,
      package.opening_used_sessions
        + coalesce(session_totals.used_sessions, 0) as sessions_used,
      coalesce(payment_totals.paid_cents, 0) as paid_cents,
      (now() at time zone profile.timezone)::date as today
    from public.trainer_finance_packages package
    join public.profiles profile on profile.id = package.trainer_id
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
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.id = p_package_id and package.trainer_id = auth.uid()
  )
  select jsonb_build_object(
    'id', id,
    'clientId', client_id,
    'trainerId', trainer_id,
    'kind', kind,
    'title', title,
    'sessionsTotal', sessions_total,
    'sessionsUsed', case when kind = 'session_pack'
      then least(sessions_total, sessions_used) else 0 end,
    'sessionsRemaining', case when kind = 'session_pack'
      then greatest(sessions_total - sessions_used, 0) else 0 end,
    'priceCents', price_cents,
    'paidCents', paid_cents,
    'dueCents', greatest(price_cents - paid_cents, 0),
    'startsOn', starts_on,
    'endsOn', ends_on,
    'paymentDueOn', payment_due_on,
    'comment', comment,
    'packageStatus', case
      when closed_at is not null then 'closed'
      when kind = 'session_pack' and sessions_used >= sessions_total then 'completed'
      when ends_on is not null and ends_on < today then 'expired'
      when starts_on > today then 'upcoming'
      else 'active'
    end,
    'paymentStatus', case
      when paid_cents >= price_cents then 'paid'
      when payment_due_on is not null and payment_due_on < today then 'overdue'
      when paid_cents > 0 then 'partial'
      else 'unpaid'
    end,
    'closedAt', closed_at,
    'version', version,
    'createdAt', created_at,
    'updatedAt', updated_at
  )
  from package_state
$$;

create or replace function public.list_client_finance_self_v2()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  client_id_value uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
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
            'id', state.id, 'kind', state.kind, 'title', state.title,
            'sessionsTotal', state.sessions_total,
            'sessionsUsed', case when state.kind = 'session_pack'
              then least(state.sessions_total, state.sessions_used) else 0 end,
            'sessionsRemaining', case when state.kind = 'session_pack'
              then greatest(state.sessions_total - state.sessions_used, 0) else 0 end,
            'priceCents', state.price_cents, 'paidCents', state.paid_cents,
            'dueCents', greatest(state.price_cents - state.paid_cents, 0),
            'startsOn', state.starts_on, 'endsOn', state.ends_on,
            'paymentDueOn', state.payment_due_on,
            'packageStatus', case
              when state.closed_at is not null then 'closed'
              when state.kind = 'session_pack' and state.sessions_used >= state.sessions_total then 'completed'
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
              where payment.package_id = package.id and payment.voided_at is null
            ) payment_totals on true
            where package.client_id = client_id_value
              and package.trainer_id = scope.trainer_id
          ) state
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', payment.id, 'packageId', payment.package_id,
            'amountCents', payment.amount_cents, 'receivedOn', payment.received_on
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
