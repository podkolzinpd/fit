-- Up Migration

alter table public.trainer_finance_packages
  add column kind text not null default 'session_pack';

alter table public.trainer_finance_packages
  drop constraint trainer_finance_packages_sessions_valid,
  add constraint trainer_finance_packages_kind_valid check (
    kind in ('session_pack', 'online_coaching')
  ),
  add constraint trainer_finance_packages_sessions_valid check (
    (kind = 'session_pack'
      and sessions_total between 1 and 10000
      and opening_used_sessions between 0 and sessions_total)
    or (kind = 'online_coaching'
      and sessions_total = 0
      and opening_used_sessions = 0
      and ends_on is not null)
  );

create function app_private.trainer_finance_package_payload_v2(p_package_id uuid)
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

create function public.create_trainer_finance_service(
  p_client_id uuid,
  p_kind text,
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
  if p_kind is null or p_kind not in ('session_pack', 'online_coaching')
    or nullif(btrim(coalesce(p_title, '')), '') is null
    or (p_kind = 'session_pack' and (
      p_sessions_total not between 1 and 10000
      or p_opening_used_sessions not between 0 and p_sessions_total
    ))
    or (p_kind = 'online_coaching' and (
      p_sessions_total <> 0 or p_opening_used_sessions <> 0 or p_ends_on is null
    ))
    or p_price_cents not between 0 and 100000000000
    or p_opening_paid_cents not between 0 and p_price_cents
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  insert into public.trainer_finance_packages (
    trainer_id, client_id, kind, title, sessions_total,
    opening_used_sessions, price_cents, starts_on, ends_on,
    payment_due_on, comment
  ) values (
    actor_id, p_client_id, p_kind, btrim(p_title), p_sessions_total,
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

  return app_private.trainer_finance_package_payload_v2(package_id);
end;
$$;

create function public.update_trainer_finance_service(
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

create function public.list_trainer_finance_client_v2(p_client_id uuid)
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
      select jsonb_agg(app_private.trainer_finance_package_payload_v2(package.id)
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

create function public.list_client_finance_self_v2()
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

create function public.list_trainer_finance_overview_v2(p_month date)
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
      p_month as month_start, (p_month + interval '1 month')::date as month_end
    from public.profiles profile where profile.id = actor_id
  ), client_scope as (
    select client.id, client.full_name, client.archived_at
    from public.clients client
    where client.trainer_id = actor_id or exists (
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
      case when package.kind = 'session_pack' then greatest(
        package.sessions_total - package.opening_used_sessions
          - coalesce(session_totals.used_sessions, 0), 0
      )::integer else null end as sessions_remaining,
      greatest(package.price_cents - coalesce(payment_totals.paid_cents, 0), 0)::bigint as due_cents,
      package.closed_at is null and package.starts_on <= settings.today
        and (package.ends_on is null or package.ends_on >= settings.today)
        and (package.kind = 'online_coaching' or package.opening_used_sessions
          + coalesce(session_totals.used_sessions, 0) < package.sessions_total) as is_active,
      package.closed_at is null and package.starts_on > settings.today
        and (package.kind = 'online_coaching' or package.opening_used_sessions
          + coalesce(session_totals.used_sessions, 0) < package.sessions_total) as is_upcoming,
      package.closed_at is null and package.payment_due_on is not null
        and package.payment_due_on < settings.today
        and package.price_cents > coalesce(payment_totals.paid_cents, 0) as is_overdue
    from public.trainer_finance_packages package cross join settings
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
      case when count(package.id) filter (
          where package.is_active and package.kind = 'session_pack'
        ) = 1 then max(package.sessions_remaining) filter (
          where package.is_active and package.kind = 'session_pack'
        ) else null end as sessions_remaining,
      count(package.id) filter (
        where package.is_active and package.kind = 'session_pack'
      )::integer as active_session_package_count,
      coalesce(sum(package.due_cents) filter (where package.closed_at is null), 0)::bigint as due_cents,
      coalesce(bool_or(package.is_overdue), false) as overdue,
      coalesce(bool_or(package.is_active and package.kind = 'session_pack'
        and package.sessions_remaining between 1 and 2), false) as low_sessions,
      (select count(*)::integer from public.trainer_finance_sessions session
       where session.trainer_id = actor_id and session.client_id = scope.id
         and session.disposition = 'unassigned' and session.voided_at is null) as unassigned_sessions,
      (select coalesce(sum(payment.amount_cents), 0)::bigint
       from public.trainer_finance_payments payment cross join settings
       where payment.trainer_id = actor_id and payment.client_id = scope.id
         and payment.voided_at is null and payment.received_on >= settings.month_start
         and payment.received_on < settings.month_end) as received_cents
    from client_scope scope left join package_state package on package.client_id = scope.id
    group by scope.id, scope.full_name, scope.archived_at
  ), normalized as (
    select state.*, state.overdue or state.low_sessions
      or state.unassigned_sessions > 0 or state.active_session_package_count > 1 as needs_attention
    from client_state state
  )
  select jsonb_build_object(
    'month', to_char(settings.month_start, 'YYYY-MM'),
    'receivedCents', coalesce((select sum(payment.amount_cents)::bigint
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= settings.month_start and payment.received_on < settings.month_end), 0),
    'dueCents', coalesce((select sum(package.due_cents)::bigint
      from package_state package where package.closed_at is null), 0),
    'attentionCount', (select count(*)::integer from normalized where needs_attention),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
      'clientId', state.id, 'fullName', state.full_name, 'archivedAt', state.archived_at,
      'receivedCents', state.received_cents, 'dueCents', state.due_cents,
      'activePackageCount', state.active_package_count,
      'upcomingPackageCount', state.upcoming_package_count,
      'sessionsRemaining', state.sessions_remaining, 'overdue', state.overdue,
      'lowSessions', state.low_sessions, 'unassignedSessions', state.unassigned_sessions,
      'needsAttention', state.needs_attention
    ) order by state.needs_attention desc, state.full_name, state.id) from normalized state), '[]'::jsonb)
  ) into result from settings;
  return result;
