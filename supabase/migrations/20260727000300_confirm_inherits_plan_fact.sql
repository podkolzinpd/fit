-- «Готово» без ручного ввода = выполнено по плану. Раньше confirm_live_set
-- только ставил confirmed_at, а fact_* оставались null → в истории подход
-- показывался как «не выполнено», хотя тренер подтвердил выполнение.
-- Теперь при подтверждении незаполненный факт наследует план (coalesce),
-- а введённые вручную значения не трогаем.
create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workout_sets s set
    confirmed_at = now(),
    fact_weight_kg = coalesce(s.fact_weight_kg, s.plan_weight_kg),
    fact_reps = coalesce(s.fact_reps, s.plan_reps),
    fact_duration_min = coalesce(s.fact_duration_min, s.plan_duration_min),
    fact_distance_km = coalesce(s.fact_distance_km, s.plan_distance_km),
    version = s.version + 1
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    -- Неповторяемый конфликт версии (PT409, см. миграцию 0006 non_retryable).
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;
