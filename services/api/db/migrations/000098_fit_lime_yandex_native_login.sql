-- Up Migration

-- Yandex ID returns the native login without @yandex.ru. The second trainer's
-- pilot rows were keyed by the email address instead, so OAuth could not bind
-- either flag to the trainer profile. Keep profile_id and enabled unchanged.
do $$
declare
  v_old_hash constant text := 'a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f';
  v_login_hash constant text := '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581';
  v_rows integer;
begin
  update app_private.trainer_schedule_v2_allowlist
  set login_sha256 = v_login_hash, updated_at = now()
  where login_sha256 = v_old_hash;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'trainer_schedule_v2_native_login_invariant';
  end if;

  update app_private.fit_lime_pilot_allowlist
  set login_sha256 = v_login_hash, updated_at = now()
  where login_sha256 = v_old_hash;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'fit_lime_native_login_invariant';
  end if;
end;
$$;

-- Down Migration

do $$
declare
  v_email_hash constant text := 'a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f';
  v_login_hash constant text := '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581';
  v_rows integer;
begin
  update app_private.trainer_schedule_v2_allowlist
  set login_sha256 = v_email_hash, updated_at = now()
  where login_sha256 = v_login_hash;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'trainer_schedule_v2_email_login_rollback_invariant';
  end if;

  update app_private.fit_lime_pilot_allowlist
  set login_sha256 = v_email_hash, updated_at = now()
  where login_sha256 = v_login_hash;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'fit_lime_email_login_rollback_invariant';
  end if;
end;
$$;
