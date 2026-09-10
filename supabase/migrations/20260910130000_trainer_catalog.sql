alter table public.trainer_professional_profiles
  add column listed_in_catalog boolean not null default false;

create index trainer_profiles_catalog_idx
  on public.trainer_professional_profiles (published_at desc)
  where listed_in_catalog and published_data is not null;

create or replace function public.trainer_profile_response(p_row public.trainer_professional_profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'publicId', p_row.public_id,
    'draft', p_row.draft_data,
    'published', p_row.published_data,
    'listedInCatalog', p_row.listed_in_catalog,
    'publishedAt', p_row.published_at,
    'updatedAt', p_row.updated_at,
    'version', p_row.version
  );
$$;

create or replace function public.unpublish_trainer_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  update public.trainer_professional_profiles
    set published_data = null, published_at = null, listed_in_catalog = false, version = version + 1
    where trainer_id = auth.uid() returning * into result;
  if result is null then raise exception 'trainer_profile_not_found' using errcode = 'PT404'; end if;
  return public.trainer_profile_response(result);
end;
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
    'version', profile.version
  )
  from public.trainer_professional_profiles profile
  where profile.public_id = p_public_id and profile.published_data is not null;
$$;

create or replace function public.set_trainer_profile_catalog_listing(p_listed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  update public.trainer_professional_profiles
    set listed_in_catalog = p_listed, version = version + 1
    where trainer_id = auth.uid()
      and (not p_listed or published_data is not null)
    returning * into result;
  if result is null then raise exception 'published_trainer_profile_required' using errcode = 'PT422'; end if;
  return public.trainer_profile_response(result);
end;
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
    'version', profile.version
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

revoke all on function public.set_trainer_profile_catalog_listing(boolean) from public;
revoke all on function public.list_public_trainer_profiles(text, text, text, text, boolean) from public;
grant execute on function public.set_trainer_profile_catalog_listing(boolean) to authenticated;
grant execute on function public.list_public_trainer_profiles(text, text, text, text, boolean) to anon, authenticated;
