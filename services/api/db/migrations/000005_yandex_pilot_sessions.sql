-- Up Migration

create table app_private.yandex_pilot_sessions (
  token_sha256 text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint yandex_pilot_sessions_token_sha256_format
    check (token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint yandex_pilot_sessions_expiry_after_creation
    check (expires_at > created_at)
);

create index yandex_pilot_sessions_profile_expiry_idx
  on app_private.yandex_pilot_sessions (profile_id, expires_at desc);

create or replace function app_private.create_yandex_pilot_session(
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
  if p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '1 hour'
  then
    raise exception 'invalid_pilot_session' using errcode = '22023';
  end if;

  actor_id := app_private.resolve_yandex_pilot_actor(p_subject_sha256);
  if actor_id is null then
    return null;
  end if;

  delete from app_private.yandex_pilot_sessions
  where expires_at <= now();

  insert into app_private.yandex_pilot_sessions (
    token_sha256, profile_id, expires_at
  ) values (
    p_token_sha256, actor_id, p_expires_at
  );

  return actor_id;
end;
$$;

create or replace function app_private.resolve_yandex_pilot_session(
  p_token_sha256 text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select session.profile_id
  from app_private.yandex_pilot_sessions session
  join app_private.profile_rollout_assignments rollout
    on rollout.profile_id = session.profile_id
  where session.token_sha256 = p_token_sha256
    and session.expires_at > now()
    and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_only'
    and rollout.enabled
$$;

revoke all on app_private.yandex_pilot_sessions from public;
revoke all on function app_private.create_yandex_pilot_session(text, text, timestamptz) from public;
revoke all on function app_private.resolve_yandex_pilot_session(text) from public;

grant execute on function app_private.create_yandex_pilot_session(text, text, timestamptz) to fit_api;
grant execute on function app_private.resolve_yandex_pilot_session(text) to fit_api;

-- Down Migration

revoke execute on function app_private.resolve_yandex_pilot_session(text) from fit_api;
revoke execute on function app_private.create_yandex_pilot_session(text, text, timestamptz) from fit_api;
drop function app_private.resolve_yandex_pilot_session(text);
drop function app_private.create_yandex_pilot_session(text, text, timestamptz);
drop table app_private.yandex_pilot_sessions;
