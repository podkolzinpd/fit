-- Статус «бренд-тренер» — проставляется только вручную (SQL, service role),
-- никогда через собственную анкету тренера. Столбец сознательно вынесен из
-- draft_data/published_data (произвольный JSON, который тренер пишет сам).
alter table public.trainer_professional_profiles
  add column is_brand_trainer boolean not null default false;

-- authenticated ранее имел insert/update на ВСЕ колонки таблицы (реальные
-- операции публикации идут через security definer функции ниже и это
-- обходят), что само по себе давало возможность обойти
-- publish_trainer_profile() прямым REST-запросом — вплоть до простановки
-- is_brand_trainer себе самому через insert новой строки. Сужаем до
-- draft_data/trainer_id — единственных колонок, которые нужны прямому
-- REST-вызову (все остальные операции идут через функции ниже).
revoke insert, update on public.trainer_professional_profiles from authenticated;
grant insert (trainer_id, draft_data) on public.trainer_professional_profiles to authenticated;
grant update (draft_data) on public.trainer_professional_profiles to authenticated;

create or replace function public.trainer_profile_response(p_row public.trainer_professional_profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'publicId', p_row.public_id,
    'draft', p_row.draft_data,
    'published', p_row.published_data,
    'listedInCatalog', p_row.listed_in_catalog,
    'publishedAt', p_row.published_at,
    'updatedAt', p_row.updated_at,
    'version', p_row.version,
    'isBrandTrainer', p_row.is_brand_trainer
  );
$$;

create or replace function public.get_public_trainer_profile(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'publicId', profile.public_id,
    'draft', profile.published_data,
    'published', profile.published_data,
    'listedInCatalog', profile.listed_in_catalog,
    'publishedAt', profile.published_at,
    'updatedAt', profile.updated_at,
    'version', profile.version,
    'isBrandTrainer', profile.is_brand_trainer
  )
  from public.trainer_professional_profiles profile
  where profile.public_id = p_public_id and profile.published_data is not null;
$$;

create or replace function public.list_public_trainer_profiles(
  p_query text default null,
  p_specialty text default null,
  p_city text default null,
  p_mode text default null,
  p_accepting_clients boolean default null
)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'publicId', profile.public_id,
    'draft', profile.published_data,
    'published', profile.published_data,
    'listedInCatalog', true,
    'publishedAt', profile.published_at,
    'updatedAt', profile.updated_at,
    'version', profile.version,
    'isBrandTrainer', profile.is_brand_trainer
  )
  from public.trainer_professional_profiles profile
  where profile.listed_in_catalog
    and profile.published_data is not null
    and (nullif(btrim(p_query), '') is null
      or profile.published_data->>'displayName' ilike '%' || left(btrim(p_query), 100) || '%')
    and (nullif(btrim(p_specialty), '') is null or exists (
      select 1
      from jsonb_array_elements_text(coalesce(profile.published_data->'specialties', '[]'::jsonb)) item
      where item ilike '%' || left(btrim(p_specialty), 60) || '%'
    ))
    and (nullif(btrim(p_city), '') is null
      or profile.published_data->>'city' ilike '%' || left(btrim(p_city), 100) || '%')
    and (p_mode is null or p_mode = '' or (
      p_mode in ('online', 'in_person') and profile.published_data->'trainingModes' ? p_mode
    ))
    and (p_accepting_clients is null
      or (profile.published_data->>'acceptingClients')::boolean = p_accepting_clients)
  order by
    ((profile.published_data->>'acceptingClients')::boolean) desc,
    profile.published_at desc,
    profile.published_data->>'displayName'
  limit 100;
$$;

create or replace function public.list_public_trainer_profiles_page(
  p_query text default null,
  p_specialty text default null,
  p_city text default null,
  p_mode text default null,
  p_accepting_clients boolean default null,
  p_offset integer default 0,
  p_limit integer default 20,
  p_metro_station_ids text[] default null
)
returns jsonb language sql stable security definer set search_path = '' as $$
  with filtered as (
    select profile.*
    from public.trainer_professional_profiles profile
    where profile.listed_in_catalog
      and profile.published_data is not null
      and (nullif(btrim(p_query), '') is null
        or profile.published_data->>'displayName' ilike '%' || left(btrim(p_query), 100) || '%')
      and (nullif(btrim(p_specialty), '') is null or exists (
        select 1
        from jsonb_array_elements_text(coalesce(profile.published_data->'specialties', '[]'::jsonb)) item
        where item ilike '%' || left(btrim(p_specialty), 60) || '%'
      ))
      and (nullif(btrim(p_city), '') is null
        or profile.published_data->>'city' ilike '%' || left(btrim(p_city), 100) || '%')
      and (p_mode is null or p_mode = '' or (
        p_mode in ('online', 'in_person') and profile.published_data->'trainingModes' ? p_mode
      ))
      and (p_accepting_clients is null
        or (profile.published_data->>'acceptingClients')::boolean = p_accepting_clients)
      and (coalesce(cardinality(p_metro_station_ids), 0) = 0
        or coalesce(profile.published_data->'metroStationIds', '[]'::jsonb) ?| p_metro_station_ids)
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
