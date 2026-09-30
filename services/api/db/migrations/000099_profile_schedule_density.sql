-- Up Migration

alter table public.profiles
  add column schedule_density text not null default 'comfortable',
  add constraint profiles_schedule_density_allowed
    check (schedule_density in ('comfortable', 'compact'));

grant update (schedule_density) on public.profiles to fit_api;

-- Down Migration

revoke update (schedule_density) on public.profiles from fit_api;

alter table public.profiles
  drop constraint profiles_schedule_density_allowed,
  drop column schedule_density;
