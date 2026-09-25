-- A reviewed pilot account may predate explicit account-role selection and be
-- stored as a client despite never owning or joining a client card. The
-- service-role-only pilot operation may repair that empty shell, but it must
-- never convert an account that has client-domain ownership.
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

  select profile.account_role
  into target_role
  from public.profiles profile
  where profile.id = p_profile_id;

  if target_role is null then
    raise exception 'trainer_schedule_v2_profile_missing'
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

    update public.user_feature_flags
    set trainer_schedule_v2 = false
    where trainer_schedule_v2;

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

  if p_action = 'enable' and (
    target_role <> 'trainer'
    or not target_enabled
    or enabled_assignments <> 1
    or not exists (
      select 1 from public.trainers trainer
      where trainer.profile_id = p_profile_id
    )
  ) then
    raise exception 'trainer_schedule_v2_single_account_invariant_failed';
  end if;
  if p_action = 'disable' and (target_enabled or enabled_assignments <> 0) then
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
  'Service-role-only single-account Schedule V2 rollout control with bounded repair of missing trainer roots and unlinked legacy roles.';
