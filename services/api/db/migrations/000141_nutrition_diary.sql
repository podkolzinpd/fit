-- Up Migration
-- Private normalized source data. The external retailer never enters UI DTOs.
create table app_private.nutrition_food_catalog (
  id uuid primary key,
  source_id bigint not null,
  name text not null check (char_length(name) between 2 and 160),
  calories numeric(12,4) not null check (calories between 0 and 1000),
  protein numeric(12,4) check (protein between 0 and 100),
  fat numeric(12,4) check (fat between 0 and 100),
  carbs numeric(12,4) check (carbs between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on app_private.nutrition_food_catalog
for each row execute function public.set_updated_at();
alter table app_private.nutrition_food_catalog enable row level security;
create policy nutrition_food_catalog_actor on app_private.nutrition_food_catalog
for all to fit_api using (auth.uid() is not null) with check (auth.uid() is not null);
revoke all on app_private.nutrition_food_catalog from public;
grant select, insert on app_private.nutrition_food_catalog to fit_api;

-- Consent belongs to this exact connection generation, never just trainer ID.
create table public.nutrition_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  trainer_id uuid not null references public.trainers (profile_id) on delete cascade,
  connection_started_at timestamptz not null,
  granted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, client_id, trainer_id, connection_started_at)
);
create trigger set_updated_at before update on public.nutrition_consents
for each row execute function public.set_updated_at();
alter table public.nutrition_consents enable row level security;
create policy nutrition_consents_read on public.nutrition_consents for select to fit_api
using (owner_id = auth.uid() or trainer_id = auth.uid());
create policy nutrition_consents_insert on public.nutrition_consents for insert to fit_api
with check (owner_id = auth.uid() and exists (
  select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()
    and c.archived_at is null and c.merged_into_client_id is null
) and exists (
  select 1 from public.list_accessible_client_trainers() connection
  where connection.client_id = nutrition_consents.client_id
    and connection.trainer_id = nutrition_consents.trainer_id
    and connection.joined_at = nutrition_consents.connection_started_at
));
create policy nutrition_consents_update on public.nutrition_consents for update to fit_api
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.nutrition_consents from public;
grant select, insert, update (granted) on public.nutrition_consents to fit_api;

create function public.can_read_nutrition(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    p_owner_id = auth.uid()
    or exists (
      select 1 from public.nutrition_consents consent
      join public.clients c on c.id = consent.client_id and c.auth_user_id = consent.owner_id
      join public.list_accessible_client_trainers() connection
        on connection.client_id = consent.client_id and connection.trainer_id = consent.trainer_id
          and connection.joined_at = consent.connection_started_at
      join public.profiles trainer on trainer.id = consent.trainer_id and trainer.account_role = 'trainer'
      where consent.owner_id = p_owner_id and consent.trainer_id = auth.uid() and consent.granted
        and c.archived_at is null and c.merged_into_client_id is null
        and public.is_active_client_trainer_connection(c.id, consent.trainer_id)
    )
  );
$$;
revoke all on function public.can_read_nutrition(uuid) from public;
grant execute on function public.can_read_nutrition(uuid) to fit_api;

-- Snapshots are independent of catalog updates and optional client cards.
create table public.nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name text not null check (char_length(name) between 1 and 160),
  basis text not null check (basis in ('100g', 'portion')),
  grams numeric(12,4),
  calories numeric(12,4) not null check (calories between 0 and 50000),
  protein numeric(12,4) check (protein between 0 and 5000),
  fat numeric(12,4) check (fat between 0 and 5000),
  carbs numeric(12,4) check (carbs between 0 and 5000),
  deleted_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_entries_basis_quantity check (
    (basis = '100g' and grams is not null and grams > 0 and grams <= 20000)
    or (basis = 'portion' and grams is null)
  )
);
create index nutrition_entries_owner_day on public.nutrition_entries (owner_id, day, created_at)
where deleted_at is null;
create index nutrition_entries_owner_recent on public.nutrition_entries (owner_id, updated_at desc)
where deleted_at is null;
create trigger set_updated_at before update on public.nutrition_entries
for each row execute function public.set_updated_at();
alter table public.nutrition_entries enable row level security;
create policy nutrition_entries_read on public.nutrition_entries for select to fit_api
using (public.can_read_nutrition(owner_id));
create policy nutrition_entries_insert on public.nutrition_entries for insert to fit_api
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.account_role = 'client'
));
create policy nutrition_entries_update on public.nutrition_entries for update to fit_api
using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.account_role = 'client'
));
revoke all on public.nutrition_entries from public;
grant select, insert, update (day, meal, name, basis, grams, calories, protein, fat, carbs, deleted_at, version)
on public.nutrition_entries to fit_api;

-- Down Migration
drop table public.nutrition_entries;
drop function public.can_read_nutrition(uuid);
drop table public.nutrition_consents;
drop table app_private.nutrition_food_catalog;
