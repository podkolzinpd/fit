-- Up Migration

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  -- A self-managed client owns its historical partition without becoming a
  -- trainer, so this relationship intentionally targets profiles.
  trainer_id uuid not null references public.profiles (id) on delete restrict,
  auth_user_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null,
  gender text,
  age_years smallint,
  age_updated_at date,
  height_cm numeric(5, 2),
  goal text,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_full_name_not_blank check (btrim(full_name) <> ''),
  constraint clients_gender_allowed
    check (gender is null or gender in ('male', 'female')),
  constraint clients_age_range
    check (age_years is null or age_years between 1 and 119),
  constraint clients_height_range
    check (height_cm is null or (height_cm > 0 and height_cm < 260)),
  constraint clients_id_trainer_unique unique (id, trainer_id)
);

create table public.client_trainers (
  client_id uuid not null references public.clients (id) on delete cascade,
  trainer_id uuid not null references public.trainers (profile_id) on delete cascade,
  alias text,
  note text,
  version bigint not null default 1,
  joined_at timestamptz not null default now(),
  constraint client_trainers_pkey primary key (client_id, trainer_id),
  constraint client_trainers_alias_not_blank
    check (alias is null or btrim(alias) <> ''),
  constraint client_trainers_alias_length
    check (alias is null or char_length(alias) <= 120),
  constraint client_trainers_note_length
    check (note is null or char_length(note) <= 5000)
);

create index clients_trainer_created_idx
  on public.clients (trainer_id, created_at desc);
create index clients_auth_user_idx
  on public.clients (auth_user_id) where auth_user_id is not null;
create index client_trainers_trainer_idx
  on public.client_trainers (trainer_id, client_id);

create trigger set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.client_trainers enable row level security;

create or replace function public.can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and (
        client.auth_user_id = auth.uid()
        or client.trainer_id = auth.uid()
        or exists (
          select 1
          from public.client_trainers membership
          where membership.client_id = client.id
            and membership.trainer_id = auth.uid()
        )
      )
  )
$$;

revoke all on function public.can_access_client(uuid) from public;
grant execute on function public.can_access_client(uuid) to fit_api;

create policy clients_read_accessible on public.clients
  for select to fit_api
  using (public.can_access_client(id));

create policy client_trainers_read_accessible on public.client_trainers
  for select to fit_api
  using (public.can_access_client(client_id));

revoke all on public.clients, public.client_trainers from public;
grant select on public.clients, public.client_trainers to fit_api;

-- Down Migration

revoke select on public.clients, public.client_trainers from fit_api;
drop policy client_trainers_read_accessible on public.client_trainers;
drop policy clients_read_accessible on public.clients;
revoke execute on function public.can_access_client(uuid) from fit_api;
drop function public.can_access_client(uuid);
drop table public.client_trainers;
drop table public.clients;
