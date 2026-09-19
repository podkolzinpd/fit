-- Up Migration

create policy user_legal_acceptances_read_own on public.user_legal_acceptances
  for select to fit_api
  using (user_id = (select auth.uid()));

create policy user_legal_acceptances_insert_own on public.user_legal_acceptances
  for insert to fit_api
  with check (user_id = (select auth.uid()));

create policy account_deletion_requests_read_own on public.account_deletion_requests
  for select to fit_api
  using (user_id = (select auth.uid()));

grant select, insert on public.user_legal_acceptances to fit_api;
grant select on public.account_deletion_requests to fit_api;

create or replace function public.request_account_deletion()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = 'PT401';
  end if;

  select request.id
  into request_id
  from public.account_deletion_requests request
  where request.user_id = actor_id
    and request.status = 'requested'
  order by request.requested_at desc
  limit 1;

  if request_id is not null then
    return request_id;
  end if;

  insert into public.account_deletion_requests (user_id)
  values (actor_id)
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.cancel_account_deletion_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  changed integer;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = 'PT401';
  end if;

  update public.account_deletion_requests
  set status = 'cancelled', cancelled_at = now()
  where user_id = actor_id
    and status = 'requested';

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.request_account_deletion() from public;
revoke all on function public.cancel_account_deletion_request() from public;
grant execute on function public.request_account_deletion() to fit_api;
grant execute on function public.cancel_account_deletion_request() to fit_api;

-- Down Migration

revoke execute on function public.cancel_account_deletion_request() from fit_api;
revoke execute on function public.request_account_deletion() from fit_api;
drop function public.cancel_account_deletion_request();
drop function public.request_account_deletion();

revoke select on public.account_deletion_requests from fit_api;
revoke select, insert on public.user_legal_acceptances from fit_api;

drop policy account_deletion_requests_read_own on public.account_deletion_requests;
drop policy user_legal_acceptances_insert_own on public.user_legal_acceptances;
drop policy user_legal_acceptances_read_own on public.user_legal_acceptances;
