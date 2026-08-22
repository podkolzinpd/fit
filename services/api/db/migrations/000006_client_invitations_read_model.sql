-- Up Migration

create table public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  target_role text not null,
  code_hash text not null unique,
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_invitations_target_role_allowed
    check (target_role in ('client', 'trainer')),
  constraint client_invitations_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint client_invitations_claim_consistent check (
    (claimed_by is null and claimed_at is null)
    or (claimed_by is not null and claimed_at is not null)
  ),
  constraint client_invitations_terminal_state_exclusive
    check (claimed_at is null or revoked_at is null),
  constraint client_invitations_expiry_after_creation
    check (expires_at > created_at)
);

create index client_invitations_client_created_idx
  on public.client_invitations (client_id, created_at desc);
create index client_invitations_creator_active_idx
  on public.client_invitations (created_by, client_id, created_at desc)
  where claimed_at is null and revoked_at is null;

alter table public.client_invitations enable row level security;

create policy client_invitations_read_creator on public.client_invitations
  for select to fit_api
  using (
    created_by = (select auth.uid())
    and public.can_access_client(client_id)
    and exists (
      select 1
      from public.clients client
      where client.id = client_invitations.client_id
        and client.archived_at is null
    )
  );

create or replace function public.list_accessible_client_trainers()
returns table (
  client_id uuid,
  trainer_id uuid,
  first_name text,
  last_name text,
  joined_at timestamptz,
  is_root boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  return query
  select
    membership.client_id,
    membership.trainer_id,
    profile.first_name,
    profile.last_name,
    membership.joined_at,
    membership.trainer_id = client.trainer_id
  from public.client_trainers membership
  join public.clients client on client.id = membership.client_id
  join public.profiles profile on profile.id = membership.trainer_id
  where public.can_access_client(membership.client_id)
    and client.archived_at is null
  order by
    membership.client_id,
    (membership.trainer_id = client.trainer_id) desc,
    membership.joined_at,
    membership.trainer_id;
end;
$$;

revoke all on public.client_invitations from public;
revoke all on function public.list_accessible_client_trainers() from public;
grant select on public.client_invitations to fit_api;
grant execute on function public.list_accessible_client_trainers() to fit_api;

-- Down Migration

revoke execute on function public.list_accessible_client_trainers() from fit_api;
revoke select on public.client_invitations from fit_api;
drop function public.list_accessible_client_trainers();
drop policy client_invitations_read_creator on public.client_invitations;
drop table public.client_invitations;
