-- Up Migration

-- Feature-only bindings, established exclusively after provider-verified login.
-- No contact data, profile creation, role changes, connections or consents.
create table app_private.nutrition_native_bindings (
  login_sha256 text primary key check (login_sha256 ~ '^[0-9a-f]{64}$'),
  subject_sha256 text not null unique check (subject_sha256 ~ '^[0-9a-f]{64}$'),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  account_role text not null check (account_role in ('client', 'trainer')),
  bound_at timestamptz not null default now()
);
revoke all on app_private.nutrition_native_bindings from public, fit_api;

create function app_private.bind_nutrition_for_yandex_login(p_subject text, p_login text, p_role text)
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
    >= (case when p_role = 'client' then 3 else 2 end) then return false; end if;
  insert into app_private.nutrition_native_bindings (login_sha256, subject_sha256, profile_id, account_role)
  values (p_login, p_subject, v_profile, p_role);
  return true;
end;
$$;

-- Hashes remain server-private. Checking a target does not grant diary access:
-- the diary's separate RLS still requires a live connection and client consent.
create function app_private.nutrition_login_for_profile(p_profile uuid, p_role text)
returns text language sql stable security definer set search_path = '' as $$
  select b.login_sha256 from app_private.nutrition_native_bindings b
  join public.profiles p on p.id = b.profile_id and p.account_role = b.account_role
  join app_private.auth_identities i on i.profile_id = b.profile_id
    and i.provider = 'yandex' and i.provider_subject_sha256 = b.subject_sha256
  join app_private.profile_rollout_assignments r on r.profile_id = b.profile_id
    and r.enabled and r.target_backend = 'yandex' and r.access_mode = 'read_write'
  where b.profile_id = p_profile and b.account_role = p_role
    and (p_role = 'trainer' and exists (select 1 from public.trainers t where t.profile_id = p.id)
      or p_role = 'client' and exists (select 1 from public.clients c where c.auth_user_id = p.id
        and c.merged_into_client_id is null and c.archived_at is null))
$$;
revoke all on function app_private.bind_nutrition_for_yandex_login(text, text, text) from public;
revoke all on function app_private.nutrition_login_for_profile(uuid, text) from public;
grant execute on function app_private.bind_nutrition_for_yandex_login(text, text, text) to fit_api;
grant execute on function app_private.nutrition_login_for_profile(uuid, text) to fit_api;

-- Down Migration
drop function app_private.nutrition_login_for_profile(uuid, text);
drop function app_private.bind_nutrition_for_yandex_login(text, text, text);
drop table app_private.nutrition_native_bindings;
