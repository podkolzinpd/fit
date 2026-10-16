-- Up Migration

-- Admission ceiling only: exact private cohort/role checks remain in the API.
-- Do not rewrite historical migrations143/144 or create/reassign identities, roles or consents.
create or replace function app_private.bind_nutrition_for_yandex_login(p_subject text, p_login text, p_role text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if p_subject is null or p_login is null or p_role is null
    or p_subject !~ '^[0-9a-f]{64}$' or p_login !~ '^[0-9a-f]{64}$'
    or p_role not in ('client', 'trainer') then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nutrition_native_cohort', 0));
  select identity.profile_id into v_profile
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  join app_private.profile_rollout_assignments rollout on rollout.profile_id = profile.id
  where identity.provider = 'yandex' and identity.provider_subject_sha256 = p_subject
    and profile.account_role = p_role and rollout.enabled and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_write'
    and (p_role = 'trainer' and exists (select 1 from public.trainers t where t.profile_id = profile.id)
      or p_role = 'client' and exists (select 1 from public.clients c where c.auth_user_id = profile.id
        and c.merged_into_client_id is null and c.archived_at is null));
  if v_profile is null then return false; end if;
  if exists (select 1 from app_private.nutrition_native_bindings b
    where (b.login_sha256 = p_login or b.subject_sha256 = p_subject or b.profile_id = v_profile)
      and (b.login_sha256 <> p_login or b.subject_sha256 <> p_subject
        or b.profile_id <> v_profile or b.account_role <> p_role)) then return false; end if;
  if exists (select 1 from app_private.nutrition_native_bindings where login_sha256 = p_login)
    then return true; end if;
  if (select count(*) from app_private.nutrition_native_bindings where account_role = p_role)
    >= (case when p_role = 'client' then 5 else 2 end) then return false; end if;
  insert into app_private.nutrition_native_bindings (login_sha256, subject_sha256, profile_id, account_role)
  values (p_login, p_subject, v_profile, p_role);
  return true;
end;
$$;

-- Down Migration

-- Restore the prior admission ceiling without deleting any feature bindings.
create or replace function app_private.bind_nutrition_for_yandex_login(p_subject text, p_login text, p_role text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if p_subject is null or p_login is null or p_role is null
    or p_subject !~ '^[0-9a-f]{64}$' or p_login !~ '^[0-9a-f]{64}$'
    or p_role not in ('client', 'trainer') then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nutrition_native_cohort', 0));
  select identity.profile_id into v_profile
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  join app_private.profile_rollout_assignments rollout on rollout.profile_id = profile.id
  where identity.provider = 'yandex' and identity.provider_subject_sha256 = p_subject
    and profile.account_role = p_role and rollout.enabled and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_write'
    and (p_role = 'trainer' and exists (select 1 from public.trainers t where t.profile_id = profile.id)
      or p_role = 'client' and exists (select 1 from public.clients c where c.auth_user_id = profile.id
        and c.merged_into_client_id is null and c.archived_at is null));
  if v_profile is null then return false; end if;
  if exists (select 1 from app_private.nutrition_native_bindings b
    where (b.login_sha256 = p_login or b.subject_sha256 = p_subject or b.profile_id = v_profile)
      and (b.login_sha256 <> p_login or b.subject_sha256 <> p_subject
        or b.profile_id <> v_profile or b.account_role <> p_role)) then return false; end if;
  if exists (select 1 from app_private.nutrition_native_bindings where login_sha256 = p_login)
    then return true; end if;
  if (select count(*) from app_private.nutrition_native_bindings where account_role = p_role)
    >= (case when p_role = 'client' then 4 else 2 end) then return false; end if;
  insert into app_private.nutrition_native_bindings (login_sha256, subject_sha256, profile_id, account_role)
  values (p_login, p_subject, v_profile, p_role);
  return true;
end;
$$;
