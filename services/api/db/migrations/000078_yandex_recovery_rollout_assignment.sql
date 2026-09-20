-- Up Migration

-- A migrated account cannot be linked before its Yandex identity exists, so a
-- linked-ready batch cannot prepare its rollout assignment. The recovery flow
-- has already verified the legacy credentials before calling this function.
-- Complete identity linking and read-write enablement in the same transaction:
-- any role/domain/conflict failure rolls both changes back.
create or replace function app_private.link_migrated_yandex_account(
  p_token_sha256 text,
  p_profile_id uuid,
  p_account_role text
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff_subject_sha256 text;
  stored_role text;
  has_trainer_root boolean;
  has_client_root boolean;
  existing_profile_id uuid;
  existing_subject_sha256 text;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_account_role not in ('trainer', 'client')
  then
    raise exception 'yandex_auth_handoff_invalid' using errcode = 'PT422';
  end if;

  select handoff.subject_sha256
  into handoff_subject_sha256
  from app_private.yandex_auth_handoffs handoff
  where handoff.token_sha256 = p_token_sha256
    and handoff.expires_at > now()
    and handoff.used_at is null
  for update;

  if handoff_subject_sha256 is null then
    raise exception 'yandex_auth_handoff_expired' using errcode = 'PT401';
  end if;

  select profile.account_role,
         exists (select 1 from public.trainers trainer where trainer.profile_id = profile.id),
         exists (select 1 from public.clients client where client.auth_user_id = profile.id)
  into stored_role, has_trainer_root, has_client_root
  from public.profiles profile
  where profile.id = p_profile_id
  for update;

  if stored_role is null then
    raise exception 'migrated_profile_not_found' using errcode = 'PT404';
  end if;
  if stored_role <> p_account_role
    or (stored_role = 'trainer' and not has_trainer_root)
    or (stored_role = 'client' and not has_client_root)
  then
    raise exception 'migrated_profile_role_mismatch' using errcode = 'PT409';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || handoff_subject_sha256, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('yandex_profile:' || p_profile_id::text, 0)
  );

  select identity.profile_id
  into existing_profile_id
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = handoff_subject_sha256
  for update;

  select identity.provider_subject_sha256
  into existing_subject_sha256
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.profile_id = p_profile_id
  for update;

  if existing_profile_id is not null and existing_profile_id <> p_profile_id then
    raise exception 'yandex_identity_already_linked' using errcode = 'PT409';
  end if;
  if existing_subject_sha256 is not null
    and existing_subject_sha256 <> handoff_subject_sha256
  then
    raise exception 'yandex_profile_already_linked' using errcode = 'PT409';
  end if;

  insert into app_private.auth_identities (
    provider, provider_subject_sha256, profile_id, identity_origin
  ) values (
    'yandex', handoff_subject_sha256, p_profile_id, 'linked'
  ) on conflict (provider, provider_subject_sha256) do nothing;

  insert into app_private.profile_rollout_assignments (
    profile_id, target_backend, access_mode, enabled
  ) values (
    p_profile_id, 'yandex', 'read_write', true
  ) on conflict on constraint profile_rollout_assignments_pkey do update set
    target_backend = excluded.target_backend,
    access_mode = excluded.access_mode,
    enabled = excluded.enabled;

  update app_private.yandex_auth_handoffs
  set used_at = now()
  where token_sha256 = p_token_sha256;

  return query select p_profile_id, handoff_subject_sha256;
end;
$$;

-- Down Migration

create or replace function app_private.link_migrated_yandex_account(
  p_token_sha256 text,
  p_profile_id uuid,
  p_account_role text
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff_subject_sha256 text;
  stored_role text;
  has_trainer_root boolean;
  existing_profile_id uuid;
  existing_subject_sha256 text;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_account_role not in ('trainer', 'client')
  then
    raise exception 'yandex_auth_handoff_invalid' using errcode = 'PT422';
  end if;

  select handoff.subject_sha256
  into handoff_subject_sha256
  from app_private.yandex_auth_handoffs handoff
  where handoff.token_sha256 = p_token_sha256
    and handoff.expires_at > now()
    and handoff.used_at is null
  for update;

  if handoff_subject_sha256 is null then
    raise exception 'yandex_auth_handoff_expired' using errcode = 'PT401';
  end if;

  select profile.account_role,
         exists (select 1 from public.trainers trainer where trainer.profile_id = profile.id)
  into stored_role, has_trainer_root
  from public.profiles profile
  where profile.id = p_profile_id
  for update;

  if stored_role is null then
    raise exception 'migrated_profile_not_found' using errcode = 'PT404';
  end if;
  if stored_role <> p_account_role
    or (stored_role = 'trainer') <> has_trainer_root
  then
    raise exception 'migrated_profile_role_mismatch' using errcode = 'PT409';
  end if;
  if not exists (
    select 1
    from app_private.profile_rollout_assignments rollout
    where rollout.profile_id = p_profile_id
      and rollout.target_backend = 'yandex'
      and rollout.access_mode = 'read_write'
      and rollout.enabled
  ) then
    raise exception 'migrated_profile_not_ready' using errcode = 'PT403';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || handoff_subject_sha256, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('yandex_profile:' || p_profile_id::text, 0)
  );

  select identity.profile_id
  into existing_profile_id
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = handoff_subject_sha256
  for update;

  select identity.provider_subject_sha256
  into existing_subject_sha256
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.profile_id = p_profile_id
  for update;

  if existing_profile_id is not null and existing_profile_id <> p_profile_id then
    raise exception 'yandex_identity_already_linked' using errcode = 'PT409';
  end if;
  if existing_subject_sha256 is not null
    and existing_subject_sha256 <> handoff_subject_sha256
  then
    raise exception 'yandex_profile_already_linked' using errcode = 'PT409';
  end if;

  insert into app_private.auth_identities (
    provider, provider_subject_sha256, profile_id, identity_origin
  ) values (
    'yandex', handoff_subject_sha256, p_profile_id, 'linked'
  ) on conflict (provider, provider_subject_sha256) do nothing;

  update app_private.yandex_auth_handoffs
  set used_at = now()
  where token_sha256 = p_token_sha256;

  return query select p_profile_id, handoff_subject_sha256;
end;
$$;
