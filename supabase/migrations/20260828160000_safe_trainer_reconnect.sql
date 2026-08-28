-- Безопасное переподключение самостоятельного клиента к тренеру.
-- Клиент обязан сначала явно отключить прежнего тренера. После этого
-- существующая атомарная привязка переносит карточку нового тренера в
-- каноническую самостоятельную карточку клиента без потери истории.

create or replace function public.reconnect_client_trainer(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  active_trainer_id uuid;
  invitation public.client_invitations%rowtype;
  source_client public.clients%rowtype;
  canonical_client public.clients%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_role is distinct from 'client' then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.code_hash = encode(
      extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'),
      'hex'
    )
  for update;

  if invitation.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  -- Повтор уже успешно использованного этим же клиентом кода безопасен.
  if invitation.claimed_at is not null then
    if invitation.claimed_by is distinct from actor_id then
      raise exception 'invitation_invalid' using errcode = 'PT404';
    end if;
    return public.claim_client_invitation(p_code);
  end if;

  if invitation.revoked_at is not null
    or invitation.expires_at <= now()
    or invitation.target_role <> 'client'
  then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  select client.*
  into source_client
  from public.clients client
  where client.id = invitation.client_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.auth_user_id is null
  for update;

  if source_client.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  select client.*
  into canonical_client
  from public.clients client
  where client.auth_user_id = actor_id
    and client.trainer_id = actor_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.id <> source_client.id
  for update;

  if canonical_client.id is null then
    raise exception 'standalone_client_required' using errcode = 'PT409';
  end if;

  select relationship.trainer_id
  into active_trainer_id
  from public.client_trainer_relationships relationship
  where relationship.client_id = canonical_client.id
    and relationship.status = 'active'
  for update;

  if active_trainer_id is not null then
    raise exception 'trainer_disconnect_required' using errcode = 'PT409';
  end if;

  return public.claim_client_invitation(p_code);
end;
$$;

revoke all on function public.reconnect_client_trainer(text) from public, anon;
grant execute on function public.reconnect_client_trainer(text) to authenticated;
