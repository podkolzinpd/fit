-- Up Migration

-- Fit Lime is an independent presentation flag. Switching off Schedule V2
-- must not mutate it, and a later Yandex login must not undo a Lime rollback.
create table app_private.fit_lime_pilot_allowlist (
  login_sha256 text primary key,
  profile_id uuid unique references public.profiles (id) on delete set null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint fit_lime_pilot_login_hash_format
    check (login_sha256 ~ '^[0-9a-f]{64}$')
);

revoke all on app_private.fit_lime_pilot_allowlist from public;

insert into app_private.fit_lime_pilot_allowlist (
  login_sha256, profile_id, enabled
)
select allowed.login_sha256, allowed.profile_id, true
from app_private.trainer_schedule_v2_allowlist allowed
where allowed.login_sha256 in (
  '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
  'a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f'
);

do $$
begin
  if (select count(*) from app_private.fit_lime_pilot_allowlist) <> 2 then
    raise exception 'fit_lime_two_account_allowlist_invariant';
  end if;
end;
$$;

create function app_private.fit_lime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.fit_lime_pilot_allowlist allowed
    join public.profiles profile on profile.id = allowed.profile_id
    where allowed.profile_id = auth.uid()
      and allowed.enabled
      and profile.account_role = 'trainer'
  )
$$;

revoke all on function app_private.fit_lime_enabled() from public;
grant execute on function app_private.fit_lime_enabled() to fit_api;

create function app_private.bind_fit_lime_for_yandex_login(
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
    or p_login_sha256 !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1
      from app_private.fit_lime_pilot_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fit_lime_pilot', 0)
  );

  select identity.profile_id
  into v_profile_id
  from app_private.auth_identities identity
  join public.profiles profile on profile.id = identity.profile_id
  join public.trainers trainer on trainer.profile_id = profile.id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
    and profile.account_role = 'trainer';

  if v_profile_id is null
    or exists (
      select 1
      from app_private.fit_lime_pilot_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
        and allowed.profile_id is not null
        and allowed.profile_id <> v_profile_id
    )
    or exists (
      select 1
      from app_private.fit_lime_pilot_allowlist allowed
      where allowed.profile_id = v_profile_id
        and allowed.login_sha256 <> p_login_sha256
    )
  then
    return false;
  end if;

  -- The login only binds a verified trainer to the allowlist. It deliberately
  -- never sets enabled=true, so an emergency disable survives future logins.
  update app_private.fit_lime_pilot_allowlist
  set profile_id = v_profile_id,
    updated_at = now()
  where login_sha256 = p_login_sha256;

  return true;
end;
$$;

revoke all on function app_private.bind_fit_lime_for_yandex_login(text, text)
  from public;
grant execute on function app_private.bind_fit_lime_for_yandex_login(text, text)
  to fit_api;

-- Down Migration

revoke execute on function app_private.fit_lime_enabled() from fit_api;
revoke execute on function app_private.bind_fit_lime_for_yandex_login(text, text)
  from fit_api;
drop function app_private.bind_fit_lime_for_yandex_login(text, text);
drop function app_private.fit_lime_enabled();
drop table app_private.fit_lime_pilot_allowlist;
