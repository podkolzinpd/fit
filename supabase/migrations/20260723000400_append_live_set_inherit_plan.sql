-- «＋ Подход» в live-тренировке: новый подход наследует плановые параметры
-- (вес/повторы/время/дистанцию) последнего подхода упражнения, чтобы тренеру
-- не перезабивать одинаковые значения. Сигнатура функции не меняется.
create or replace function public.append_live_set(
  p_workout_exercise_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select e.workout_id, e.client_id into workout_id_value, client_id_value
  from public.workout_exercises e
  where e.id = p_workout_exercise_id and e.trainer_id = actor_id;
  if not found then
    raise exception 'exercise_not_found' using errcode = 'P0002';
  end if;

  update public.workouts
  set version = version + 1
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  select coalesce(max(s.position) + 1, 0)::smallint into next_position
  from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id;

  -- Наследуем план последнего подхода (по наибольшей позиции), если он есть.
  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position,
    plan_weight_kg, plan_reps, plan_duration_min, plan_distance_km
  )
  select
    p_workout_exercise_id, actor_id, client_id_value, next_position,
    last_set.plan_weight_kg, last_set.plan_reps, last_set.plan_duration_min, last_set.plan_distance_km
  from (
    select s.plan_weight_kg, s.plan_reps, s.plan_duration_min, s.plan_distance_km
    from public.workout_sets s
    where s.workout_exercise_id = p_workout_exercise_id
    order by s.position desc
    limit 1
  ) last_set
  -- Гарантируем ровно одну вставку даже когда предыдущих подходов нет.
  right join (select 1) placeholder on true;

  return next_version;
end;
$$;

revoke all on function public.append_live_set(uuid, bigint) from public, anon;
grant execute on function public.append_live_set(uuid, bigint) to authenticated;
