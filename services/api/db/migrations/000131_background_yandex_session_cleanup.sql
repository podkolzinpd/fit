-- Up Migration

set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- Authentication must not maintain other profiles' session history.
create or replace function app_private.create_yandex_app_session(
  p_subject_sha256 text,
  p_token_sha256 text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  then
    raise exception 'invalid_yandex_app_session' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || p_subject_sha256, 0)
  );

  select identity.profile_id
  into actor_id
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
  for update of identity, profile;

  if actor_id is null then
    return null;
  end if;

  insert into app_private.profile_rollout_assignments (
    profile_id, target_backend, access_mode, enabled
  ) values (
    actor_id, 'yandex', 'read_write', true
  ) on conflict (profile_id) do update set
    target_backend = excluded.target_backend,
    access_mode = excluded.access_mode,
    enabled = excluded.enabled
  where profile_rollout_assignments.enabled;

  actor_id := app_private.resolve_yandex_app_actor(p_subject_sha256);
  if actor_id is null then
    return null;
  end if;

  insert into app_private.yandex_app_sessions (
    token_sha256, profile_id, access_mode, expires_at
  ) values (
    p_token_sha256, actor_id, 'read_write', p_expires_at
  );

  return actor_id;
end;
$$;

create or replace function app_private.recover_migrated_yandex_account(
  p_token_sha256 text,
  p_profile_id uuid,
  p_account_role text,
  p_session_token_sha256 text,
  p_session_expires_at timestamptz
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_profile_id uuid;
  recovered_subject_sha256 text;
begin
  if p_session_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_session_expires_at <= now()
    or p_session_expires_at > now() + interval '30 days'
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  select linked.profile_id, linked.subject_sha256
  into recovered_profile_id, recovered_subject_sha256
  from app_private.link_migrated_yandex_account(
    p_token_sha256,
    p_profile_id,
    p_account_role
  ) linked;

  if recovered_profile_id is null
    or recovered_subject_sha256 is null
    or recovered_profile_id <> p_profile_id
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  insert into app_private.yandex_app_sessions (
    token_sha256, profile_id, access_mode, expires_at
  ) values (
    p_session_token_sha256,
    recovered_profile_id,
    'read_write',
    p_session_expires_at
  );

  return query select recovered_profile_id, recovered_subject_sha256;
end;
$$;

create index yandex_app_sessions_cleanup_expired_idx
  on app_private.yandex_app_sessions (expires_at, token_sha256)
  where revoked_at is null;
create index yandex_app_sessions_cleanup_revoked_idx
  on app_private.yandex_app_sessions (revoked_at, token_sha256)
  where revoked_at is not null;

-- Database time only; fixed balanced batches avoid starvation of either class.
-- Locks held by another invocation or revocation are skipped, not waited on.
create function app_private.cleanup_yandex_app_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
  revoked_count integer;
begin
  with candidates as (
    select session.token_sha256
    from app_private.yandex_app_sessions session
    where session.revoked_at is null and session.expires_at <= now()
    order by session.expires_at, session.token_sha256
    limit 50
    for update skip locked
  ), removed as (
    delete from app_private.yandex_app_sessions session
    using candidates
    where session.token_sha256 = candidates.token_sha256
    returning 1
  )
  select count(*)::integer into expired_count from removed;

  with candidates as (
    select session.token_sha256
    from app_private.yandex_app_sessions session
    where session.revoked_at is not null
    order by session.revoked_at, session.token_sha256
    limit 50
    for update skip locked
  ), removed as (
    delete from app_private.yandex_app_sessions session
    using candidates
    where session.token_sha256 = candidates.token_sha256
    returning 1
  )
  select count(*)::integer into revoked_count from removed;

  return expired_count + revoked_count;
end;
$$;

revoke all on function app_private.cleanup_yandex_app_sessions() from public;
grant execute on function app_private.cleanup_yandex_app_sessions() to fit_api;

-- Down Migration

set local lock_timeout = '3s';
set local statement_timeout = '15s';

revoke execute on function app_private.cleanup_yandex_app_sessions() from fit_api;
drop function app_private.cleanup_yandex_app_sessions();
drop index app_private.yandex_app_sessions_cleanup_revoked_idx;
drop index app_private.yandex_app_sessions_cleanup_expired_idx;

create or replace function app_private.create_yandex_app_session(
  p_subject_sha256 text,
  p_token_sha256 text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  then
    raise exception 'invalid_yandex_app_session' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || p_subject_sha256, 0)
  );

  select identity.profile_id
  into actor_id
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
  for update of identity, profile;

  if actor_id is null then
    return null;
  end if;

  insert into app_private.profile_rollout_assignments (
    profile_id, target_backend, access_mode, enabled
  ) values (
    actor_id, 'yandex', 'read_write', true
  ) on conflict (profile_id) do update set
    target_backend = excluded.target_backend,
    access_mode = excluded.access_mode,
    enabled = excluded.enabled
  where profile_rollout_assignments.enabled;

  actor_id := app_private.resolve_yandex_app_actor(p_subject_sha256);
  if actor_id is null then
    return null;
  end if;

  delete from app_private.yandex_app_sessions
  where expires_at <= now() or revoked_at is not null;

  insert into app_private.yandex_app_sessions (
    token_sha256, profile_id, access_mode, expires_at
  ) values (
    p_token_sha256, actor_id, 'read_write', p_expires_at
  );

  return actor_id;
end;
$$;

create or replace function app_private.recover_migrated_yandex_account(
  p_token_sha256 text,
  p_profile_id uuid,
  p_account_role text,
  p_session_token_sha256 text,
  p_session_expires_at timestamptz
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_profile_id uuid;
  recovered_subject_sha256 text;
begin
  if p_session_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_session_expires_at <= now()
    or p_session_expires_at > now() + interval '30 days'
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  select linked.profile_id, linked.subject_sha256
  into recovered_profile_id, recovered_subject_sha256
  from app_private.link_migrated_yandex_account(
    p_token_sha256,
    p_profile_id,
    p_account_role
  ) linked;

  if recovered_profile_id is null
    or recovered_subject_sha256 is null
    or recovered_profile_id <> p_profile_id
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  delete from app_private.yandex_app_sessions
  where expires_at <= now() or revoked_at is not null;

  insert into app_private.yandex_app_sessions (
    token_sha256, profile_id, access_mode, expires_at
  ) values (
    p_session_token_sha256,
    recovered_profile_id,
    'read_write',
    p_session_expires_at
  );

  return query select recovered_profile_id, recovered_subject_sha256;
end;
$$;

