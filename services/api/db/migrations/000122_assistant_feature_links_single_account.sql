-- Up Migration

-- Navigation answers are a single-account product pilot. Yandex ID returns the
-- native login without @yandex.ru, so only its normalized hash is stored.
create table app_private.assistant_feature_links_pilot_allowlist (
  login_sha256 text primary key,
  profile_id uuid unique references public.profiles (id) on delete set null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint assistant_feature_links_login_hash_format
    check (login_sha256 = 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3')
);

revoke all on app_private.assistant_feature_links_pilot_allowlist from public;

insert into app_private.assistant_feature_links_pilot_allowlist (login_sha256, enabled)
values ('cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3', true);

create function app_private.assistant_feature_links_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.assistant_feature_links_pilot_allowlist allowed
    where allowed.profile_id = auth.uid()
      and allowed.enabled
  )
$$;

revoke all on function app_private.assistant_feature_links_enabled() from public;
grant execute on function app_private.assistant_feature_links_enabled() to fit_api;

create function app_private.bind_assistant_feature_links_for_yandex_login(
  p_subject_sha256 text,
  p_login_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_login_sha256 <> 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3'
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assistant_feature_links_pilot', 0)
  );

  select identity.profile_id
  into v_profile_id
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
    and profile.account_role in ('trainer', 'client');

  if v_profile_id is null
    or exists (
      select 1 from app_private.assistant_feature_links_pilot_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
        and allowed.profile_id is not null
        and allowed.profile_id <> v_profile_id
    )
  then
    return false;
  end if;

  update app_private.assistant_feature_links_pilot_allowlist
  set profile_id = v_profile_id, updated_at = now()
  where login_sha256 = p_login_sha256;

  return true;
end;
$$;

revoke all on function app_private.bind_assistant_feature_links_for_yandex_login(text, text)
  from public;
grant execute on function app_private.bind_assistant_feature_links_for_yandex_login(text, text)
  to fit_api;

-- Down Migration

revoke execute on function app_private.assistant_feature_links_enabled() from fit_api;
revoke execute on function app_private.bind_assistant_feature_links_for_yandex_login(text, text)
  from fit_api;
drop function app_private.bind_assistant_feature_links_for_yandex_login(text, text);
drop function app_private.assistant_feature_links_enabled();
drop table app_private.assistant_feature_links_pilot_allowlist;
