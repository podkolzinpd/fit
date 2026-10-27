-- Up Migration

-- Short-lived authentication evidence, also recorded before native registration.
-- No Staff profiles, logins or email addresses are stored. This is not an
-- employee directory and does not grant coaching or administrative permissions.
create table app_private.yandex_employee_verifications (
  subject_sha256 text primary key check (subject_sha256 ~ '^[0-9a-f]{64}$'),
  is_employee boolean not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table app_private.yandex_employee_verifications enable row level security;
revoke all on app_private.yandex_employee_verifications from public, fit_api;
create index yandex_employee_verifications_checked_at_idx
  on app_private.yandex_employee_verifications(checked_at);

create function app_private.record_yandex_employee_verification(
  p_subject_sha256 text, p_is_employee boolean, p_checked_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_subject_sha256 is null or p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_is_employee is null or p_checked_at is null
    or p_checked_at > now() + interval '1 minute'
    or p_checked_at < now() - interval '1 day' then
    raise exception 'employee_verification_invalid' using errcode = 'PT422';
  end if;
  -- Discard old authentication evidence, including never-completed signups.
  delete from app_private.yandex_employee_verifications where checked_at < now() - interval '7 days';
  insert into app_private.yandex_employee_verifications(subject_sha256, is_employee, checked_at)
    values(p_subject_sha256, p_is_employee, p_checked_at)
  on conflict(subject_sha256) do update
    set is_employee = excluded.is_employee, checked_at = excluded.checked_at
    where yandex_employee_verifications.checked_at < excluded.checked_at;
end;
$$;
revoke all on function app_private.record_yandex_employee_verification(text, boolean, timestamptz) from public;
grant execute on function app_private.record_yandex_employee_verification(text, boolean, timestamptz) to fit_api;

-- Own actor only. No parameter can request somebody else's Staff membership.
create function app_private.own_yandex_employee_verification()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'status', case when check_result.checked_at < now() - interval '1 day' then 'unknown'
      when check_result.is_employee then 'employee' else 'not_employee' end,
    'checkedAt', check_result.checked_at)
    from app_private.auth_identities identity
    join app_private.yandex_employee_verifications check_result
      on check_result.subject_sha256 = identity.provider_subject_sha256
    where identity.provider = 'yandex' and identity.profile_id = auth.uid()),
    jsonb_build_object('status', 'unknown', 'checkedAt', null));
$$;
revoke all on function app_private.own_yandex_employee_verification() from public;
grant execute on function app_private.own_yandex_employee_verification() to fit_api;

-- Down Migration
revoke execute on function app_private.own_yandex_employee_verification() from fit_api;
drop function app_private.own_yandex_employee_verification();
revoke execute on function app_private.record_yandex_employee_verification(text, boolean, timestamptz) from fit_api;
drop function app_private.record_yandex_employee_verification(text, boolean, timestamptz);
drop table app_private.yandex_employee_verifications;
