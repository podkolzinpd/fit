create table public.trainer_professional_profiles (
  trainer_id uuid primary key references public.trainers (profile_id) on delete cascade,
  public_id uuid not null unique default gen_random_uuid(),
  draft_data jsonb not null default '{}'::jsonb,
  published_data jsonb,
  published_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_profile_draft_object check (jsonb_typeof(draft_data) = 'object'),
  constraint trainer_profile_published_object check (published_data is null or jsonb_typeof(published_data) = 'object'),
  constraint trainer_profile_payload_size check (
    octet_length(draft_data::text) <= 1200000
    and (published_data is null or octet_length(published_data::text) <= 1200000)
  )
);

create trigger set_updated_at before update on public.trainer_professional_profiles
for each row execute function public.set_updated_at();

alter table public.trainer_professional_profiles enable row level security;

create policy trainer_profiles_manage_own on public.trainer_professional_profiles
  for all to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create or replace function public.trainer_profile_response(p_row public.trainer_professional_profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'publicId', p_row.public_id,
    'draft', p_row.draft_data,
    'published', p_row.published_data,
    'publishedAt', p_row.published_at,
    'updatedAt', p_row.updated_at,
    'version', p_row.version
  );
$$;

create or replace function public.get_own_trainer_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  if not exists (select 1 from public.trainers where profile_id = auth.uid()) then
    raise exception 'trainer_required' using errcode = 'PT403';
  end if;
  select * into result from public.trainer_professional_profiles where trainer_id = auth.uid();
  if result is null then return null; end if;
  return public.trainer_profile_response(result);
end;
$$;

create or replace function public.save_trainer_profile_draft(p_draft jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  if not exists (select 1 from public.trainers where profile_id = auth.uid()) then
    raise exception 'trainer_required' using errcode = 'PT403';
  end if;
  if jsonb_typeof(p_draft) <> 'object' or octet_length(p_draft::text) > 1200000 then
    raise exception 'invalid_trainer_profile' using errcode = 'PT422';
  end if;
  insert into public.trainer_professional_profiles (trainer_id, draft_data)
  values (auth.uid(), p_draft)
  on conflict (trainer_id) do update
    set draft_data = excluded.draft_data,
        version = public.trainer_professional_profiles.version + 1
  returning * into result;
  return public.trainer_profile_response(result);
end;
$$;

create or replace function public.publish_trainer_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  select * into result from public.trainer_professional_profiles where trainer_id = auth.uid() for update;
  if result is null then raise exception 'trainer_profile_not_found' using errcode = 'PT404'; end if;
  if length(btrim(coalesce(result.draft_data->>'displayName', ''))) < 2
    or length(btrim(coalesce(result.draft_data->>'bio', ''))) < 40
    or jsonb_typeof(result.draft_data->'specialties') <> 'array'
    or jsonb_array_length(result.draft_data->'specialties') = 0
    or jsonb_typeof(result.draft_data->'trainingModes') <> 'array'
    or jsonb_array_length(result.draft_data->'trainingModes') = 0 then
    raise exception 'trainer_profile_incomplete' using errcode = 'PT422';
  end if;
  update public.trainer_professional_profiles
    set published_data = draft_data, published_at = now(), version = version + 1
    where trainer_id = auth.uid() returning * into result;
  return public.trainer_profile_response(result);
end;
$$;

create or replace function public.unpublish_trainer_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  update public.trainer_professional_profiles
    set published_data = null, published_at = null, version = version + 1
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
    'publishedAt', profile.published_at,
    'updatedAt', profile.updated_at,
    'version', profile.version
  )
  from public.trainer_professional_profiles profile
  where profile.public_id = p_public_id and profile.published_data is not null;
$$;

revoke all on public.trainer_professional_profiles from anon, authenticated;
grant select, insert, update on public.trainer_professional_profiles to authenticated;
revoke all on function public.trainer_profile_response(public.trainer_professional_profiles) from public;
revoke all on function public.get_own_trainer_profile() from public;
revoke all on function public.save_trainer_profile_draft(jsonb) from public;
revoke all on function public.publish_trainer_profile() from public;
revoke all on function public.unpublish_trainer_profile() from public;
revoke all on function public.get_public_trainer_profile(uuid) from public;
grant execute on function public.get_own_trainer_profile() to authenticated;
grant execute on function public.save_trainer_profile_draft(jsonb) to authenticated;
grant execute on function public.publish_trainer_profile() to authenticated;
grant execute on function public.unpublish_trainer_profile() to authenticated;
grant execute on function public.get_public_trainer_profile(uuid) to anon, authenticated;
