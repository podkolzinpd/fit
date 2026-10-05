-- Up Migration

-- The pilot was seeded with a mistyped native Yandex login. Replace it with
-- the reviewed login and revoke any profile binding that the typo may have
-- acquired before allowing the correct account to bind on its next OAuth pass.
alter table app_private.assistant_feature_links_pilot_allowlist
  drop constraint assistant_feature_links_login_hash_format;

do $$
begin
  update app_private.assistant_feature_links_pilot_allowlist
  set login_sha256 = 'f0afe245c0ed9fd6c2447048feb3b620175e5a887c7a7c50283aba9408139904',
      profile_id = null,
      updated_at = now()
  where login_sha256 = 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3';

  if not found then
    raise exception 'assistant_feature_links_login_repair_invariant';
  end if;
end;
$$;

alter table app_private.assistant_feature_links_pilot_allowlist
  add constraint assistant_feature_links_login_hash_format
  check (login_sha256 = 'f0afe245c0ed9fd6c2447048feb3b620175e5a887c7a7c50283aba9408139904');

create or replace function app_private.bind_assistant_feature_links_for_yandex_login(
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
    or p_login_sha256 <> 'f0afe245c0ed9fd6c2447048feb3b620175e5a887c7a7c50283aba9408139904'
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

-- Down Migration

alter table app_private.assistant_feature_links_pilot_allowlist
  drop constraint assistant_feature_links_login_hash_format;

do $$
begin
  update app_private.assistant_feature_links_pilot_allowlist
  set login_sha256 = 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3',
      profile_id = null,
      updated_at = now()
  where login_sha256 = 'f0afe245c0ed9fd6c2447048feb3b620175e5a887c7a7c50283aba9408139904';

  if not found then
    raise exception 'assistant_feature_links_login_repair_down_invariant';
  end if;
end;
$$;

alter table app_private.assistant_feature_links_pilot_allowlist
  add constraint assistant_feature_links_login_hash_format
  check (login_sha256 = 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3');

create or replace function app_private.bind_assistant_feature_links_for_yandex_login(
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