end;
$$;

create function public.update_trainer_finance_session_details_v2(
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
    and workout.trainer_id = actor_id and workout.client_id = current_session.client_id;
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

revoke execute on function public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text),
  public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date) from fit_api;
revoke all on function app_private.trainer_finance_package_payload_v2(uuid),
  public.create_trainer_finance_service(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_service(uuid, bigint, text, text, integer, bigint, date, date, date, text),
  public.list_trainer_finance_client_v2(uuid), public.list_client_finance_self_v2(),
  public.list_trainer_finance_overview_v2(date),
  public.update_trainer_finance_session_details_v2(uuid, bigint, text, uuid, text, date) from public;
grant execute on function public.create_trainer_finance_service(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_service(uuid, bigint, text, text, integer, bigint, date, date, date, text),
  public.list_trainer_finance_client_v2(uuid), public.list_client_finance_self_v2(),
  public.list_trainer_finance_overview_v2(date),
  public.update_trainer_finance_session_details_v2(uuid, bigint, text, uuid, text, date) to fit_api;

-- Down Migration

revoke execute on function public.create_trainer_finance_service(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_service(uuid, bigint, text, text, integer, bigint, date, date, date, text),
  public.list_trainer_finance_client_v2(uuid), public.list_client_finance_self_v2(),
  public.list_trainer_finance_overview_v2(date),
  public.update_trainer_finance_session_details_v2(uuid, bigint, text, uuid, text, date) from fit_api;
drop function public.update_trainer_finance_session_details_v2(uuid, bigint, text, uuid, text, date);
drop function public.list_trainer_finance_overview_v2(date);
drop function public.list_client_finance_self_v2();
drop function public.list_trainer_finance_client_v2(uuid);
drop function public.update_trainer_finance_service(uuid, bigint, text, text, integer, bigint, date, date, date, text);
drop function public.create_trainer_finance_service(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text);
drop function app_private.trainer_finance_package_payload_v2(uuid);

grant execute on function public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text),
  public.update_trainer_finance_session_details(uuid, bigint, text, uuid, text, date) to fit_api;

alter table public.trainer_finance_packages
  drop constraint trainer_finance_packages_sessions_valid,
  drop constraint trainer_finance_packages_kind_valid;
delete from public.trainer_finance_events event
where (event.entity_type = 'package' and event.entity_id in (
  select package.id from public.trainer_finance_packages package
  where package.kind = 'online_coaching'
)) or (event.entity_type = 'payment' and event.entity_id in (
  select payment.id from public.trainer_finance_payments payment
  join public.trainer_finance_packages package on package.id = payment.package_id
  where package.kind = 'online_coaching'
)) or (event.entity_type = 'session' and event.entity_id in (
  select session.id from public.trainer_finance_sessions session
  join public.trainer_finance_packages package on package.id = session.package_id
  where package.kind = 'online_coaching'
));
delete from public.trainer_finance_sessions session using public.trainer_finance_packages package
where session.package_id = package.id and package.kind = 'online_coaching';
delete from public.trainer_finance_payments payment using public.trainer_finance_packages package
where payment.package_id = package.id and package.kind = 'online_coaching';
delete from public.trainer_finance_packages where kind = 'online_coaching';
alter table public.trainer_finance_packages drop column kind;
alter table public.trainer_finance_packages
  add constraint trainer_finance_packages_sessions_valid check (
    sessions_total between 1 and 10000
    and opening_used_sessions between 0 and sessions_total
  );

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
  if new.created_by is not null and new.created_by <> new.trainer_id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.trainer_id::text || ':' || new.client_id::text, 0
  ));
  if exists (select 1 from public.trainer_finance_sessions session
    where session.workout_id = new.id and session.voided_at is null) then return new; end if;
  if not exists (select 1 from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id) then return new; end if;
  select count(*)::integer, (array_agg(candidate.id))[1]
  into candidate_count, candidate_package_id
  from (
    select package.id from public.trainer_finance_packages package
    where package.trainer_id = new.trainer_id and package.client_id = new.client_id
      and package.closed_at is null and package.starts_on <= new.workout_date
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
