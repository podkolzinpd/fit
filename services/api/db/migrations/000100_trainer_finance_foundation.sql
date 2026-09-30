-- Up Migration

create table public.trainer_finance_packages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  title text not null,
  sessions_total integer not null,
  opening_used_sessions integer not null default 0,
  price_cents bigint not null,
  starts_on date not null,
  ends_on date,
  payment_due_on date,
  comment text,
  closed_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_finance_packages_identity_unique unique (id, trainer_id, client_id),
  constraint trainer_finance_packages_title_valid check (
    btrim(title) <> '' and char_length(title) <= 120
  ),
  constraint trainer_finance_packages_sessions_valid check (
    sessions_total between 1 and 10000
    and opening_used_sessions between 0 and sessions_total
  ),
  constraint trainer_finance_packages_price_valid check (
    price_cents between 0 and 100000000000
  ),
  constraint trainer_finance_packages_dates_valid check (
    ends_on is null or ends_on >= starts_on
  ),
  constraint trainer_finance_packages_comment_valid check (
    comment is null or char_length(comment) <= 2000
  )
);

create table public.trainer_finance_payments (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  amount_cents bigint not null,
  received_on date not null,
  source text not null default 'manual',
  comment text,
  voided_at timestamptz,
  void_reason text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_finance_payments_package_fk
    foreign key (package_id, trainer_id, client_id)
    references public.trainer_finance_packages (id, trainer_id, client_id)
    on delete restrict,
  constraint trainer_finance_payments_amount_valid check (
    amount_cents between 1 and 100000000000
  ),
  constraint trainer_finance_payments_source_valid check (
    source in ('manual', 'opening')
  ),
  constraint trainer_finance_payments_comment_valid check (
    comment is null or char_length(comment) <= 2000
  ),
  constraint trainer_finance_payments_void_valid check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and nullif(btrim(void_reason), '') is not null
      and char_length(void_reason) <= 500)
  )
);

create table public.trainer_finance_sessions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid,
  workout_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  disposition text not null,
  source text not null,
  comment text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_finance_sessions_package_fk
    foreign key (package_id, trainer_id, client_id)
    references public.trainer_finance_packages (id, trainer_id, client_id)
    on delete restrict,
  constraint trainer_finance_sessions_workout_fk
    foreign key (workout_id, trainer_id, client_id)
    references public.workouts (id, trainer_id, client_id)
    on delete restrict,
  constraint trainer_finance_sessions_disposition_valid check (
    disposition in ('charged', 'unassigned', 'free', 'trial')
  ),
  constraint trainer_finance_sessions_package_valid check (
    (disposition = 'charged' and package_id is not null)
    or (disposition <> 'charged' and package_id is null)
  ),
  constraint trainer_finance_sessions_source_valid check (
    source in ('automatic', 'manual')
  ),
  constraint trainer_finance_sessions_comment_valid check (
    comment is null or char_length(comment) <= 2000
  ),
  constraint trainer_finance_sessions_void_valid check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and nullif(btrim(void_reason), '') is not null
      and char_length(void_reason) <= 500)
  )
);

create table public.trainer_finance_events (
  id bigint generated always as identity primary key,
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  previous_data jsonb,
  current_data jsonb,
  created_at timestamptz not null default now(),
  constraint trainer_finance_events_entity_type_valid check (
    entity_type in ('package', 'payment', 'session')
  ),
  constraint trainer_finance_events_event_type_valid check (
    event_type in ('created', 'updated')
  )
);

create unique index trainer_finance_sessions_active_workout_uidx
  on public.trainer_finance_sessions (workout_id)
  where voided_at is null;
create index trainer_finance_packages_trainer_client_idx
  on public.trainer_finance_packages (trainer_id, client_id, starts_on desc, created_at desc);
create index trainer_finance_payments_package_idx
  on public.trainer_finance_payments (package_id, received_on desc, created_at desc);
create index trainer_finance_sessions_package_idx
  on public.trainer_finance_sessions (package_id, created_at desc)
  where voided_at is null;
create index trainer_finance_events_trainer_client_idx
  on public.trainer_finance_events (trainer_id, client_id, created_at desc, id desc);

create function app_private.record_trainer_finance_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  current_row jsonb := to_jsonb(new);
  previous_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
begin
  insert into public.trainer_finance_events (
    trainer_id, client_id, entity_type, entity_id, event_type, actor_id,
    previous_data, current_data
  ) values (
    new.trainer_id,
    new.client_id,
    case tg_table_name
      when 'trainer_finance_packages' then 'package'
      when 'trainer_finance_payments' then 'payment'
      when 'trainer_finance_sessions' then 'session'
    end,
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    auth.uid(),
    previous_row,
    current_row
  );
  return new;
end;
$$;

