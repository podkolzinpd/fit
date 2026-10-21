-- Up Migration

-- Existing snapshots keep their id, content and creation time.
alter table public.favorite_workouts add column version integer not null default 1 check (version > 0);

create or replace function public.list_favorite_workouts()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', favorite.id, 'title', favorite.title, 'createdAt', favorite.created_at,
    'version', favorite.version, 'exercises', favorite.exercises
  ) order by favorite.created_at desc), '[]'::jsonb)
  from public.favorite_workouts favorite
  where favorite.client_id = auth.uid();
$$;

create function public.update_favorite_workout(
  p_id uuid, p_expected_version integer, p_title text, p_exercises jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  favorite public.favorite_workouts;
  normalized_title text := btrim(coalesce(p_title, ''));
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.profiles where id = actor_id and account_role = 'client'
  ) then raise exception 'client_role_required' using errcode = 'PT403'; end if;
  if char_length(normalized_title) not between 1 and 120 or p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid_favorite_workout_title' using errcode = 'PT422';
  end if;
  if p_exercises is not null then
    if jsonb_typeof(p_exercises) is distinct from 'array' then
      raise exception 'invalid_favorite_workout_exercises' using errcode = 'PT422';
    end if;
    if jsonb_array_length(p_exercises) not between 1 and 60 then
      raise exception 'invalid_favorite_workout_exercises' using errcode = 'PT422';
    end if;
  end if;
  select * into favorite from public.favorite_workouts
    where id = p_id and client_id = actor_id for update;
  if not found then raise exception 'favorite_workout_not_found' using errcode = 'PT404'; end if;
  if favorite.version <> p_expected_version then
    raise exception 'favorite_workout_version_conflict' using errcode = 'PT409';
  end if;
  update public.favorite_workouts
    set title = normalized_title, exercises = coalesce(p_exercises, exercises), version = version + 1
    where id = p_id and client_id = actor_id and version = p_expected_version
    returning * into favorite;
  return jsonb_build_object(
    'id', favorite.id, 'title', favorite.title, 'createdAt', favorite.created_at,
    'version', favorite.version, 'exercises', favorite.exercises
  );
end;
$$;

revoke all on function public.update_favorite_workout(uuid, integer, text, jsonb) from public;
grant execute on function public.update_favorite_workout(uuid, integer, text, jsonb) to fit_api;

-- Down Migration

drop function public.update_favorite_workout(uuid, integer, text, jsonb);
create or replace function public.list_favorite_workouts()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', favorite.id, 'title', favorite.title, 'createdAt', favorite.created_at,
    'exercises', favorite.exercises
  ) order by favorite.created_at desc), '[]'::jsonb)
  from public.favorite_workouts favorite where favorite.client_id = auth.uid();
$$;
alter table public.favorite_workouts drop column version;
