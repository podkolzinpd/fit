-- Up Migration

create table app_private.yandex_app_sessions (
  token_sha256 text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  access_mode text not null default 'read_write',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint yandex_app_sessions_token_sha256_format
    check (token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint yandex_app_sessions_access_mode_allowed
    check (access_mode = 'read_write'),
  constraint yandex_app_sessions_expiry_after_creation
    check (expires_at > created_at)
);

create index yandex_app_sessions_profile_expiry_idx
  on app_private.yandex_app_sessions (profile_id, expires_at desc)
  where revoked_at is null;

create or replace function public.link_yandex_identity(
  p_subject_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_profile_id uuid;
  existing_subject_sha256 text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_subject_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'yandex_identity_invalid' using errcode = 'PT422';
  end if;
  if not exists (
    select 1 from public.profiles profile where profile.id = actor_id
  ) then
    raise exception 'profile_not_found' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || p_subject_sha256, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('yandex_profile:' || actor_id::text, 0)
  );

  select identity.profile_id
  into existing_profile_id
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
  for update;

  if existing_profile_id is not null and existing_profile_id <> actor_id then
    raise exception 'yandex_identity_already_linked' using errcode = 'PT409';
  end if;

  select identity.provider_subject_sha256
  into existing_subject_sha256
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.profile_id = actor_id
  for update;

  if existing_subject_sha256 is not null
    and existing_subject_sha256 <> p_subject_sha256
  then
    raise exception 'yandex_profile_already_linked' using errcode = 'PT409';
  end if;

  insert into app_private.auth_identities (
    provider, provider_subject_sha256, profile_id
  ) values (
    'yandex', p_subject_sha256, actor_id
  )
  on conflict (provider, provider_subject_sha256) do nothing;

  return actor_id;
end;
$$;

create or replace function app_private.resolve_yandex_app_actor(
  p_subject_sha256 text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity.profile_id
  from app_private.auth_identities identity
  join app_private.profile_rollout_assignments rollout
    on rollout.profile_id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
    and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_write'
    and rollout.enabled
$$;

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

create or replace function app_private.resolve_yandex_app_session(
  p_token_sha256 text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select session.profile_id
  from app_private.yandex_app_sessions session
  join app_private.profile_rollout_assignments rollout
    on rollout.profile_id = session.profile_id
  where session.token_sha256 = p_token_sha256
    and session.access_mode = 'read_write'
    and session.expires_at > now()
    and session.revoked_at is null
    and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_write'
    and rollout.enabled
$$;

create or replace function app_private.revoke_yandex_app_session(
  p_token_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update app_private.yandex_app_sessions
  set revoked_at = now()
  where token_sha256 = p_token_sha256
    and revoked_at is null;

  return found;
end;
$$;

revoke all on app_private.yandex_app_sessions from public;
revoke all on function public.link_yandex_identity(text) from public;
revoke all on function app_private.resolve_yandex_app_actor(text) from public;
revoke all on function app_private.create_yandex_app_session(text, text, timestamptz) from public;
revoke all on function app_private.resolve_yandex_app_session(text) from public;
revoke all on function app_private.revoke_yandex_app_session(text) from public;

grant execute on function public.link_yandex_identity(text) to fit_api;
grant execute on function app_private.create_yandex_app_session(text, text, timestamptz) to fit_api;
grant execute on function app_private.resolve_yandex_app_session(text) to fit_api;
grant execute on function app_private.revoke_yandex_app_session(text) to fit_api;

-- Down Migration

revoke execute on function app_private.revoke_yandex_app_session(text) from fit_api;
revoke execute on function app_private.resolve_yandex_app_session(text) from fit_api;
revoke execute on function app_private.create_yandex_app_session(text, text, timestamptz) from fit_api;
revoke execute on function public.link_yandex_identity(text) from fit_api;

drop function app_private.revoke_yandex_app_session(text);
drop function app_private.resolve_yandex_app_session(text);
drop function app_private.create_yandex_app_session(text, text, timestamptz);
drop function app_private.resolve_yandex_app_actor(text);
drop function public.link_yandex_identity(text);
drop table app_private.yandex_app_sessions;
