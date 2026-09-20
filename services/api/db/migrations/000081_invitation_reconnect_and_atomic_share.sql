-- Up Migration

-- Client invitation links must be claimed entirely inside the Yandex data
-- plane. The link endpoint introduced in 000070 already calls this function,
-- but the function itself was never added to the Yandex migration chain.
create or replace function public.reconnect_client_trainer(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  active_trainer_id uuid;
  invitation public.client_invitations%rowtype;
  source_client public.clients%rowtype;
  canonical_client public.clients%rowtype;
begin
  if current_actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = current_actor_id;

  if actor_role is distinct from 'client' then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.code_hash = encode(
      sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8')),
      'hex'
    )
  for update;

  if invitation.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  -- Retrying the same successful link is safe and returns the same card.
  if invitation.claimed_at is not null then
    if invitation.claimed_by is distinct from current_actor_id then
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
  where client.auth_user_id = current_actor_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.id <> source_client.id
  for update;

  -- A client must explicitly disconnect before changing trainers. The claim
  -- remains untouched, so the same link can be retried afterwards.
  if canonical_client.id is not null then
    select relationship.trainer_id
    into active_trainer_id
    from public.client_trainer_relationships relationship
    where relationship.client_id = canonical_client.id
      and relationship.status = 'active'
    for update;

    if active_trainer_id is not null then
      raise exception 'trainer_disconnect_required' using errcode = 'PT409';
    end if;

    -- Ignore only a byte-for-byte duplicate starter measurement without
    -- custom values. Every ambiguous collision still stops the atomic merge.
    update public.client_progress source_progress
    set deleted_at = now(),
        updated_at = now()
    from public.client_progress target_progress
    where source_progress.client_id = source_client.id
      and source_progress.deleted_at is null
      and target_progress.client_id = canonical_client.id
      and target_progress.recorded_on = source_progress.recorded_on
      and target_progress.deleted_at is null
      and target_progress.weight_kg is not distinct from source_progress.weight_kg
      and target_progress.chest_cm is not distinct from source_progress.chest_cm
      and target_progress.waist_cm is not distinct from source_progress.waist_cm
      and target_progress.hip_cm is not distinct from source_progress.hip_cm
      and target_progress.notes is not distinct from source_progress.notes
      and not exists (
        select 1
        from public.client_progress_custom source_custom
        where source_custom.progress_id = source_progress.id
      );
  end if;

  return public.claim_client_invitation(p_code);
end;
$$;

create table app_private.new_client_invitation_operations (
  actor_id uuid not null references public.profiles (id) on delete cascade,
  operation_id uuid not null,
  full_name text not null,
  client_id uuid not null references public.clients (id) on delete cascade,
  invitation_id uuid not null references public.client_invitations (id) on delete cascade,
  invitation_code text not null,
  invitation_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);

revoke all on app_private.new_client_invitation_operations from public, fit_api;

-- Creating a trainer-owned athlete card and its protected invitation is one
-- database transaction. An actor-scoped operation receipt makes a retry after
-- a lost HTTP response return the same card and bearer link.
create or replace function public.create_new_client_invitation_share(
  p_full_name text,
  p_operation_id uuid
)
returns table (
  client_id uuid,
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
  current_actor_id uuid := auth.uid();
  normalized_full_name text := btrim(coalesce(p_full_name, ''));
  created_client_id uuid;
  created_invitation_id uuid;
  created_invitation_code text;
  created_invitation_token text;
  created_expires_at timestamptz;
begin
  if current_actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_operation_id is null then
    raise exception 'invitation_operation_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_actor_id::text || ':' || p_operation_id::text, 0)
  );

  return query
  select
    operation.client_id,
    operation.invitation_id,
    operation.invitation_code,
    operation.invitation_token,
    operation.expires_at
  from app_private.new_client_invitation_operations operation
  where operation.actor_id = current_actor_id
    and operation.operation_id = p_operation_id
    and operation.full_name = normalized_full_name;

  if found then
    return;
  end if;

  if exists (
    select 1
    from app_private.new_client_invitation_operations operation
    where operation.actor_id = current_actor_id
      and operation.operation_id = p_operation_id
  ) then
    raise exception 'invitation_operation_conflict' using errcode = 'PT409';
  end if;

  select created.client_id
  into created_client_id
  from public.create_client_card(jsonb_build_object('fullName', normalized_full_name)) created;

  select
    invitation.invitation_id,
    invitation.invitation_code,
    invitation.invitation_token,
    invitation.expires_at
  into
    created_invitation_id,
    created_invitation_code,
    created_invitation_token,
    created_expires_at
  from public.create_client_invitation_share(created_client_id, 'client') invitation;

  insert into app_private.new_client_invitation_operations (
    actor_id,
    operation_id,
    full_name,
    client_id,
    invitation_id,
    invitation_code,
    invitation_token,
    expires_at
  ) values (
    current_actor_id,
    p_operation_id,
    normalized_full_name,
    created_client_id,
    created_invitation_id,
    created_invitation_code,
    created_invitation_token,
    created_expires_at
  );

  return query
  select
    created_client_id,
    created_invitation_id,
    created_invitation_code,
    created_invitation_token,
    created_expires_at;
end;
$$;

revoke all on function public.reconnect_client_trainer(text) from public;
revoke all on function public.create_new_client_invitation_share(text, uuid) from public;

grant execute on function public.reconnect_client_trainer(text) to fit_api;
grant execute on function public.create_new_client_invitation_share(text, uuid) to fit_api;

-- Down Migration

revoke execute on function public.create_new_client_invitation_share(text, uuid) from fit_api;
revoke execute on function public.reconnect_client_trainer(text) from fit_api;

drop function public.create_new_client_invitation_share(text, uuid);
drop table app_private.new_client_invitation_operations;
drop function public.reconnect_client_trainer(text);
