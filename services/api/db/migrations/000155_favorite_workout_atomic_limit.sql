-- Up Migration

create or replace function public.save_favorite_workout(p_title text, p_exercises jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_title text := left(btrim(coalesce(p_title, '')), 120);
  favorite_count integer;
  favorite public.favorite_workouts;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'client'
  ) then raise exception 'client_role_required' using errcode = 'PT403'; end if;
  if normalized_title = '' then
    raise exception 'invalid_favorite_workout_title' using errcode = 'PT422';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' then
    raise exception 'invalid_favorite_workout_exercises' using errcode = 'PT422';
  end if;
  if jsonb_array_length(p_exercises) not between 1 and 60 then
    raise exception 'invalid_favorite_workout_exercises' using errcode = 'PT422';
  end if;

  -- Both count and insert run after this actor-scoped transaction lock.
  -- Existing snapshots (including accounts already above the limit) are untouched.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fit.favorite-limit:' || actor_id::text, 0));
  select count(*) into favorite_count from public.favorite_workouts where client_id = actor_id;
  if favorite_count >= 10 then
    raise exception 'favorite_workout_limit_reached' using errcode = 'PT422';
  end if;
  insert into public.favorite_workouts (client_id, title, exercises)
  values (actor_id, normalized_title, p_exercises) returning * into favorite;
  return jsonb_build_object(
    'id', favorite.id, 'title', favorite.title, 'createdAt', favorite.created_at,
    'version', favorite.version, 'exercises', favorite.exercises
  );
end;
$$;

revoke all on function public.save_favorite_workout(text, jsonb) from public;
grant execute on function public.save_favorite_workout(text, jsonb) to fit_api;

-- Down Migration

-- Forward-compatible safety fix: an API rollback must not reopen the race.
-- No data cleanup, history rewrite or schema removal is performed in either direction.
select 1;
