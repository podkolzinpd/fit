-- Up Migration

update public.trainer_professional_profiles
set listed_in_catalog = true
where published_data is not null
  and not listed_in_catalog;

-- Down Migration

select 1;
