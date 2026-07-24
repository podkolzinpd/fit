-- replace_live_exercise: заменяет упражнение в live-тренировке на другое из
-- каталога, сохраняя место (position) и принадлежность блоку. Заменять можно
-- только НЕ начатое упражнение — если есть хоть один подтверждённый подход,
-- отказ (факт относился к старому упражнению, терять его нельзя). При смене
-- типа ввода значения подходов очищаются, число подходов сохраняется.
create or replace function public.replace_live_exercise(
  p_workout_id uuid,
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
  old_kind text;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  -- Разрешён только системный/кастомный источник; кастомное сверяем с владельцем.
  if source_value = 'custom' then
    select c.id::text, c.id, c.name, c.muscle_group, c.input_kind
      into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises c
    where c.id = custom_id and c.trainer_id = actor_id and c.archived_at is null;
    if not found then
      raise exception 'exercise_not_found' using errcode = 'PT404';
    end if;
  elsif source_value <> 'system' then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  -- Упражнение должно принадлежать этой тренировке текущего тренера.
  select e.input_kind into old_kind
  from public.workout_exercises e
  where e.id = p_exercise_id and e.workout_id = p_workout_id and e.trainer_id = actor_id;
  if old_kind is null then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  -- Начатое упражнение (есть подтверждённый подход) заменять нельзя.
  if exists (
    select 1 from public.workout_sets s
    where s.workout_exercise_id = p_exercise_id and s.confirmed_at is not null
  ) then
    raise exception 'exercise_already_started' using errcode = 'PT409';
  end if;

  update public.workout_exercises e
  set exercise_source = source_value,
      exercise_ref = ref_value,
      custom_exercise_id = custom_id,
      exercise_name = name_value,
      muscle_group = group_value,
      input_kind = kind_value
  where e.id = p_exercise_id;

  -- Сменился тип ввода — очищаем план/факт значения подходов (поля больше не
  -- подходят под новый тип), число и позиции подходов сохраняем.
  if old_kind is distinct from kind_value then
    update public.workout_sets s
    set plan_weight_kg = null, plan_reps = null, plan_duration_min = null, plan_distance_km = null,
        fact_weight_kg = null, fact_reps = null, fact_duration_min = null, fact_distance_km = null
    where s.workout_exercise_id = p_exercise_id;
  end if;

  return next_version;
end;
$$;

revoke all on function public.replace_live_exercise(uuid, uuid, jsonb, bigint) from public, anon;
grant execute on function public.replace_live_exercise(uuid, uuid, jsonb, bigint) to authenticated;

-- Конфликты версии в live-replace — бизнес-конфликт (клиент устарел), не дедлок.
do $$
declare
  definition text := pg_get_functiondef('public.replace_live_exercise(uuid,uuid,jsonb,bigint)'::regprocedure);
begin
  if definition not like '%40001%' then
    raise exception 'expected retryable conflict code in replace_live_exercise';
  end if;
  execute replace(definition, '40001', 'PT409');
end;
$$;
