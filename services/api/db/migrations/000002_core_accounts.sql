-- Up Migration

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  timezone text not null default 'Europe/Moscow',
  account_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_not_blank
    check (first_name is null or btrim(first_name) <> ''),
  constraint profiles_last_name_not_blank
    check (last_name is null or btrim(last_name) <> ''),
  constraint profiles_account_role_allowed
    check (account_role in ('trainer', 'client'))
);

create table public.trainers (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_updated_at
before update on public.trainers
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.trainers enable row level security;

create policy profiles_read_own on public.profiles
  for select to fit_api
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to fit_api
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy trainers_read_own on public.trainers
  for select to fit_api
  using (profile_id = (select auth.uid()));

revoke all on schema public from public;
revoke all on public.profiles, public.trainers from public;

grant usage on schema public to fit_api;
grant select on public.profiles, public.trainers to fit_api;
grant update (first_name, last_name, timezone) on public.profiles to fit_api;

-- Down Migration

revoke update (first_name, last_name, timezone) on public.profiles from fit_api;
revoke select on public.profiles, public.trainers from fit_api;
revoke usage on schema public from fit_api;

drop policy trainers_read_own on public.trainers;
drop policy profiles_update_own on public.profiles;
drop policy profiles_read_own on public.profiles;
drop table public.trainers;
drop table public.profiles;
drop function public.set_updated_at();
