-- Up Migration

-- Receipts are private and scoped to a trainer. Existing ledger rows are untouched.
create table app_private.finance_payment_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
revoke all on app_private.finance_payment_requests from public, fit_api;

create function public.create_trainer_finance_service_v2(
  p_client_id uuid, p_kind text, p_title text, p_sessions_total integer,
  p_opening_used_sessions integer, p_price_cents bigint, p_opening_paid_cents bigint,
  p_starts_on date, p_ends_on date, p_payment_due_on date, p_comment text,
  p_opening_received_on date, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_id_value uuid := app_private.trainer_finance_assert_trainer();
  received_on_value date := coalesce(p_opening_received_on, p_starts_on);
  request_payload jsonb := jsonb_build_object('action', 'createService', 'clientId', p_client_id,
    'kind', p_kind, 'title', p_title, 'sessionsTotal', p_sessions_total,
    'openingUsedSessions', p_opening_used_sessions, 'priceCents', p_price_cents,
    'openingPaidCents', p_opening_paid_cents, 'startsOn', p_starts_on, 'endsOn', p_ends_on,
    'paymentDueOn', p_payment_due_on, 'comment', p_comment,
    'openingReceivedOn', received_on_value);
  receipt app_private.finance_payment_requests;
  result_value jsonb;
  package_id_value uuid;
begin
  if not app_private.trainer_finance_has_connection(actor_id_value, p_client_id) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;
  if p_request_id is not null then
    insert into app_private.finance_payment_requests(actor_id, request_id, payload)
    values(actor_id_value, p_request_id, request_payload) on conflict do nothing;
    select * into receipt from app_private.finance_payment_requests r
    where r.actor_id = actor_id_value and r.request_id = p_request_id for update;
    if receipt.payload <> request_payload then
      raise exception 'trainer_finance_conflict' using errcode = 'PT409';
    end if;
    if receipt.result is not null then return receipt.result; end if;
  end if;
  result_value := public.create_trainer_finance_service(p_client_id, p_kind, p_title,
    p_sessions_total, p_opening_used_sessions, p_price_cents, p_opening_paid_cents,
    p_starts_on, p_ends_on, p_payment_due_on, p_comment);
  package_id_value := (result_value->>'id')::uuid;
  -- The legacy signature retains its original date semantics. New clients can
  -- supply the actual receipt date atomically with the service and first payment.
  if p_opening_paid_cents > 0 then
    update public.trainer_finance_payments payment
    set received_on = received_on_value
    where payment.package_id = package_id_value and payment.source = 'opening'
      and payment.received_on is distinct from received_on_value;
  end if;
  if p_request_id is not null then
    update app_private.finance_payment_requests r set result = result_value
    where r.actor_id = actor_id_value and r.request_id = p_request_id;
  end if;
  return result_value;
end;
$$;

create function public.add_trainer_finance_payment_v2(
  p_package_id uuid, p_amount_cents bigint, p_received_on date,
  p_comment text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_id_value uuid := app_private.trainer_finance_assert_trainer();
  request_payload jsonb := jsonb_build_object('action', 'addPayment',
    'packageId', p_package_id, 'amountCents', p_amount_cents,
    'receivedOn', p_received_on, 'comment', p_comment);
  receipt app_private.finance_payment_requests;
  result_value jsonb;
begin
  if not exists(select 1 from public.trainer_finance_packages package
    where package.id = p_package_id and package.trainer_id = actor_id_value) then
    raise exception 'trainer_finance_package_not_found' using errcode = 'PT404';
  end if;
  if p_request_id is not null then
    insert into app_private.finance_payment_requests(actor_id, request_id, payload)
    values(actor_id_value, p_request_id, request_payload) on conflict do nothing;
    select * into receipt from app_private.finance_payment_requests r
    where r.actor_id = actor_id_value and r.request_id = p_request_id for update;
    if receipt.payload <> request_payload then
      raise exception 'trainer_finance_conflict' using errcode = 'PT409';
    end if;
    if receipt.result is not null then return receipt.result; end if;
  end if;
  result_value := public.add_trainer_finance_payment(p_package_id, p_amount_cents,
    p_received_on, p_comment);
  if p_request_id is not null then
    update app_private.finance_payment_requests r set result = result_value
    where r.actor_id = actor_id_value and r.request_id = p_request_id;
  end if;
  return result_value;
end;
$$;

revoke all on function public.create_trainer_finance_service_v2(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text, date, uuid),
  public.add_trainer_finance_payment_v2(uuid, bigint, date, text, uuid) from public;
grant execute on function public.create_trainer_finance_service_v2(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text, date, uuid),
  public.add_trainer_finance_payment_v2(uuid, bigint, date, text, uuid) to fit_api;

-- Down Migration

drop function public.add_trainer_finance_payment_v2(uuid, bigint, date, text, uuid);
drop function public.create_trainer_finance_service_v2(uuid, text, text, integer, integer, bigint, bigint, date, date, date, text, date, uuid);
drop table app_private.finance_payment_requests;
