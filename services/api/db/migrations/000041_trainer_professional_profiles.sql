-- Up Migration

create table public.trainer_professional_profiles (
  trainer_id uuid primary key references public.trainers (profile_id) on delete cascade,
  public_id uuid not null unique default gen_random_uuid(),
  draft_data jsonb not null default '{}'::jsonb,
  published_data jsonb,
  published_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_profile_draft_object check (jsonb_typeof(draft_data) = 'object'),
  constraint trainer_profile_published_object check (published_data is null or jsonb_typeof(published_data) = 'object'),
  constraint trainer_profile_payload_size check (
    octet_length(draft_data::text) <= 1200000
    and (published_data is null or octet_length(published_data::text) <= 1200000)
  )
);

create trigger set_updated_at before update on public.trainer_professional_profiles
for each row execute function public.set_updated_at();

alter table public.trainer_professional_profiles enable row level security;

create policy trainer_profiles_manage_own on public.trainer_professional_profiles
  for all to fit_api
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create policy trainer_profiles_read_published on public.trainer_professional_profiles
  for select to fit_api using (published_data is not null);

grant select, insert, update on public.trainer_professional_profiles to fit_api;

-- Down Migration

revoke select, insert, update on public.trainer_professional_profiles from fit_api;
drop policy trainer_profiles_read_published on public.trainer_professional_profiles;
drop policy trainer_profiles_manage_own on public.trainer_professional_profiles;
drop table public.trainer_professional_profiles;
