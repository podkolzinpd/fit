-- Up Migration

-- Installing these controls preserves the reviewed pilot. Global activation is
-- a separate owner operation requiring explicit human approval; never seed all.
create table app_private.lime_rollout_controls (
  singleton boolean primary key default true check (singleton),
  client_mode text not null default 'pilot' check (client_mode in ('pilot', 'all', 'off')),
  trainer_mode text not null default 'pilot' check (trainer_mode in ('pilot', 'all', 'off')),
  schedule_mode text not null default 'pilot' check (schedule_mode in ('pilot', 'all', 'off')),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint lime_trainer_all_requires_schedule_all check (trainer_mode <> 'all' or schedule_mode = 'all')
);
revoke all on app_private.lime_rollout_controls from public, fit_api;
insert into app_private.lime_rollout_controls (singleton) values (true);

create or replace function app_private.client_lime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.account_role = 'client'
  ) and coalesce((
    select case controls.client_mode
      when 'all' then true
      when 'pilot' then (select exists (
    select 1
    from app_private.client_lime_pilot_allowlist allowed
    join public.profiles profile on profile.id = allowed.profile_id
    where allowed.profile_id = auth.uid()
      and allowed.enabled
      and profile.account_role = 'client'
  ))
      else false
    end
    from app_private.lime_rollout_controls controls where controls.singleton
  ), false)
$$;

create or replace function app_private.fit_lime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.account_role = 'trainer'
  ) and coalesce((
    select case controls.trainer_mode
      when 'all' then true
      when 'pilot' then (select exists (
    select 1
    from app_private.fit_lime_pilot_allowlist allowed
    join public.profiles profile on profile.id = allowed.profile_id
    where allowed.profile_id = auth.uid()
      and allowed.enabled
      and profile.account_role = 'trainer'
  ))
      else false
    end
    from app_private.lime_rollout_controls controls where controls.singleton
  ), false)
$$;

create or replace function app_private.trainer_schedule_v2_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.account_role = 'trainer'
  ) and coalesce((
    select case controls.schedule_mode
      when 'all' then true
      when 'pilot' then (select exists (
    select 1
    from app_private.user_experiment_assignments assignment
    join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id = auth.uid()
      and assignment.experiment_key = 'trainer_schedule_v2'
      and assignment.enabled
      and profile.account_role = 'trainer'
  ))
      else false
    end
    from app_private.lime_rollout_controls controls where controls.singleton
  ), false)
$$;

-- No public RPC or fit_api grant: only the existing IAM migration owner
-- can inspect/change these controls. A revision guards stale/replayed requests.
create function app_private.set_lime_rollout_mode(
  p_target text, p_mode text, p_expected_revision integer
)
returns table (client_mode text, trainer_mode text, schedule_mode text, revision integer)
language plpgsql
set search_path = ''
as $$
declare
  result app_private.lime_rollout_controls%rowtype;
begin
  if p_target is null or p_target not in ('client', 'trainer', 'trainer-schedule')
    or p_mode is null or p_mode not in ('pilot', 'all', 'off')
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_lime_rollout_request' using errcode = 'PT422';
  end if;
  select * into result from app_private.lime_rollout_controls where singleton for update;
  if not found or result.revision <> p_expected_revision then
    raise exception 'lime_rollout_revision_conflict' using errcode = 'PT409';
  end if;
  if p_target = 'trainer-schedule' and p_mode <> 'all' and result.trainer_mode = 'all' then
    raise exception 'lime_rollout_schedule_dependency' using errcode = 'PT409';
  end if;
  update app_private.lime_rollout_controls controls set
    client_mode = case when p_target = 'client' then p_mode else controls.client_mode end,
    trainer_mode = case when p_target = 'trainer' then p_mode else controls.trainer_mode end,
    schedule_mode = case
      when p_target = 'trainer-schedule' or (p_target = 'trainer' and p_mode = 'all') then p_mode
      else controls.schedule_mode end,
    revision = controls.revision + 1,
    updated_at = now()
  where controls.singleton
  returning controls.* into result;
  return query select result.client_mode, result.trainer_mode, result.schedule_mode, result.revision;
end;
$$;
revoke all on function app_private.set_lime_rollout_mode(text, text, integer) from public, fit_api;

-- Down Migration

create or replace function app_private.client_lime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
select exists (
    select 1
    from app_private.client_lime_pilot_allowlist allowed
    join public.profiles profile on profile.id = allowed.profile_id
    where allowed.profile_id = auth.uid()
      and allowed.enabled
      and profile.account_role = 'client'
  )
$$;

create or replace function app_private.fit_lime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
select exists (
    select 1
    from app_private.fit_lime_pilot_allowlist allowed
    join public.profiles profile on profile.id = allowed.profile_id
    where allowed.profile_id = auth.uid()
      and allowed.enabled
      and profile.account_role = 'trainer'
  )
$$;

create or replace function app_private.trainer_schedule_v2_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
select exists (
    select 1
    from app_private.user_experiment_assignments assignment
    join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id = auth.uid()
      and assignment.experiment_key = 'trainer_schedule_v2'
      and assignment.enabled
      and profile.account_role = 'trainer'
  )
$$;

drop function app_private.set_lime_rollout_mode(text, text, integer);
drop table app_private.lime_rollout_controls;
