-- Up Migration

create table app_private.user_experiment_assignments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  experiment_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, experiment_key),
  constraint user_experiment_assignments_key_allowed
    check (experiment_key in ('trainer_schedule_v2'))
);

create function app_private.trainer_schedule_v2_enabled()
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

revoke all on app_private.user_experiment_assignments from public;
revoke all on function app_private.trainer_schedule_v2_enabled() from public;
grant execute on function app_private.trainer_schedule_v2_enabled() to fit_api;

-- Down Migration

revoke execute on function app_private.trainer_schedule_v2_enabled() from fit_api;
drop function app_private.trainer_schedule_v2_enabled();
drop table app_private.user_experiment_assignments;
