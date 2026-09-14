-- A trainer can use an accessible custom exercise while saving a workout into
-- a client's standalone data partition. The composite workout FK cannot point
-- across partitions, so preserve the exercise as an authoritative snapshot.
create or replace function private.normalize_workout_custom_exercises(
  p_workout jsonb,
  p_owner_id uuid,
  p_actor_id uuid,
  p_preserve_linked_exercises boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  exercise_item jsonb;
  effective_exercise jsonb;
  effective_exercises jsonb := '[]'::jsonb;
  custom_exercise_id_value uuid;
  custom_exercise_record record;
begin
  for exercise_item in
    select value
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    effective_exercise := exercise_item;

    if exercise_item->>'source' = 'custom'
      and not (
        p_preserve_linked_exercises
        and nullif(exercise_item->>'sourceExerciseId', '') is not null
        and not coalesce((exercise_item->>'clearFact')::boolean, false)
      )
    then
      custom_exercise_id_value := nullif(
        exercise_item->>'customExerciseId',
        ''
      )::uuid;

      if custom_exercise_id_value is null
        or exercise_item->>'ref' not in (
          custom_exercise_id_value::text,
          'custom:' || custom_exercise_id_value::text
        )
      then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;

      select
        custom_exercise.trainer_id,
        custom_exercise.name,
        custom_exercise.muscle_group,
        custom_exercise.input_kind
      into custom_exercise_record
      from public.custom_exercises custom_exercise
      where custom_exercise.id = custom_exercise_id_value
        and custom_exercise.archived_at is null
        and (
          custom_exercise.created_by = p_actor_id
          or custom_exercise.trainer_id = p_actor_id
          or exists (
            select 1
            from public.clients client
            where client.auth_user_id = custom_exercise.created_by
              and client.trainer_id = custom_exercise.trainer_id
              and public.can_access_client(client.id)
          )
          or (
            custom_exercise.created_by = custom_exercise.trainer_id
            and exists (
              select 1
              from public.clients client
              where client.auth_user_id = p_actor_id
                and client.trainer_id = custom_exercise.trainer_id
                and client.archived_at is null
            )
          )
        );

      if not found then
        raise exception 'exercise_not_found' using errcode = 'PT404';
      end if;

      if custom_exercise_record.trainer_id = p_owner_id then
        effective_exercise := effective_exercise || jsonb_build_object(
          'source', 'custom',
          'customExerciseId', custom_exercise_id_value::text,
          'name', custom_exercise_record.name,
          'muscleGroup', custom_exercise_record.muscle_group,
          'inputKind', custom_exercise_record.input_kind
        );
      else
        effective_exercise := effective_exercise || jsonb_build_object(
          'source', 'system',
          'ref', 'snapshot:custom:' || custom_exercise_id_value::text,
          'customExerciseId', null,
          'name', custom_exercise_record.name,
          'muscleGroup', custom_exercise_record.muscle_group,
          'inputKind', custom_exercise_record.input_kind
        );
      end if;
    end if;

    effective_exercises := effective_exercises || jsonb_build_array(effective_exercise);
  end loop;

  return jsonb_set(p_workout, '{exercises}', effective_exercises, true);
end;
$$;

revoke all on function private.normalize_workout_custom_exercises(
  jsonb, uuid, uuid, boolean
) from public, anon, authenticated;

create or replace function public.save_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  owner_id uuid;
  result uuid;
  effective_workout jsonb;
begin
  if workout_id_value is null then
    owner_id := public.authorize_client_mutation(
      (p_workout->>'clientId')::uuid,
      true
    );
  else
    owner_id := public.authorize_workout_mutation(workout_id_value, false);
  end if;

  if workout_id_value is null and request_id_value is not null then
    result := private.claim_workout_create_request(owner_id, request_id_value);
    if result is not null then
      return result;
    end if;
  end if;

  effective_workout := private.normalize_workout_custom_exercises(
    p_workout,
    owner_id,
    actor_id,
    false
  );
  result := private.legacy_save_workout_request(
    effective_workout,
    p_expected_version
  );

  if workout_id_value is null and request_id_value is not null then
    perform private.finish_workout_create_request(
      owner_id,
      request_id_value,
      result
    );
  end if;

  return result;
end;
$$;

create or replace function public.save_completed_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  stage_id_value uuid := nullif(p_workout->>'stageId', '')::uuid;
  owner_id uuid;
  result uuid;
  effective_workout jsonb;
begin
  if workout_id_value is null then
    owner_id := public.authorize_client_mutation(
      (p_workout->>'clientId')::uuid,
      true
    );
  else
    owner_id := public.authorize_workout_mutation(workout_id_value, false);

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

  if workout_id_value is null and request_id_value is not null then
    result := private.claim_workout_create_request(owner_id, request_id_value);
    if result is not null then
      return result;
    end if;
  end if;

  effective_workout := private.normalize_workout_custom_exercises(
    p_workout,
    owner_id,
    actor_id,
    workout_id_value is not null
  );

  if workout_id_value is not null then
    perform private.park_completed_workout_positions(
      workout_id_value,
      effective_workout
    );
  end if;

  result := private.legacy_save_completed_workout_request(
    effective_workout,
    p_expected_version
  );

  if workout_id_value is null and request_id_value is not null then
    perform private.finish_workout_create_request(
      owner_id,
      request_id_value,
      result
    );
  end if;

  return result;
end;
$$;

revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.save_completed_workout(jsonb, bigint)
  from public, anon;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.save_completed_workout(jsonb, bigint)
  to authenticated;
