create table private.trainer_schedule_v2_allowlist (
  login_sha256 text primary key,
  constraint trainer_schedule_v2_allowlist_hash_format
    check (login_sha256 ~ '^[0-9a-f]{64}$')
);

insert into private.trainer_schedule_v2_allowlist (login_sha256) values
  ('9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71'),
  ('a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f');

revoke all on private.trainer_schedule_v2_allowlist
  from public, anon, authenticated;

create trigger source_cutover_write_gate
before insert or update or delete on private.trainer_schedule_v2_allowlist
for each statement execute function private.enforce_source_cutover_write_gate();

create or replace function public.manage_trainer_schedule_v2_pilot(
  p_profile_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_login_sha256 text;
  target_role text;
  target_enabled boolean;
  enabled_assignments integer;
  writes_were_paused boolean;
begin
  if p_profile_id is null
    or p_action is null
    or p_action not in ('inspect', 'enable', 'disable') then
    raise exception 'trainer_schedule_v2_invalid_request'
      using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trainer_schedule_v2', 0));

  select profile.account_role,
    encode(
      extensions.digest(lower(btrim(auth_user.email)), 'sha256'),
      'hex'
    )
  into target_role, target_login_sha256
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  where profile.id = p_profile_id;

  if target_role is null then
    raise exception 'trainer_schedule_v2_profile_missing'
      using errcode = 'PT409';
  end if;
  if not exists (
    select 1
    from private.trainer_schedule_v2_allowlist allowed
    where allowed.login_sha256 = target_login_sha256
  ) then
    raise exception 'trainer_schedule_v2_account_not_allowed'
      using errcode = 'PT409';
  end if;
  if target_role <> 'trainer'
    and not (p_action = 'enable' and target_role = 'client') then
    raise exception 'trainer_schedule_v2_role_mismatch'
      using errcode = 'PT409';
  end if;

  if p_action <> 'inspect' then
    select gate.writes_paused
    into writes_were_paused
    from private.source_cutover_write_gate gate
    where gate.singleton;

    if writes_were_paused then
      perform private.set_source_cutover_write_gate(false);
    end if;

    if p_action = 'enable' then
      if target_role = 'client' then
        if exists (
          select 1
          from public.clients client
          where client.auth_user_id = p_profile_id
        ) then
          raise exception 'trainer_schedule_v2_linked_client_account'
            using errcode = 'PT409';
        end if;

        update public.profiles
        set account_role = 'trainer'
        where id = p_profile_id
          and account_role = 'client';
        target_role := 'trainer';
      end if;

      insert into public.trainers (profile_id)
      values (p_profile_id)
      on conflict (profile_id) do nothing;
    end if;

    update public.user_feature_flags flag
    set trainer_schedule_v2 = false
    where flag.trainer_schedule_v2
      and not exists (
        select 1
        from auth.users auth_user
        where auth_user.id = flag.user_id
          and exists (
            select 1
            from private.trainer_schedule_v2_allowlist allowed
            where allowed.login_sha256 = encode(
              extensions.digest(lower(btrim(auth_user.email)), 'sha256'),
              'hex'
            )
          )
      );

    insert into public.user_feature_flags (user_id, trainer_schedule_v2)
    values (p_profile_id, p_action = 'enable')
    on conflict (user_id) do update
    set trainer_schedule_v2 = excluded.trainer_schedule_v2;

    if writes_were_paused then
      perform private.set_source_cutover_write_gate(true);
    end if;
  end if;

  select coalesce(flag.trainer_schedule_v2, false)
  into target_enabled
  from (select p_profile_id as user_id) target
  left join public.user_feature_flags flag on flag.user_id = target.user_id;

  select count(*)::integer
  into enabled_assignments
  from public.user_feature_flags
  where trainer_schedule_v2;

  if exists (
    select 1
    from public.user_feature_flags flag
    left join auth.users auth_user on auth_user.id = flag.user_id
    where flag.trainer_schedule_v2
      and not exists (
        select 1
        from private.trainer_schedule_v2_allowlist allowed
        where allowed.login_sha256 = encode(
          extensions.digest(lower(btrim(auth_user.email)), 'sha256'),
          'hex'
        )
      )
  ) or enabled_assignments > 2 then
    raise exception 'trainer_schedule_v2_two_account_invariant_failed';
  end if;

  if p_action = 'enable' and (
    target_role <> 'trainer'
    or not target_enabled
    or enabled_assignments < 1
    or not exists (
      select 1 from public.trainers trainer
      where trainer.profile_id = p_profile_id
    )
  ) then
    raise exception 'trainer_schedule_v2_two_account_invariant_failed';
  end if;
  if p_action = 'disable' and target_enabled then
    raise exception 'trainer_schedule_v2_disable_invariant_failed';
  end if;

  return jsonb_build_object(
    'status', case p_action
      when 'inspect' then 'trainer_schedule_v2_inspected'
      when 'enable' then 'trainer_schedule_v2_enabled'
      else 'trainer_schedule_v2_disabled'
    end,
    'accountRole', 'trainer',
    'enabled', target_enabled,
    'enabledAssignments', enabled_assignments
  );
end;
$$;

revoke all on function public.manage_trainer_schedule_v2_pilot(uuid, text)
  from public, anon, authenticated;
grant execute on function public.manage_trainer_schedule_v2_pilot(uuid, text)
  to service_role;

comment on function public.manage_trainer_schedule_v2_pilot(uuid, text) is
  'Service-role-only two-account Schedule V2 rollout control for the reviewed trainer allowlist.';
