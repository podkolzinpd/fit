alter table public.user_feature_flags
  add column trainer_schedule_v2 boolean not null default false;

create policy "trainer_schedule_v2_flags_read_own" on public.user_feature_flags
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select (user_id, trainer_schedule_v2)
  on public.user_feature_flags to authenticated;

comment on column public.user_feature_flags.trainer_schedule_v2 is
  'Default-off access to the trainer Schedule V2 interface.';

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
  target_ready boolean;
  target_enabled boolean;
  enabled_assignments integer;
begin
  if p_profile_id is null
    or p_action is null
    or p_action not in ('inspect', 'enable', 'disable') then
    raise exception 'trainer_schedule_v2_invalid_request'
      using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trainer_schedule_v2', 0));

  select exists (
    select 1
    from public.profiles profile
    join public.trainers trainer on trainer.profile_id = profile.id
    where profile.id = p_profile_id
      and profile.account_role = 'trainer'
  ) into target_ready;

  if not target_ready then
    raise exception 'trainer_schedule_v2_profile_not_ready'
      using errcode = 'PT409';
  end if;

  if p_action <> 'inspect' then
    update public.user_feature_flags
    set trainer_schedule_v2 = false
    where trainer_schedule_v2;

    insert into public.user_feature_flags (user_id, trainer_schedule_v2)
    values (p_profile_id, p_action = 'enable')
    on conflict (user_id) do update
    set trainer_schedule_v2 = excluded.trainer_schedule_v2;
  end if;

  select coalesce(flag.trainer_schedule_v2, false)
  into target_enabled
  from (select p_profile_id as user_id) target
  left join public.user_feature_flags flag on flag.user_id = target.user_id;

  select count(*)::integer
  into enabled_assignments
  from public.user_feature_flags
  where trainer_schedule_v2;

  if p_action = 'enable' and (not target_enabled or enabled_assignments <> 1) then
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
  'Service-role-only single-account rollout control for trainer Schedule V2.';
