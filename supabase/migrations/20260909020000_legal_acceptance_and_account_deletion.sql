create table public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 32),
  privacy_version text not null check (char_length(privacy_version) between 1 and 32),
  source text not null check (source in ('registration', 'existing_user')),
  accepted_at timestamptz not null default now(),
  unique (user_id, terms_version, privacy_version)
);

create index user_legal_acceptances_user_accepted_idx
  on public.user_legal_acceptances (user_id, accepted_at desc);

alter table public.user_legal_acceptances enable row level security;

revoke all on public.user_legal_acceptances from public, anon, authenticated;
grant select, insert on public.user_legal_acceptances to authenticated;

create policy "users read own legal acceptances"
  on public.user_legal_acceptances for select to authenticated
  using (user_id = auth.uid());

create policy "users record own legal acceptances"
  on public.user_legal_acceptances for insert to authenticated
  with check (user_id = auth.uid());

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'completed') = (completed_at is not null))
);

create unique index account_deletion_requests_one_active_idx
  on public.account_deletion_requests (user_id)
  where status = 'requested';
create index account_deletion_requests_user_created_idx
  on public.account_deletion_requests (user_id, requested_at desc);

alter table public.account_deletion_requests enable row level security;

revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

create policy "users read own account deletion requests"
  on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid());

create or replace function public.request_account_deletion()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
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
    where request.user_id = actor_id and request.status = 'requested'
    order by request.requested_at desc
    limit 1;

  if request_id is not null then return request_id; end if;

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
set search_path = pg_catalog, public
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
    where user_id = actor_id and status = 'requested';
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion_request() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion_request() to authenticated;

comment on table public.user_legal_acceptances is 'Versioned acceptance history for Fit legal documents.';
comment on table public.account_deletion_requests is 'User-initiated account deletion requests. Rows do not delete accounts automatically.';
