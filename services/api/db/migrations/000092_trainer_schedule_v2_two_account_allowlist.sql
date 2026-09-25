-- Up Migration

create table app_private.trainer_schedule_v2_allowlist (
  login_sha256 text primary key,
  profile_id uuid unique references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint trainer_schedule_v2_allowlist_hash_format
    check (login_sha256 ~ '^[0-9a-f]{64}$')
);

revoke all on app_private.trainer_schedule_v2_allowlist from public;

do $$
declare
  v_enabled_count integer;
  v_existing_profile_id uuid;
begin
  select count(*), min(profile_id::text)::uuid
  into v_enabled_count, v_existing_profile_id
  from app_private.user_experiment_assignments
  where experiment_key = 'trainer_schedule_v2'
    and enabled;

  if v_enabled_count > 1 then
    raise exception 'trainer_schedule_v2_preexisting_assignment_invariant';
  end if;

  insert into app_private.trainer_schedule_v2_allowlist (
    login_sha256,
    profile_id
  ) values
    (
      '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
      v_existing_profile_id
    ),
    (
      'a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f',
      null
    );
end;
$$;

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

-- Down Migration

update app_private.user_experiment_assignments assignment
set enabled = false,
  updated_at = now()
where assignment.experiment_key = 'trainer_schedule_v2'
  and assignment.enabled
  and assignment.profile_id is distinct from (
    select allowed.profile_id
    from app_private.trainer_schedule_v2_allowlist allowed
    where allowed.login_sha256 =
      '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71'
  );

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
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_login_sha256 <>
      '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71'
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

  if v_profile_id is null then
    return false;
  end if;

  update app_private.user_experiment_assignments
  set enabled = false, updated_at = now()
  where experiment_key = 'trainer_schedule_v2'
    and enabled;

  insert into app_private.user_experiment_assignments (
    profile_id,
    experiment_key,
    enabled,
    updated_at
  ) values (
    v_profile_id,
    'trainer_schedule_v2',
    true,
    now()
  )
  on conflict (profile_id, experiment_key) do update set
    enabled = true,
    updated_at = excluded.updated_at;

  if (
    select count(*)
    from app_private.user_experiment_assignments
    where experiment_key = 'trainer_schedule_v2'
      and enabled
  ) <> 1 then
    raise exception 'trainer_schedule_v2_single_account_invariant';
  end if;

  return true;
end;
$$;

drop table app_private.trainer_schedule_v2_allowlist;
