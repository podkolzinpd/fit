-- Up Migration

-- Older account-linking flows could persist a linked Yandex identity before
-- the profile received its read-write rollout assignment. In Yandex-only mode
-- that leaves the user in a dead end: the existing identity prevents a new
-- recovery handoff, while the missing assignment prevents a FIT app session.
--
-- Repair only that legacy state while issuing a session. An explicitly
-- disabled or otherwise configured assignment is never changed, native
-- identities are never repaired here, and the role-specific migrated domain
-- root must already exist.
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
  identity_origin text;
  account_role text;
  has_trainer_root boolean;
  has_client_root boolean;
  has_rollout_assignment boolean;
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

  select
    identity.profile_id,
    identity.identity_origin,
    profile.account_role,
    exists (
      select 1
      from public.trainers trainer
      where trainer.profile_id = profile.id
    ),
    exists (
      select 1
      from public.clients client
      where client.auth_user_id = profile.id
    ),
    exists (
      select 1
      from app_private.profile_rollout_assignments assignment
      where assignment.profile_id = profile.id
    )
  into
    actor_id,
    identity_origin,
    account_role,
    has_trainer_root,
    has_client_root,
    has_rollout_assignment
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
  for update of identity, profile;

  if actor_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from app_private.profile_rollout_assignments assignment
    where assignment.profile_id = actor_id
      and assignment.target_backend = 'yandex'
      and assignment.access_mode = 'read_write'
      and assignment.enabled
  ) then
    if identity_origin <> 'linked'
      or has_rollout_assignment
      or (account_role = 'trainer' and not has_trainer_root)
      or (account_role = 'client' and not has_client_root)
    then
      return null;
    end if;

    insert into app_private.profile_rollout_assignments (
      profile_id, target_backend, access_mode, enabled
    ) values (
      actor_id, 'yandex', 'read_write', true
    ) on conflict (profile_id) do nothing;
  end if;

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
