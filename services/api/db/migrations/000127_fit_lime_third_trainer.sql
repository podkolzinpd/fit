-- Up Migration

-- Number follows the merged flexible assistant scheduling migration.
-- Account identifiers are supplied privately to the IAM-protected runner,
-- never embedded in public code or migration history.
create or replace function app_private.activate_trainer_schedule_v2_for_yandex_login(
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
  v_enabled_count integer;
  v_bound_count integer;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_login_sha256 !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('trainer_schedule_v2', 0)
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
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
        and allowed.profile_id is not null
        and allowed.profile_id <> v_profile_id
    )
    or exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.profile_id = v_profile_id
        and allowed.login_sha256 <> p_login_sha256
    )
  then
    return false;
  end if;

  update app_private.trainer_schedule_v2_allowlist
  set profile_id = v_profile_id,
    updated_at = now()
  where login_sha256 = p_login_sha256;

  update app_private.user_experiment_assignments assignment
  set enabled = false,
    updated_at = now()
  where assignment.experiment_key = 'trainer_schedule_v2'
    and assignment.enabled
    and not exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.profile_id = assignment.profile_id
    );

  insert into app_private.user_experiment_assignments (
    profile_id,
    experiment_key,
    enabled,
    updated_at
  )
  select allowed.profile_id,
    'trainer_schedule_v2',
    true,
    now()
  from app_private.trainer_schedule_v2_allowlist allowed
  where allowed.profile_id is not null
  on conflict (profile_id, experiment_key) do update set
    enabled = true,
    updated_at = excluded.updated_at;

  select count(*)
  into v_bound_count
  from app_private.trainer_schedule_v2_allowlist
  where profile_id is not null;

  select count(*)
  into v_enabled_count
  from app_private.user_experiment_assignments
  where experiment_key = 'trainer_schedule_v2'
    and enabled;

  if v_bound_count < 1
    or v_bound_count > 3
    or v_enabled_count <> v_bound_count
  then
    raise exception 'trainer_schedule_v2_three_account_invariant';
  end if;

  return true;
end;
$$;

create function app_private.add_reviewed_trainer_lime_login(p_login_sha256 text)
returns table(approved_rows integer, added boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_login_sha256 is null or p_login_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'trainer_lime_invalid_hash' using errcode = 'PT422';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('trainer_schedule_v2', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fit_lime_pilot', 0)
  );

  select count(*)::integer into v_count
  from app_private.trainer_schedule_v2_allowlist;
  if v_count not in (2, 3)
    or exists (
      select 1 from app_private.trainer_schedule_v2_allowlist schedule
      full join app_private.fit_lime_pilot_allowlist lime using (login_sha256)
      where schedule.login_sha256 is null or lime.login_sha256 is null
    )
  then
    raise exception 'trainer_lime_cohort_mismatch' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from app_private.trainer_schedule_v2_allowlist
    where login_sha256 = p_login_sha256
  ) then
    -- Idempotent readback preserves binding and emergency disable state.
    return query select v_count, false;
    return;
  end if;
  if v_count = 3 then
    raise exception 'trainer_lime_cohort_full' using errcode = 'PT409';
  end if;

  insert into app_private.trainer_schedule_v2_allowlist(login_sha256)
  values (p_login_sha256);
  insert into app_private.fit_lime_pilot_allowlist(login_sha256, enabled)
  values (p_login_sha256, true);
  return query select 3, true;
end;
$$;

-- Only the migration owner can extend the reviewed cohort. Public app/runtime
-- credentials must not receive EXECUTE on this operation.
revoke all on function app_private.add_reviewed_trainer_lime_login(text)
  from public, fit_api;

-- Down Migration

drop function app_private.add_reviewed_trainer_lime_login(text);

update app_private.user_experiment_assignments assignment
set enabled = false, updated_at = now()
where assignment.experiment_key = 'trainer_schedule_v2'
  and assignment.profile_id in (
    select profile_id from app_private.trainer_schedule_v2_allowlist
    where login_sha256 not in ('9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71', '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581')
  );

delete from app_private.fit_lime_pilot_allowlist
where login_sha256 not in ('9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71', '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581');
delete from app_private.trainer_schedule_v2_allowlist
where login_sha256 not in ('9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71', '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581');

create or replace function app_private.activate_trainer_schedule_v2_for_yandex_login(
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
  v_enabled_count integer;
  v_bound_count integer;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_login_sha256 !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('trainer_schedule_v2', 0)
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
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.login_sha256 = p_login_sha256
        and allowed.profile_id is not null
        and allowed.profile_id <> v_profile_id
    )
    or exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.profile_id = v_profile_id
        and allowed.login_sha256 <> p_login_sha256
    )
  then
    return false;
  end if;

  update app_private.trainer_schedule_v2_allowlist
  set profile_id = v_profile_id,
    updated_at = now()
  where login_sha256 = p_login_sha256;

  update app_private.user_experiment_assignments assignment
  set enabled = false,
    updated_at = now()
  where assignment.experiment_key = 'trainer_schedule_v2'
    and assignment.enabled
    and not exists (
      select 1
      from app_private.trainer_schedule_v2_allowlist allowed
      where allowed.profile_id = assignment.profile_id
    );

  insert into app_private.user_experiment_assignments (
    profile_id,
    experiment_key,
    enabled,
    updated_at
  )
  select allowed.profile_id,
    'trainer_schedule_v2',
    true,
    now()
  from app_private.trainer_schedule_v2_allowlist allowed
  where allowed.profile_id is not null
  on conflict (profile_id, experiment_key) do update set
    enabled = true,
    updated_at = excluded.updated_at;

  select count(*)
  into v_bound_count
  from app_private.trainer_schedule_v2_allowlist
  where profile_id is not null;

  select count(*)
  into v_enabled_count
  from app_private.user_experiment_assignments
  where experiment_key = 'trainer_schedule_v2'
    and enabled;

  if v_bound_count < 1
    or v_bound_count > 2
    or v_enabled_count <> v_bound_count
  then
    raise exception 'trainer_schedule_v2_two_account_invariant';
  end if;

  return true;
end;
$$;
