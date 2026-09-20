-- Up Migration

-- Legacy credentials are verified by the API before this function is called.
-- Keep identity linking, rollout enablement, handoff consumption and the first
-- app session in one database transaction so recovery cannot leave a linked
-- user on the setup screen without a usable session.
create or replace function app_private.recover_migrated_yandex_account(
  p_token_sha256 text,
  p_profile_id uuid,
  p_account_role text,
  p_session_token_sha256 text,
  p_session_expires_at timestamptz
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_profile_id uuid;
  recovered_subject_sha256 text;
begin
  if p_session_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_session_expires_at <= now()
    or p_session_expires_at > now() + interval '30 days'
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  select linked.profile_id, linked.subject_sha256
  into recovered_profile_id, recovered_subject_sha256
  from app_private.link_migrated_yandex_account(
    p_token_sha256,
    p_profile_id,
    p_account_role
  ) linked;

  if recovered_profile_id is null
    or recovered_subject_sha256 is null
    or recovered_profile_id <> p_profile_id
  then
    raise exception 'yandex_recovery_session_invalid' using errcode = 'PT422';
  end if;

  delete from app_private.yandex_app_sessions
  where expires_at <= now() or revoked_at is not null;

  insert into app_private.yandex_app_sessions (
    token_sha256, profile_id, access_mode, expires_at
  ) values (
    p_session_token_sha256,
    recovered_profile_id,
    'read_write',
    p_session_expires_at
  );

  return query select recovered_profile_id, recovered_subject_sha256;
end;
$$;

revoke all on function app_private.recover_migrated_yandex_account(
  text, uuid, text, text, timestamptz
) from public;
grant execute on function app_private.recover_migrated_yandex_account(
  text, uuid, text, text, timestamptz
) to fit_api;

-- Down Migration

revoke execute on function app_private.recover_migrated_yandex_account(
  text, uuid, text, text, timestamptz
) from fit_api;
drop function app_private.recover_migrated_yandex_account(
  text, uuid, text, text, timestamptz
);
