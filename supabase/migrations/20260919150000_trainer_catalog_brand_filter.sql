-- Клиентский фильтр каталога получает переключатель «только бренд-тренеры» —
-- is_brand_trainer уже проставляется вручную (SQL, service role) и уже
-- отображается бейджем на карточке/анкете, фильтр делает его явно доступным
-- для поиска, а не только для отображения.
drop function if exists public.list_public_trainer_profiles_page(text, text[], text, text, boolean, integer, integer, text[]);

create or replace function public.list_public_trainer_profiles_page(
  p_query text default null,
  p_specialties text[] default null,
  p_city text default null,
  p_mode text default null,
  p_accepting_clients boolean default null,
  p_offset integer default 0,
  p_limit integer default 20,
  p_metro_station_ids text[] default null,
  p_brand_trainer_only boolean default false
)
returns jsonb language sql stable security definer set search_path = '' as $$
  with filtered as (
    select profile.*
    from public.trainer_professional_profiles profile
    where profile.listed_in_catalog
      and profile.published_data is not null
      and (nullif(btrim(p_query), '') is null
        or profile.published_data->>'displayName' ilike '%' || left(btrim(p_query), 100) || '%')
      and (coalesce(cardinality(p_specialties), 0) = 0
        or coalesce(profile.published_data->'specialties', '[]'::jsonb) ?| p_specialties)
      and (nullif(btrim(p_city), '') is null
        or profile.published_data->>'city' ilike '%' || left(btrim(p_city), 100) || '%')
      and (p_mode is null or p_mode = '' or (
        p_mode in ('online', 'in_person') and profile.published_data->'trainingModes' ? p_mode
      ))
      and (p_accepting_clients is null
        or (profile.published_data->>'acceptingClients')::boolean = p_accepting_clients)
      and (coalesce(cardinality(p_metro_station_ids), 0) = 0
        or coalesce(profile.published_data->'metroStationIds', '[]'::jsonb) ?| p_metro_station_ids)
      and (not coalesce(p_brand_trainer_only, false) or profile.is_brand_trainer)
  ), selected as (
    select *
    from filtered
    order by
      ((published_data->>'acceptingClients')::boolean) desc,
      published_at desc,
      lower(published_data->>'displayName'),
      public_id
    offset greatest(0, coalesce(p_offset, 0))
    limit least(50, greatest(1, coalesce(p_limit, 20)))
  ), metadata as (
    select count(*)::integer as total_count from filtered
  ), items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'publicId', profile.public_id,
        'draft', profile.published_data,
        'published', profile.published_data,
        'listedInCatalog', true,
        'publishedAt', profile.published_at,
        'updatedAt', profile.updated_at,
        'version', profile.version,
        'isBrandTrainer', profile.is_brand_trainer
      ) order by
        ((profile.published_data->>'acceptingClients')::boolean) desc,
        profile.published_at desc,
        lower(profile.published_data->>'displayName'),
        profile.public_id
    ), '[]'::jsonb) as value, count(*)::integer as item_count
    from selected profile
  )
  select jsonb_build_object(
    'items', items.value,
    'totalCount', metadata.total_count,
    'nextOffset', case
      when greatest(0, coalesce(p_offset, 0)) + items.item_count < metadata.total_count
        then greatest(0, coalesce(p_offset, 0)) + items.item_count
      else null
    end
  )
  from metadata cross join items;
$$;

revoke all on function public.list_public_trainer_profiles_page(text, text[], text, text, boolean, integer, integer, text[], boolean) from public;
grant execute on function public.list_public_trainer_profiles_page(text, text[], text, text, boolean, integer, integer, text[], boolean) to anon, authenticated;
