-- Up Migration

create or replace function public.create_client_invitation(
  p_client_id uuid,
  p_target_role text
)
returns table (
  invitation_id uuid,
  invitation_code text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  generated_code text;
  generated_expiry timestamptz := now() + interval '7 days';
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_target_role not in ('client', 'trainer') then
    raise exception 'invalid_invitation_role' using errcode = 'PT422';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if p_target_role = 'client' then
    if actor_role <> 'trainer' then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
    perform 1
    from public.clients client
    where client.id = p_client_id
      and client.archived_at is null
      and client.auth_user_id is null
      and public.can_access_client(client.id)
    for update;
    if not found then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  else
    if actor_role <> 'client' then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
    perform 1
    from public.clients client
    where client.id = p_client_id
      and client.archived_at is null
      and client.auth_user_id = actor_id
    for update;
    if not found then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  end if;

  update public.client_invitations invitation
  set revoked_at = now()
  where invitation.client_id = p_client_id
    and invitation.target_role = p_target_role
    and invitation.claimed_at is null
    and invitation.revoked_at is null;

  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  insert into public.client_invitations (
    client_id,
    created_by,
    target_role,
    code_hash,
    expires_at
  ) values (
    p_client_id,
    actor_id,
    p_target_role,
    encode(sha256(convert_to(generated_code, 'UTF8')), 'hex'),
    generated_expiry
  )
  returning id into invitation_id;

  invitation_code := generated_code;
  expires_at := generated_expiry;
  return next;
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

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  join public.clients client on client.id = stored_invitation.client_id
  where stored_invitation.code_hash = encode(
      sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8')),
      'hex'
    )
    and client.archived_at is null
  for update of stored_invitation;

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
    update public.clients client
    set auth_user_id = actor_id
    where client.id = invitation.client_id
      and client.auth_user_id is null;
    if not found then
      raise exception 'client_already_linked' using errcode = 'PT409';
    end if;
  else
    insert into public.client_trainers (client_id, trainer_id)
    values (invitation.client_id, actor_id)
    on conflict (client_id, trainer_id) do nothing;
  end if;

  update public.client_invitations stored_invitation
  set claimed_by = actor_id,
      claimed_at = now()
  where stored_invitation.id = invitation.id;

  return invitation.client_id;
end;
$$;

create or replace function public.revoke_client_invitation(
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_invitations invitation
  set revoked_at = now()
  from public.clients client
  where invitation.id = p_invitation_id
    and invitation.client_id = client.id
    and client.archived_at is null
    and invitation.created_by = auth.uid()
    and invitation.claimed_at is null
    and invitation.revoked_at is null;

  if not found then
    raise exception 'invitation_not_found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.remove_client_trainer(
  p_client_id uuid,
  p_trainer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.archived_at is null
      and client.auth_user_id = auth.uid()
  ) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  if exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.trainer_id = p_trainer_id
  ) then
    raise exception 'root_trainer_cannot_be_removed' using errcode = 'PT422';
  end if;

  delete from public.client_trainers membership
  where membership.client_id = p_client_id
    and membership.trainer_id = p_trainer_id;

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
  if exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.trainer_id = auth.uid()
  ) then
    raise exception 'root_trainer_cannot_leave' using errcode = 'PT422';
  end if;

  delete from public.client_trainers membership
  using public.clients client
  where membership.client_id = p_client_id
    and membership.trainer_id = auth.uid()
    and client.id = membership.client_id
    and client.archived_at is null;

  if not found then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.create_client_invitation(uuid, text) from public;
revoke all on function public.claim_client_invitation(text) from public;
revoke all on function public.revoke_client_invitation(uuid) from public;
revoke all on function public.remove_client_trainer(uuid, uuid) from public;
revoke all on function public.leave_client_space(uuid) from public;

grant execute on function public.create_client_invitation(uuid, text) to fit_api;
grant execute on function public.claim_client_invitation(text) to fit_api;
grant execute on function public.revoke_client_invitation(uuid) to fit_api;
grant execute on function public.remove_client_trainer(uuid, uuid) to fit_api;
grant execute on function public.leave_client_space(uuid) to fit_api;

-- Down Migration

revoke execute on function public.leave_client_space(uuid) from fit_api;
revoke execute on function public.remove_client_trainer(uuid, uuid) from fit_api;
revoke execute on function public.revoke_client_invitation(uuid) from fit_api;
revoke execute on function public.claim_client_invitation(text) from fit_api;
revoke execute on function public.create_client_invitation(uuid, text) from fit_api;

drop function public.leave_client_space(uuid);
drop function public.remove_client_trainer(uuid, uuid);
drop function public.revoke_client_invitation(uuid);
drop function public.claim_client_invitation(text);
drop function public.create_client_invitation(uuid, text);