create trigger set_updated_at before update on public.trainer_finance_packages
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.trainer_finance_payments
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.trainer_finance_sessions
for each row execute function public.set_updated_at();
create trigger record_trainer_finance_package_event
after insert or update on public.trainer_finance_packages
for each row execute function app_private.record_trainer_finance_event();
create trigger record_trainer_finance_payment_event
after insert or update on public.trainer_finance_payments
for each row execute function app_private.record_trainer_finance_event();
create trigger record_trainer_finance_session_event
after insert or update on public.trainer_finance_sessions
for each row execute function app_private.record_trainer_finance_event();

alter table public.trainer_finance_packages enable row level security;
alter table public.trainer_finance_payments enable row level security;
alter table public.trainer_finance_sessions enable row level security;
alter table public.trainer_finance_events enable row level security;

create policy trainer_finance_packages_owner_read on public.trainer_finance_packages
  for select to fit_api using (trainer_id = auth.uid());
create policy trainer_finance_payments_owner_read on public.trainer_finance_payments
  for select to fit_api using (trainer_id = auth.uid());
create policy trainer_finance_sessions_owner_read on public.trainer_finance_sessions
  for select to fit_api using (trainer_id = auth.uid());
create policy trainer_finance_events_owner_read on public.trainer_finance_events
  for select to fit_api using (trainer_id = auth.uid());

revoke all on public.trainer_finance_packages,
  public.trainer_finance_payments,
  public.trainer_finance_sessions,
  public.trainer_finance_events from public, fit_api;
grant select on public.trainer_finance_packages,
  public.trainer_finance_payments,
  public.trainer_finance_sessions,
  public.trainer_finance_events to fit_api;

create function app_private.trainer_finance_assert_trainer()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'trainer'
  ) then
    raise exception 'trainer_finance_forbidden' using errcode = 'PT403';
  end if;
  return actor_id;
end;
$$;

create function app_private.trainer_finance_has_connection(
  p_trainer_id uuid,
  p_client_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and (
        client.trainer_id = p_trainer_id
        or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id
            and membership.trainer_id = p_trainer_id
        )
      )
  )
$$;

create function app_private.trainer_finance_package_payload(p_package_id uuid)
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
    'title', title,
    'sessionsTotal', sessions_total,
    'sessionsUsed', least(sessions_total, sessions_used),
    'sessionsRemaining', greatest(sessions_total - sessions_used, 0),
    'priceCents', price_cents,
    'paidCents', paid_cents,
    'dueCents', greatest(price_cents - paid_cents, 0),
    'startsOn', starts_on,
    'endsOn', ends_on,
    'paymentDueOn', payment_due_on,
    'comment', comment,
    'packageStatus', case
      when closed_at is not null then 'closed'
      when sessions_used >= sessions_total then 'completed'
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

