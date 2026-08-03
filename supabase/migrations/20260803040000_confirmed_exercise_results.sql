-- Подсказки следующей тренировки строятся только по действительно
-- подтверждённым результатам, а не по плану или черновому факту.
create or replace function public.list_latest_exercise_results(p_client_id uuid, p_exercise_refs text[])
returns table (exercise_ref text, workout_date date, sets jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.authorize_client_mutation(p_client_id, true);
  return query
  with ranked_exercises as (
    select exercise.id, exercise.exercise_ref, workout.workout_date,
      row_number() over (
        partition by exercise.exercise_ref
        order by workout.workout_date desc, workout.completed_at desc nulls last, workout.created_at desc, exercise.position
      ) as row_number
    from public.workouts workout
    join public.workout_exercises exercise on exercise.workout_id = workout.id
    where workout.client_id = p_client_id and workout.status = 'done' and workout.deleted_at is null
      and exercise.exercise_ref = any(p_exercise_refs)
      and exists (select 1 from public.workout_sets workout_set where workout_set.workout_exercise_id = exercise.id and workout_set.confirmed_at is not null)
  )
  select exercise.exercise_ref, exercise.workout_date,
    coalesce(jsonb_agg(jsonb_build_object(
      'weightKg', workout_set.fact_weight_kg, 'reps', workout_set.fact_reps,
      'durationSec', coalesce(workout_set.fact_duration_sec, round(workout_set.fact_duration_min * 60)::integer),
      'distanceKm', workout_set.fact_distance_km, 'rpe', workout_set.fact_rpe
    ) order by workout_set.position) filter (where workout_set.confirmed_at is not null), '[]'::jsonb)
  from ranked_exercises exercise
  join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
  where exercise.row_number = 1
  group by exercise.exercise_ref, exercise.workout_date;
end;
$$;

revoke all on function public.list_latest_exercise_results(uuid, text[]) from public, anon;
grant execute on function public.list_latest_exercise_results(uuid, text[]) to authenticated;
