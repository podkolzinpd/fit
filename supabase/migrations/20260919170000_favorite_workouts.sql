-- Клиент сохраняет свою тренировку в избранное — структуру упражнений (блоки,
-- сеты, отдых), как её уже собирает copyWorkout() при копировании из истории —
-- и позже планирует из неё новую тренировку без похода в историю. Формат —
-- снэпшот, а не живая ссылка на каталог: в отличие от статичных PRESET_WORKOUTS
-- (только системные упражнения), сюда попадают и кастомные упражнения клиента,
-- которые позже могут исчезнуть из каталога — как и в completed/live-снэпшотах,
-- избранное не должно из-за этого ломаться.
create table public.favorite_workouts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  exercises jsonb not null,
  created_at timestamptz not null default now()
);

create index favorite_workouts_client_created_idx
  on public.favorite_workouts (client_id, created_at desc);

create trigger source_cutover_write_gate
before insert or update or delete on public.favorite_workouts
for each statement execute function private.enforce_source_cutover_write_gate();

alter table public.favorite_workouts enable row level security;
revoke all on public.favorite_workouts from public, anon, authenticated;

-- Прямого доступа с Data API нет — вся работа идёт через функции ниже; политика
-- остаётся вторым рубежом защиты на случай прямого обращения к таблице.
create policy favorite_workouts_manage_own
on public.favorite_workouts
for all to authenticated
using (client_id = (select auth.uid()))
with check (client_id = (select auth.uid()));

create or replace function public.list_favorite_workouts()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', favorite.id,
    'title', favorite.title,
    'createdAt', favorite.created_at,
    'exercises', favorite.exercises
  ) order by favorite.created_at desc), '[]'::jsonb)
  from public.favorite_workouts favorite
  where favorite.client_id = auth.uid();
$$;

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
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'client'
  ) then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;
  if normalized_title = '' then
    raise exception 'invalid_favorite_workout_title' using errcode = 'PT422';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array'
    or jsonb_array_length(p_exercises) = 0 or jsonb_array_length(p_exercises) > 60 then
    raise exception 'invalid_favorite_workout_exercises' using errcode = 'PT422';
  end if;

  select count(*) into favorite_count
  from public.favorite_workouts
  where client_id = actor_id;
  if favorite_count >= 10 then
    raise exception 'favorite_workout_limit_reached' using errcode = 'PT422';
  end if;

  insert into public.favorite_workouts (client_id, title, exercises)
  values (actor_id, normalized_title, p_exercises)
  returning * into favorite;

  return jsonb_build_object(
    'id', favorite.id,
    'title', favorite.title,
    'createdAt', favorite.created_at,
    'exercises', favorite.exercises
  );
end;
$$;

create or replace function public.delete_favorite_workout(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  delete from public.favorite_workouts
  where id = p_id and client_id = actor_id;
  if not found then
    raise exception 'favorite_workout_not_found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.list_favorite_workouts() from public, anon;
revoke all on function public.save_favorite_workout(text, jsonb) from public, anon;
revoke all on function public.delete_favorite_workout(uuid) from public, anon;
grant execute on function public.list_favorite_workouts() to authenticated;
grant execute on function public.save_favorite_workout(text, jsonb) to authenticated;
grant execute on function public.delete_favorite_workout(uuid) to authenticated;
