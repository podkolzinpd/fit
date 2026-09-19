-- Up Migration

create table app_private.yandex_auth_handoffs (
  token_sha256 text primary key,
  subject_sha256 text not null,
  recovery_attempt_count integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint yandex_auth_handoffs_token_format
    check (token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint yandex_auth_handoffs_subject_format
    check (subject_sha256 ~ '^[0-9a-f]{64}$'),
  constraint yandex_auth_handoffs_expiry_after_creation
    check (expires_at > created_at),
  constraint yandex_auth_handoffs_recovery_attempts_allowed
    check (recovery_attempt_count between 0 and 5)
);

create index yandex_auth_handoffs_subject_expiry_idx
  on app_private.yandex_auth_handoffs (subject_sha256, expires_at desc)
  where used_at is null;

create or replace function app_private.create_yandex_auth_handoff(
  p_subject_sha256 text,
  p_token_sha256 text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception 'yandex_auth_handoff_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || p_subject_sha256, 0)
  );

  if exists (
    select 1
    from app_private.auth_identities identity
    where identity.provider = 'yandex'
      and identity.provider_subject_sha256 = p_subject_sha256
  ) then
    return false;
  end if;

  delete from app_private.yandex_auth_handoffs
  where expires_at <= now()
    or used_at is not null
    or subject_sha256 = p_subject_sha256;

  insert into app_private.yandex_auth_handoffs (
    token_sha256, subject_sha256, expires_at
  ) values (
    p_token_sha256, p_subject_sha256, p_expires_at
  );

  return true;
end;
$$;

create or replace function app_private.record_yandex_auth_recovery_attempt(
  p_token_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'yandex_auth_handoff_invalid' using errcode = 'PT422';
  end if;

  update app_private.yandex_auth_handoffs
  set recovery_attempt_count = recovery_attempt_count + 1
  where token_sha256 = p_token_sha256
    and expires_at > now()
    and used_at is null
    and recovery_attempt_count < 5;

  if not found then
    raise exception 'yandex_auth_handoff_expired' using errcode = 'PT401';
  end if;
end;
$$;

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

create or replace function app_private.register_yandex_account_from_handoff(
  p_token_sha256 text,
  p_first_name text,
  p_timezone text,
  p_account_role text,
  p_terms_version text,
  p_privacy_version text
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff_subject_sha256 text;
  registered_profile_id uuid;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
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

  registered_profile_id := app_private.register_yandex_account(
    handoff_subject_sha256,
    p_first_name,
    p_timezone,
    p_account_role,
    p_terms_version,
    p_privacy_version
  );

  update app_private.yandex_auth_handoffs
  set used_at = now()
  where token_sha256 = p_token_sha256;

  return query select registered_profile_id, handoff_subject_sha256;
end;
$$;

revoke all on app_private.yandex_auth_handoffs from public;
revoke all on function app_private.create_yandex_auth_handoff(text, text, timestamptz) from public;
revoke all on function app_private.record_yandex_auth_recovery_attempt(text) from public;
revoke all on function app_private.link_migrated_yandex_account(text, uuid, text) from public;
revoke all on function app_private.register_yandex_account_from_handoff(text, text, text, text, text, text) from public;

grant execute on function app_private.create_yandex_auth_handoff(text, text, timestamptz) to fit_api;
grant execute on function app_private.record_yandex_auth_recovery_attempt(text) to fit_api;
grant execute on function app_private.link_migrated_yandex_account(text, uuid, text) to fit_api;
grant execute on function app_private.register_yandex_account_from_handoff(text, text, text, text, text, text) to fit_api;

-- Down Migration

revoke execute on function app_private.register_yandex_account_from_handoff(text, text, text, text, text, text) from fit_api;
revoke execute on function app_private.link_migrated_yandex_account(text, uuid, text) from fit_api;
revoke execute on function app_private.record_yandex_auth_recovery_attempt(text) from fit_api;
revoke execute on function app_private.create_yandex_auth_handoff(text, text, timestamptz) from fit_api;
drop function app_private.register_yandex_account_from_handoff(text, text, text, text, text, text);
drop function app_private.link_migrated_yandex_account(text, uuid, text);
drop function app_private.record_yandex_auth_recovery_attempt(text);
drop function app_private.create_yandex_auth_handoff(text, text, timestamptz);
drop table app_private.yandex_auth_handoffs;
