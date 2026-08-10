-- При перестановке двух уже сохранённых упражнений/подходов нельзя менять
-- position по одному: уникальный индекс видит промежуточный дубль. Сначала
-- переносим только строки из текущей формы в безопасные временные позиции выше
-- текущего максимума (position не может быть отрицательной),
-- затем legacy-функция записывает конечный порядок и факт.
create or replace function private.park_completed_workout_positions(p_workout_id uuid, p_workout jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with requested_exercises as (
    select
      nullif(item.value->>'sourceExerciseId', '')::uuid as id,
      row_number() over ()::smallint as temporary_offset
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) as item(value)
    where nullif(item.value->>'sourceExerciseId', '') is not null
  )
  update public.workout_exercises exercise set position = maximum.position + requested.temporary_offset
  from requested_exercises requested
  cross join lateral (
    select coalesce(max(position), 0)::smallint as position
    from public.workout_exercises
    where workout_id = p_workout_id
  ) maximum
  where exercise.id = requested.id
    and exercise.workout_id = p_workout_id;

  with requested_sets as (
    select
      workout_set.id,
      workout_set.workout_exercise_id,
      row_number() over (partition by workout_set.workout_exercise_id order by workout_set.id)::smallint as temporary_offset
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) as exercise_item(value)
    cross join lateral jsonb_array_elements(coalesce(exercise_item.value->'sets', '[]'::jsonb)) as set_item(value)
    join public.workout_sets workout_set on workout_set.id = nullif(set_item.value->>'sourceSetId', '')::uuid
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    where exercise.workout_id = p_workout_id
  )
  update public.workout_sets workout_set set position = maximum.position + requested.temporary_offset
  from requested_sets requested
  cross join lateral (
    select coalesce(max(position), 0)::smallint as position
    from public.workout_sets
    where workout_exercise_id = requested.workout_exercise_id
  ) maximum
  where workout_set.id = requested.id;
end;
$$;

create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  stage_id_value uuid := nullif(p_workout->>'stageId', '')::uuid;
  owner_id uuid;
  result uuid;
begin
  if workout_id_value is not null then
    owner_id := public.authorize_workout_mutation(workout_id_value, false);
    perform private.park_completed_workout_positions(workout_id_value, p_workout);

    if stage_id_value is not null and not exists (
      select 1
      from public.workouts workout
      join public.goal_stages stage on stage.client_id = workout.client_id
      where workout.id = workout_id_value
        and workout.deleted_at is null
        and stage.id = stage_id_value
    ) then
      raise exception 'goal_stage_client_mismatch' using errcode = 'PT422';
    end if;
  end if;

  if workout_id_value is not null or request_id_value is null then
    return private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  end if;

  owner_id := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  result := private.claim_workout_create_request(owner_id, request_id_value);
  if result is not null then
    return result;
  end if;

  result := private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  perform private.finish_workout_create_request(owner_id, request_id_value, result);
  return result;
end;
$$;

revoke all on function private.park_completed_workout_positions(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
