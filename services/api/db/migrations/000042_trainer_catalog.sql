-- Up Migration

alter table public.trainer_professional_profiles
  add column listed_in_catalog boolean not null default false;

create index trainer_profiles_catalog_idx
  on public.trainer_professional_profiles (published_at desc)
  where listed_in_catalog and published_data is not null;

-- Down Migration

drop index public.trainer_profiles_catalog_idx;
alter table public.trainer_professional_profiles
  drop column listed_in_catalog;
