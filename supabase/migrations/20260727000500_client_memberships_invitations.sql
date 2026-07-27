create table public.client_trainers (
  client_id uuid not null references public.clients (id) on delete cascade,
  trainer_id uuid not null references public.trainers (profile_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (client_id, trainer_id)
);

insert into public.client_trainers (client_id, trainer_id)
select id, trainer_id from public.clients
on conflict do nothing;

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
  constraint client_invitations_target_role_allowed check (target_role in ('client', 'trainer')),
  constraint client_invitations_claim_consistent check (
    (claimed_by is null and claimed_at is null)
    or (claimed_by is not null and claimed_at is not null)
  )
);

create index client_trainers_trainer_idx on public.client_trainers (trainer_id, client_id);
create index client_invitations_client_idx on public.client_invitations (client_id, created_at desc);

alter table public.client_trainers enable row level security;
alter table public.client_invitations enable row level security;

create or replace function public.can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and (
        client.auth_user_id = auth.uid()
        or client.trainer_id = auth.uid()
        or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id
            and membership.trainer_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.can_access_client(uuid) from public, anon;
grant execute on function public.can_access_client(uuid) to authenticated;

drop policy if exists "clients_read_accessible" on public.clients;
create policy "clients_read_accessible" on public.clients
  for select to authenticated using (public.can_access_client(id));

drop policy if exists "workouts_read_accessible" on public.workouts;
create policy "workouts_read_accessible" on public.workouts
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists "workout_exercises_read_accessible" on public.workout_exercises;
create policy "workout_exercises_read_accessible" on public.workout_exercises
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists "workout_sets_read_accessible" on public.workout_sets;
create policy "workout_sets_read_accessible" on public.workout_sets
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists "progress_read_accessible" on public.client_progress;
create policy "progress_read_accessible" on public.client_progress
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists "metrics_read_accessible" on public.client_custom_metrics;
create policy "metrics_read_accessible" on public.client_custom_metrics
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists "progress_custom_read_accessible" on public.client_progress_custom;
create policy "progress_custom_read_accessible" on public.client_progress_custom
  for select to authenticated using (public.can_access_client(client_id));

create policy "client_trainers_read_accessible" on public.client_trainers
  for select to authenticated using (public.can_access_client(client_id));

create policy "client_invitations_read_creator" on public.client_invitations
  for select to authenticated using (created_by = auth.uid());

revoke all on public.client_trainers, public.client_invitations from anon, authenticated;
grant select on public.client_trainers, public.client_invitations to authenticated;

create or replace function public.create_client_invitation(
  p_client_id uuid,
  p_target_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  invitation_code text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_target_role not in ('client', 'trainer') then
    raise exception 'invalid_invitation_role' using errcode = 'PT422';
  end if;

  select account_role into actor_role from public.profiles where id = actor_id;
  if p_target_role = 'client' then
    if actor_role <> 'trainer'
      or not public.can_access_client(p_client_id)
      or exists (
        select 1 from public.clients
        where id = p_client_id and auth_user_id is not null
      )
    then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  else
    if actor_role <> 'client'
      or not exists (
        select 1 from public.clients
        where id = p_client_id and auth_user_id = actor_id
      )
    then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  end if;

  update public.client_invitations
  set revoked_at = now()
  where client_id = p_client_id
    and target_role = p_target_role
    and claimed_at is null
    and revoked_at is null;

  invitation_code := upper(substr(encode(extensions.gen_random_bytes(9), 'hex'), 1, 12));
  insert into public.client_invitations (
    client_id, created_by, target_role, code_hash, expires_at
  ) values (
    p_client_id,
    actor_id,
    p_target_role,
    encode(extensions.digest(invitation_code, 'sha256'), 'hex'),
    now() + interval '7 days'
  );
  return invitation_code;
end;
$$;

create or replace function public.claim_client_invitation(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  invitation public.client_invitations;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  select account_role into actor_role from public.profiles where id = actor_id;

  select * into invitation
  from public.client_invitations
  where code_hash = encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex')
  for update;

  if invitation.id is null
    or invitation.revoked_at is not null
    or invitation.claimed_at is not null
    or invitation.expires_at <= now()
  then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  if actor_role <> invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.target_role = 'client' then
    update public.clients
    set auth_user_id = actor_id
    where id = invitation.client_id and auth_user_id is null;
    if not found then
      raise exception 'client_already_linked' using errcode = 'PT409';
    end if;
  else
    insert into public.client_trainers (client_id, trainer_id)
    values (invitation.client_id, actor_id)
    on conflict do nothing;
  end if;

  update public.client_invitations
  set claimed_by = actor_id, claimed_at = now()
  where id = invitation.id;

  return invitation.client_id;
end;
$$;

create or replace function public.revoke_client_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_invitations
  set revoked_at = now()
  where id = p_invitation_id
    and created_by = auth.uid()
    and claimed_at is null
    and revoked_at is null;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.remove_client_trainer(p_client_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = p_client_id and auth_user_id = auth.uid()
  ) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  delete from public.client_trainers
  where client_id = p_client_id and trainer_id = p_trainer_id;
  if not found then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.leave_client_space(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.client_trainers
  where client_id = p_client_id and trainer_id = auth.uid();
  if not found then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.create_client_invitation(uuid, text) from public, anon;
revoke all on function public.claim_client_invitation(text) from public, anon;
revoke all on function public.revoke_client_invitation(uuid) from public, anon;
revoke all on function public.remove_client_trainer(uuid, uuid) from public, anon;
revoke all on function public.leave_client_space(uuid) from public, anon;
grant execute on function public.create_client_invitation(uuid, text) to authenticated;
grant execute on function public.claim_client_invitation(text) to authenticated;
grant execute on function public.revoke_client_invitation(uuid) to authenticated;
grant execute on function public.remove_client_trainer(uuid, uuid) to authenticated;
grant execute on function public.leave_client_space(uuid) to authenticated;
