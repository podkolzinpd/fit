-- Up Migration

-- Owner-approved login only, bound from a provider-verified OAuth response.
-- No public registration role or user-editable email participates in this decision.
create table app_private.corporate_admin_logins (
  login_sha256 text primary key check(login_sha256 ~ '^[0-9a-f]{64}$'),
  subject_sha256 text unique check(subject_sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  bound_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index corporate_admin_one_enabled_login on app_private.corporate_admin_logins((true)) where enabled;
alter table app_private.corporate_admin_logins enable row level security;
revoke all on app_private.corporate_admin_logins from public,fit_api;

create function app_private.bind_corporate_admin_login(p_subject text,p_login text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_subject is null or p_login is null or p_subject !~ '^[0-9a-f]{64}$' or p_login !~ '^[0-9a-f]{64}$' then return false; end if;
  -- The first verified subject wins; a reused login cannot silently move access.
  update app_private.corporate_admin_logins
    set subject_sha256=p_subject,bound_at=coalesce(bound_at,now())
    where login_sha256=p_login and enabled and (subject_sha256 is null or subject_sha256=p_subject);
  return found;
exception when unique_violation then return false;
end $$;
revoke all on function app_private.bind_corporate_admin_login(text,text) from public;
grant execute on function app_private.bind_corporate_admin_login(text,text) to fit_api;

create or replace function app_private.is_corporate_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.corporate_admins where profile_id=auth.uid() and enabled)
    or exists(select 1 from app_private.corporate_admin_logins allowed
      join app_private.auth_identities identity on identity.provider='yandex'
        and identity.provider_subject_sha256=allowed.subject_sha256
      where identity.profile_id=auth.uid() and allowed.enabled)
$$;

-- Down Migration
create or replace function app_private.is_corporate_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.corporate_admins where profile_id=auth.uid() and enabled)
$$;
drop function app_private.bind_corporate_admin_login(text,text);
drop table app_private.corporate_admin_logins;
