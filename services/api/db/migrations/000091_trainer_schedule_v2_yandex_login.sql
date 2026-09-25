-- Up Migration

create function app_private.activate_trainer_schedule_v2_for_yandex_login(
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
    or p_login_sha256 <> '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71'
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

revoke all on function app_private.activate_trainer_schedule_v2_for_yandex_login(text, text)
  from public;
grant execute on function app_private.activate_trainer_schedule_v2_for_yandex_login(text, text)
  to fit_api;

-- Down Migration

revoke execute on function app_private.activate_trainer_schedule_v2_for_yandex_login(text, text)
  from fit_api;
drop function app_private.activate_trainer_schedule_v2_for_yandex_login(text, text);
