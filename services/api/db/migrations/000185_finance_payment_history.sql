-- Up Migration

create index trainer_finance_payments_trainer_period_idx
  on public.trainer_finance_payments (trainer_id, received_on desc, created_at desc, id desc)
  where voided_at is null;

create function public.list_trainer_finance_payments(
  p_month date, p_client_id uuid default null, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date
    or p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  return (
    with receipts as (
      select payment.*, client.full_name, client.archived_at, package.title
      from public.trainer_finance_payments payment
      join public.clients client on client.id = payment.client_id
      join public.trainer_finance_packages package on package.id = payment.package_id
        and package.trainer_id = actor_id
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= p_month
        and payment.received_on < (p_month + interval '1 month')::date
        and (p_client_id is null or payment.client_id = p_client_id)
    ), page as (
      select * from receipts order by received_on desc, created_at desc, id desc
      limit 50 offset p_offset
    )
    select jsonb_build_object(
      'month', to_char(p_month, 'YYYY-MM'), 'clientId', p_client_id,
      'offset', p_offset, 'limit', 50,
      'totalCount', (select count(*) from receipts),
      'totalCents', (select coalesce(sum(amount_cents), 0) from receipts),
      'clients', coalesce((
        select jsonb_agg(jsonb_build_object('id', own_client.id, 'name', own_client.full_name)
          order by own_client.full_name, own_client.id)
        from public.clients own_client
        where exists (select 1 from public.trainer_finance_payments own_payment
          where own_payment.trainer_id = actor_id and own_payment.client_id = own_client.id
            and own_payment.voided_at is null)
      ), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', page.id, 'packageId', page.package_id, 'clientId', page.client_id,
        'clientName', page.full_name, 'archivedAt', page.archived_at, 'serviceTitle', page.title,
        'amountCents', page.amount_cents, 'receivedOn', page.received_on,
        'source', page.source, 'comment', page.comment, 'voidedAt', page.voided_at,
        'voidReason', page.void_reason, 'version', page.version,
        'createdAt', page.created_at, 'updatedAt', page.updated_at
      ) order by page.received_on desc, page.created_at desc, page.id desc) from page), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.list_trainer_finance_payments(date, uuid, integer) from public;
grant execute on function public.list_trainer_finance_payments(date, uuid, integer) to fit_api;

-- Down Migration

drop function public.list_trainer_finance_payments(date, uuid, integer);
drop index public.trainer_finance_payments_trainer_period_idx;
