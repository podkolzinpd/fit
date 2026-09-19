alter table public.client_invitations
  add column link_token_hash text;

alter table public.client_invitations
  add constraint client_invitations_link_token_hash_format
  check (link_token_hash is null or link_token_hash ~ '^[0-9a-f]{64}$');

create unique index client_invitations_link_token_hash_idx
  on public.client_invitations (link_token_hash)
  where link_token_hash is not null;

create or replace function public.create_client_invitation_share(
  p_client_id uuid,
  p_target_role text
)
returns table (
  invitation_id uuid,
  invitation_code text,
  invitation_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_code text;
  generated_token text;
begin
  generated_code := public.create_client_invitation(p_client_id, p_target_role);
  generated_token := generated_code || '.' || encode(extensions.gen_random_bytes(32), 'hex');

  update public.client_invitations invitation
  set link_token_hash = encode(
    extensions.digest(generated_token, 'sha256'),
    'hex'
  )
  where invitation.created_by = auth.uid()
    and invitation.client_id = p_client_id
    and invitation.target_role = p_target_role
    and invitation.code_hash = encode(
      extensions.digest(generated_code, 'sha256'),
      'hex'
    )
    and invitation.claimed_at is null
    and invitation.revoked_at is null
  returning invitation.id, invitation.expires_at
  into invitation_id, expires_at;

  if invitation_id is null then
    raise exception 'invitation_not_created' using errcode = 'PT500';
  end if;

  invitation_code := generated_code;
  invitation_token := generated_token;
  return next;
end;
$$;

create or replace function public.get_client_invitation_preview(p_token text)
returns table (
  target_role text,
  inviter_name text,
  expires_at timestamptz,
  invitation_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.target_role,
    coalesce(
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      'Пользователь Fit'
    ) as inviter_name,
    invitation.expires_at,
    case
      when invitation.claimed_at is not null then 'claimed'
      when invitation.revoked_at is not null then 'revoked'
      when invitation.expires_at <= now() then 'expired'
      else 'active'
    end as invitation_status
  from public.client_invitations invitation
  join public.profiles profile on profile.id = invitation.created_by
  where invitation.link_token_hash = encode(
    extensions.digest(btrim(coalesce(p_token, '')), 'sha256'),
    'hex'
  );
$$;

create or replace function public.claim_client_invitation_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_token text := btrim(coalesce(p_token, ''));
  invitation_code text := split_part(normalized_token, '.', 1);
  invitation public.client_invitations%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.link_token_hash = encode(
      extensions.digest(normalized_token, 'sha256'),
      'hex'
    )
    and stored_invitation.code_hash = encode(
      extensions.digest(upper(invitation_code), 'sha256'),
      'hex'
    );

  if invitation.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_role is distinct from invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.claimed_at is not null
    and invitation.claimed_by = actor_id
    and invitation.target_role = 'trainer'
  then
    return invitation.client_id;
  end if;

  if actor_role = 'client' then
    return public.reconnect_client_trainer(invitation_code);
  end if;
  return public.claim_client_invitation(invitation_code);
end;
$$;

revoke all on function public.create_client_invitation_share(uuid, text) from public, anon;
revoke all on function public.get_client_invitation_preview(text) from public;
revoke all on function public.claim_client_invitation_link(text) from public, anon;

grant execute on function public.create_client_invitation_share(uuid, text) to authenticated;
grant execute on function public.get_client_invitation_preview(text) to anon, authenticated;
grant execute on function public.claim_client_invitation_link(text) to authenticated;
