-- Up Migration

-- A linked Yandex identity is the authentication source after the Yandex-only
-- cutover. Historical rollout rows may still point at the former backend even
-- though they remain enabled. Treat every enabled assignment as migrational
-- drift and normalize it to the current Yandex read-write route. Preserve an
-- explicitly disabled row as the administrative access decision.
insert into app_private.profile_rollout_assignments (
  profile_id, target_backend, access_mode, enabled
)
select identity.profile_id, 'yandex', 'read_write', true
from app_private.auth_identities identity
join public.profiles profile on profile.id = identity.profile_id
where identity.provider = 'yandex'
on conflict (profile_id) do update set
  target_backend = excluded.target_backend,
  access_mode = excluded.access_mode,
  enabled = excluded.enabled
where profile_rollout_assignments.enabled;

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

-- Down Migration

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
  where profile_rollout_assignments.target_backend = 'yandex'
    and profile_rollout_assignments.access_mode = 'read_only'
    and profile_rollout_assignments.enabled;

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
