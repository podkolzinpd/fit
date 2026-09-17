-- Up Migration

-- Статус «бренд-тренер» — проставляется только вручную (прямой SQL), не
-- через draft_data/published_data и не через какой-либо HTTP-роут этого
-- сервиса. См. Supabase-миграцию 20260917120000_trainer_profile_brand_flag.sql.
alter table public.trainer_professional_profiles
  add column is_brand_trainer boolean not null default false;

-- fit_api ранее мог insert/update ЛЮБУЮ колонку таблицы напрямую (в отличие
-- от Supabase-стороны здесь нет security definer функций — сервис сам
-- выполняет SQL от имени fit_api), так что без сужения грантов is_brand_trainer
-- был бы доступен для записи из этого же сервиса. Явно перечисляем колонки,
-- которые реально пишут publish/unpublish/setCatalogListing/saveDraft.
revoke insert, update on public.trainer_professional_profiles from fit_api;
grant insert (trainer_id, draft_data) on public.trainer_professional_profiles to fit_api;
grant update (draft_data, published_data, listed_in_catalog, published_at, version) on public.trainer_professional_profiles to fit_api;

-- Down Migration

revoke insert (trainer_id, draft_data), update (draft_data, published_data, listed_in_catalog, published_at, version)
  on public.trainer_professional_profiles from fit_api;
grant insert, update on public.trainer_professional_profiles to fit_api;
alter table public.trainer_professional_profiles
  drop column is_brand_trainer;