create function public.list_trainer_finance_client(p_client_id uuid)
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
        'id', payment.id,
        'packageId', payment.package_id,
        'amountCents', payment.amount_cents,
        'receivedOn', payment.received_on,
        'source', payment.source,
        'comment', payment.comment,
        'voidedAt', payment.voided_at,
        'voidReason', payment.void_reason,
        'version', payment.version,
        'createdAt', payment.created_at,
        'updatedAt', payment.updated_at
      ) order by payment.received_on desc, payment.created_at desc)
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.client_id = p_client_id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.create_trainer_finance_package(
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

create function public.update_trainer_finance_package(
  p_package_id uuid,
  p_expected_version bigint,
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
  used_sessions integer;
begin
  select package.opening_used_sessions + count(session.id)::integer
  into used_sessions
  from public.trainer_finance_packages package
  left join public.trainer_finance_sessions session
    on session.package_id = package.id
   and session.disposition = 'charged'
   and session.voided_at is null
  where package.id = p_package_id and package.trainer_id = actor_id
  group by package.opening_used_sessions;
  if used_sessions is null then
    raise exception 'trainer_finance_package_not_found' using errcode = 'PT404';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
    or p_sessions_total not between greatest(used_sessions, 1) and 10000
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
  return app_private.trainer_finance_package_payload(p_package_id);
end;
$$;

create function public.add_trainer_finance_payment(
  p_package_id uuid,
  p_amount_cents bigint,
  p_received_on date,
  p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  payment public.trainer_finance_payments;
begin
  if p_amount_cents not between 1 and 100000000000 or p_received_on is null
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  insert into public.trainer_finance_payments (
    package_id, trainer_id, client_id, amount_cents, received_on, comment
  )
  select package.id, actor_id, package.client_id, p_amount_cents, p_received_on,
    nullif(btrim(coalesce(p_comment, '')), '')
  from public.trainer_finance_packages package
  where package.id = p_package_id and package.trainer_id = actor_id
  returning * into payment;
  if payment.id is null then
    raise exception 'trainer_finance_package_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'id', payment.id, 'packageId', payment.package_id,
    'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
    'source', payment.source, 'comment', payment.comment,
    'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
    'version', payment.version, 'createdAt', payment.created_at,
    'updatedAt', payment.updated_at
  );
end;
$$;

create function public.update_trainer_finance_payment(
  p_payment_id uuid,
  p_expected_version bigint,
  p_amount_cents bigint,
  p_received_on date,
  p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  payment public.trainer_finance_payments;
begin
  if p_amount_cents not between 1 and 100000000000 or p_received_on is null
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.trainer_finance_payments target
  set amount_cents = p_amount_cents, received_on = p_received_on,
    comment = nullif(btrim(coalesce(p_comment, '')), ''),
    version = target.version + 1
  where target.id = p_payment_id and target.trainer_id = actor_id
    and target.version = p_expected_version and target.voided_at is null
  returning * into payment;
  if payment.id is null then
    if exists (select 1 from public.trainer_finance_payments target
      where target.id = p_payment_id and target.trainer_id = actor_id) then
      raise exception 'trainer_finance_conflict' using errcode = 'PT409';
    end if;
    raise exception 'trainer_finance_payment_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'id', payment.id, 'packageId', payment.package_id,
    'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
    'source', payment.source, 'comment', payment.comment,
    'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
    'version', payment.version, 'createdAt', payment.created_at,
    'updatedAt', payment.updated_at
  );
end;
$$;

create function public.void_trainer_finance_payment(
  p_payment_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(p_reason) > 500 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  update public.trainer_finance_payments payment
  set voided_at = now(), void_reason = btrim(p_reason),
    version = payment.version + 1
  where payment.id = p_payment_id and payment.trainer_id = actor_id
    and payment.version = p_expected_version and payment.voided_at is null;
  if not found then
    if exists (select 1 from public.trainer_finance_payments payment
      where payment.id = p_payment_id and payment.trainer_id = actor_id) then
      raise exception 'trainer_finance_conflict' using errcode = 'PT409';
    end if;
    raise exception 'trainer_finance_payment_not_found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function app_private.trainer_finance_assert_trainer(),
  app_private.record_trainer_finance_event(),
  app_private.trainer_finance_has_connection(uuid, uuid),
  app_private.trainer_finance_package_payload(uuid),
  public.list_trainer_finance_client(uuid),
  public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text),
  public.add_trainer_finance_payment(uuid, bigint, date, text),
  public.update_trainer_finance_payment(uuid, bigint, bigint, date, text),
  public.void_trainer_finance_payment(uuid, bigint, text) from public;

grant execute on function public.list_trainer_finance_client(uuid),
  public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text),
  public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text),
  public.add_trainer_finance_payment(uuid, bigint, date, text),
  public.update_trainer_finance_payment(uuid, bigint, bigint, date, text),
  public.void_trainer_finance_payment(uuid, bigint, text) to fit_api;

-- Down Migration

revoke execute on function public.void_trainer_finance_payment(uuid, bigint, text),
  public.update_trainer_finance_payment(uuid, bigint, bigint, date, text),
  public.add_trainer_finance_payment(uuid, bigint, date, text),
  public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text),
  public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text),
  public.list_trainer_finance_client(uuid) from fit_api;
drop function public.void_trainer_finance_payment(uuid, bigint, text);
drop function public.update_trainer_finance_payment(uuid, bigint, bigint, date, text);
drop function public.add_trainer_finance_payment(uuid, bigint, date, text);
drop function public.update_trainer_finance_package(uuid, bigint, text, integer, bigint, date, date, date, text);
drop function public.create_trainer_finance_package(uuid, text, integer, integer, bigint, bigint, date, date, date, text);
drop function public.list_trainer_finance_client(uuid);
drop function app_private.trainer_finance_package_payload(uuid);
drop function app_private.trainer_finance_has_connection(uuid, uuid);
drop function app_private.trainer_finance_assert_trainer();
drop trigger record_trainer_finance_session_event on public.trainer_finance_sessions;
drop trigger record_trainer_finance_payment_event on public.trainer_finance_payments;
drop trigger record_trainer_finance_package_event on public.trainer_finance_packages;
drop function app_private.record_trainer_finance_event();
drop policy trainer_finance_events_owner_read on public.trainer_finance_events;
drop policy trainer_finance_sessions_owner_read on public.trainer_finance_sessions;
drop policy trainer_finance_payments_owner_read on public.trainer_finance_payments;
drop policy trainer_finance_packages_owner_read on public.trainer_finance_packages;
drop table public.trainer_finance_events;
drop table public.trainer_finance_sessions;
drop table public.trainer_finance_payments;
drop table public.trainer_finance_packages;
