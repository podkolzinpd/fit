-- В завершённой тренировке замена упражнения не должна переносить на него факт.
alter function public.save_completed_workout(jsonb, bigint) rename to legacy_save_completed_workout;
revoke all on function public.legacy_save_completed_workout(jsonb, bigint) from public, anon, authenticated;
alter function public.legacy_save_completed_workout(jsonb, bigint) set schema private;

create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result uuid;
  exercise_item jsonb;
  source_exercise_id uuid;
begin
  result := private.legacy_save_completed_workout(p_workout, p_expected_version);

  -- clearFact приходит только из явной замены упражнения в уже завершённой
  -- тренировке. Старые подходы остаются в плане, но не считаются фактом.
  if nullif(p_workout->>'id', '') is not null then
    for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
      if not coalesce((exercise_item->>'clearFact')::boolean, false) then continue; end if;
      source_exercise_id := nullif(exercise_item->>'sourceExerciseId', '')::uuid;
      if source_exercise_id is null then continue; end if;

      update public.workout_exercises set
        exercise_source = exercise_item->>'source',
        exercise_ref = exercise_item->>'ref',
        custom_exercise_id = nullif(exercise_item->>'customExerciseId', '')::uuid,
        exercise_name = exercise_item->>'name',
        muscle_group = exercise_item->>'muscleGroup',
        input_kind = exercise_item->>'inputKind'
      where id = source_exercise_id and workout_id = result;

      update public.workout_sets set
        fact_weight_kg = null, fact_reps = null, fact_duration_min = null,
        fact_duration_sec = null, fact_distance_km = null, fact_rpe = null,
        confirmed_at = null, version = version + 1
      where workout_exercise_id = source_exercise_id;
    end loop;
  end if;

  return result;
end;
$$;

revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
