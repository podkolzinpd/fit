-- Удаление подхода в live-тренировке. Тренер может убрать лишний подход прямо
-- во время занятия (напр. добавил случайно). Удаляем подход, сдвигаем позиции
-- оставшихся, бампим версию тренировки (оптимистичная блокировка, PT409).
-- Нельзя удалить последний подход упражнения — упражнение без подходов не имеет
-- смысла (для этого есть удаление/замена упражнения).
create or replace function public.remove_live_set(
  p_set_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  exercise_id_value uuid;
  workout_id_value uuid;
  remaining int;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select s.workout_exercise_id, e.workout_id
    into exercise_id_value, workout_id_value
  from public.workout_sets s
  join public.workout_exercises e on e.id = s.workout_exercise_id
  where s.id = p_set_id and s.trainer_id = actor_id;
  if not found then
    raise exception 'set_not_found' using errcode = 'PT404';
  end if;

  select count(*) into remaining
  from public.workout_sets s where s.workout_exercise_id = exercise_id_value;
  if remaining <= 1 then
    -- Последний подход убрать нельзя — используем удаление упражнения.
    raise exception 'last_set_cannot_be_removed' using errcode = 'PT422';
  end if;

  update public.workouts
  set version = version + 1
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  delete from public.workout_sets where id = p_set_id and trainer_id = actor_id;

  -- Пересчитываем позиции оставшихся подходов по порядку с нуля.
  with ordered as (
    select id, (row_number() over (order by position) - 1)::smallint as new_position
    from public.workout_sets
    where workout_exercise_id = exercise_id_value
  )
  update public.workout_sets s
  set position = ordered.new_position
  from ordered
  where s.id = ordered.id and s.position <> ordered.new_position;

  return next_version;
end;
$$;

revoke all on function public.remove_live_set(uuid, bigint) from public, anon;
grant execute on function public.remove_live_set(uuid, bigint) to authenticated;
