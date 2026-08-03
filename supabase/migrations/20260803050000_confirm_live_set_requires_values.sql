-- «Готово» допускается, если есть факт или план, который можно перенести.
-- Совсем пустой подход не является выполненным и не должен попадать в историю.
create or replace function private.legacy_confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_version bigint;
begin
  if not exists (
    select 1 from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id and workout_set.version = p_expected_version
      and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
  ) then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;

  if not exists (
    select 1 from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id and workout_set.version = p_expected_version
      and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
      and coalesce(
        workout_set.fact_weight_kg, workout_set.fact_reps, workout_set.fact_duration_min, workout_set.fact_duration_sec,
        workout_set.fact_distance_km, workout_set.fact_rpe, workout_set.plan_weight_kg, workout_set.plan_reps,
        workout_set.plan_duration_min, workout_set.plan_duration_sec, workout_set.plan_distance_km, workout_set.plan_rpe
      ) is not null
  ) then
    raise exception 'live_set_empty' using errcode = 'PT422';
  end if;

  update public.workout_sets workout_set set
    confirmed_at = now(),
    fact_weight_kg = coalesce(workout_set.fact_weight_kg, workout_set.plan_weight_kg),
    fact_reps = coalesce(workout_set.fact_reps, workout_set.plan_reps),
    fact_duration_min = coalesce(workout_set.fact_duration_min, workout_set.plan_duration_min),
    fact_duration_sec = coalesce(workout_set.fact_duration_sec, workout_set.plan_duration_sec, round(workout_set.fact_duration_min * 60)::integer, round(workout_set.plan_duration_min * 60)::integer),
    fact_distance_km = coalesce(workout_set.fact_distance_km, workout_set.plan_distance_km),
    fact_rpe = coalesce(workout_set.fact_rpe, workout_set.plan_rpe),
    version = workout_set.version + 1
  from public.workout_exercises exercise, public.workouts workout
  where workout_set.id = p_set_id and workout_set.version = p_expected_version
    and exercise.id = workout_set.workout_exercise_id and workout.id = exercise.workout_id
    and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
  returning workout_set.version into next_version;
  return next_version;
end;
$$;
