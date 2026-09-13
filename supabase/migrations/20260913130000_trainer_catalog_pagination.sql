create index if not exists trainer_profiles_catalog_order_idx
  on public.trainer_professional_profiles (
    (((published_data->>'acceptingClients')::boolean)) desc,
    published_at desc,
    (lower(published_data->>'displayName')),
    public_id
  )
  where listed_in_catalog and published_data is not null;

create or replace function public.list_public_trainer_profiles_page(
  p_query text default null,
  p_specialty text default null,
  p_city text default null,
  p_mode text default null,
  p_accepting_clients boolean default null,
  p_offset integer default 0,
  p_limit integer default 20
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
        'version', profile.version
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

revoke all on function public.list_public_trainer_profiles_page(text, text, text, text, boolean, integer, integer) from public;
grant execute on function public.list_public_trainer_profiles_page(text, text, text, text, boolean, integer, integer) to anon, authenticated;
