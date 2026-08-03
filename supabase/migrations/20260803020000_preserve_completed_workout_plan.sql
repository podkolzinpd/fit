-- Правка завершённой тренировки меняет факт, а не переписывает исходный план.
create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  root_trainer uuid;
  original_sub text := actor_id::text;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  result uuid;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  exercise_item jsonb;
  set_item jsonb;
  exercise_id_value uuid;
  set_id_value uuid;
  inserted_exercise_id uuid;
begin
  if workout_id_value is null then
    root_trainer := public.authorize_client_mutation(client_id_value, true);
    perform set_config('request.jwt.claim.sub', root_trainer::text, true);
    begin
      result := private.legacy_save_workout(p_workout, p_expected_version);
      update public.workout_sets set
        fact_weight_kg = plan_weight_kg, fact_reps = plan_reps,
        fact_duration_min = plan_duration_min, fact_duration_sec = plan_duration_sec,
        fact_distance_km = plan_distance_km, fact_rpe = plan_rpe,
        confirmed_at = now(), version = version + 1
      where workout_exercise_id in (select id from public.workout_exercises where workout_id = result);
      update public.workouts set status = 'done', completed_at = now(), created_by = actor_id, version = version + 1 where id = result;
    exception when others then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise;
    end;
    perform set_config('request.jwt.claim.sub', original_sub, true);
    return result;
  end if;

  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    update public.workouts set
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      stage_id = nullif(p_workout->>'stageId', '')::uuid,
      version = version + 1
    where id = workout_id_value and client_id = client_id_value and status = 'done'
      and deleted_at is null and version = p_expected_version
    returning id into result;
    if result is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;

    -- Сначала исключаем старый факт: строки, отсутствующие в форме, остаются
    -- частью плана, но больше не считаются выполненными.
    update public.workout_sets workout_set set
      fact_weight_kg = null, fact_reps = null, fact_duration_min = null,
      fact_duration_sec = null, fact_distance_km = null, fact_rpe = null,
      confirmed_at = null, version = version + 1
    from public.workout_exercises exercise
    where exercise.id = workout_set.workout_exercise_id and exercise.workout_id = result;

    for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
      exercise_id_value := nullif(exercise_item->>'sourceExerciseId', '')::uuid;
      if exercise_id_value is not null and exists (
        select 1 from public.workout_exercises where id = exercise_id_value and workout_id = result
      ) then
        update public.workout_exercises set position = (exercise_item->>'position')::smallint
        where id = exercise_id_value;
        inserted_exercise_id := exercise_id_value;
      else
        insert into public.workout_exercises (
          workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
          custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type,
          block_rounds, trainer_comment, block_preset, rest_between_exercises_sec,
          rest_between_rounds_sec, rest_between_sets_sec
        ) values (
          result, root_trainer, client_id_value, (exercise_item->>'position')::smallint,
          exercise_item->>'source', exercise_item->>'ref', nullif(exercise_item->>'customExerciseId', '')::uuid,
          exercise_item->>'name', exercise_item->>'muscleGroup', exercise_item->>'inputKind',
          coalesce(nullif(exercise_item->>'blockId', '')::uuid, gen_random_uuid()),
          coalesce(nullif(exercise_item->>'blockType', ''), 'single'),
          greatest(coalesce(nullif(exercise_item->>'blockRounds', '')::smallint, 1), 1),
          nullif(btrim(exercise_item->>'trainerComment'), ''),
          coalesce(nullif(exercise_item->>'blockPreset', ''), 'set'),
          coalesce(nullif(exercise_item->>'restBetweenExercisesSec', '')::smallint, 0),
          coalesce(nullif(exercise_item->>'restBetweenRoundsSec', '')::smallint, 90),
          coalesce(nullif(exercise_item->>'restBetweenSetsSec', '')::smallint, 90)
        ) returning id into inserted_exercise_id;
      end if;

      for set_item in select value from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb)) loop
        set_id_value := nullif(set_item->>'sourceSetId', '')::uuid;
        if set_id_value is not null and exists (
          select 1 from public.workout_sets where id = set_id_value and workout_exercise_id = inserted_exercise_id
        ) then
          update public.workout_sets set
            position = (set_item->>'position')::smallint,
            fact_weight_kg = nullif(set_item->>'weightKg', '')::numeric,
            fact_reps = nullif(set_item->>'reps', '')::integer,
            fact_duration_min = nullif(set_item->>'durationMin', '')::numeric,
            fact_duration_sec = nullif(set_item->>'durationSec', '')::integer,
            fact_distance_km = nullif(set_item->>'distanceKm', '')::numeric,
            fact_rpe = nullif(set_item->>'rpe', '')::numeric,
            confirmed_at = now(), version = version + 1
          where id = set_id_value;
        else
          insert into public.workout_sets (
            workout_exercise_id, trainer_id, client_id, position,
            fact_weight_kg, fact_reps, fact_duration_min, fact_duration_sec,
            fact_distance_km, fact_rpe, confirmed_at
          ) values (
            inserted_exercise_id, root_trainer, client_id_value, (set_item->>'position')::smallint,
            nullif(set_item->>'weightKg', '')::numeric, nullif(set_item->>'reps', '')::integer,
            nullif(set_item->>'durationMin', '')::numeric, nullif(set_item->>'durationSec', '')::integer,
            nullif(set_item->>'distanceKm', '')::numeric, nullif(set_item->>'rpe', '')::numeric, now()
          );
        end if;
      end loop;
    end loop;
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end $$;

revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
