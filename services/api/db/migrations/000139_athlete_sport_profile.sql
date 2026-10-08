-- Up Migration
-- Self-authored optional sport interests. Never included in trainer/client-card reads.
create table public.athlete_sport_profiles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  sports text[] not null default '{}',
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_sport_profiles_bio_length check (bio is null or char_length(bio) <= 160)
);

create trigger set_updated_at before update on public.athlete_sport_profiles
for each row execute function public.set_updated_at();

alter table public.athlete_sport_profiles enable row level security;
create policy athlete_sport_profiles_read_own on public.athlete_sport_profiles
  for select to fit_api using (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles where id = profile_id and account_role = 'client'));
create policy athlete_sport_profiles_insert_own on public.athlete_sport_profiles
  for insert to fit_api with check (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles where id = profile_id and account_role = 'client'));
create policy athlete_sport_profiles_update_own on public.athlete_sport_profiles
  for update to fit_api using (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles where id = profile_id and account_role = 'client'))
  with check (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles where id = profile_id and account_role = 'client'));

revoke all on public.athlete_sport_profiles from public;
grant select, insert, update (sports, bio) on public.athlete_sport_profiles to fit_api;

-- Down Migration
revoke select, insert, update (sports, bio) on public.athlete_sport_profiles from fit_api;
drop policy athlete_sport_profiles_update_own on public.athlete_sport_profiles;
drop policy athlete_sport_profiles_insert_own on public.athlete_sport_profiles;
drop policy athlete_sport_profiles_read_own on public.athlete_sport_profiles;
drop table public.athlete_sport_profiles;
