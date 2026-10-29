-- Up Migration

-- The existing command still owns authorization, versioning, custom snapshots
-- and the idempotency receipt. Seed new planned values in that same transaction.
alter function public.append_live_exercise(uuid, jsonb, bigint, uuid)
  rename to append_live_exercise_without_history_prefill;
alter function public.append_live_exercise_without_history_prefill(uuid, jsonb, bigint, uuid)
  set schema app_private;
revoke all on function app_private.append_live_exercise_without_history_prefill(uuid, jsonb, bigint, uuid)
  from public, fit_api;

create function public.append_live_exercise(
  p_workout_id uuid, p_exercise jsonb, p_expected_version bigint, p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  result_row record;
  target_row record;
  previous_exercise_id uuid;
begin
  if p_exercise ? 'prefillFromHistory'
    and jsonb_typeof(p_exercise->'prefillFromHistory') <> 'boolean' then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  select * into result_row
  from app_private.append_live_exercise_without_history_prefill(
    p_workout_id, p_exercise, p_expected_version, p_operation_id
  );
  -- A retry must never reapply history over values entered after the first add.
  if not result_row.replayed and p_exercise->'prefillFromHistory' = 'true'::jsonb then
    select exercise.*, workout.id target_workout_id into target_row
    from public.workout_exercises exercise
    join public.workouts workout on workout.id = exercise.workout_id
    where exercise.id = result_row.resource_id;

    select exercise.id into previous_exercise_id
    from public.workout_exercises exercise
    join public.workouts workout on workout.id = exercise.workout_id
    where workout.client_id = target_row.client_id
      and workout.id <> p_workout_id and workout.status = 'done'
      and workout.deleted_at is null and public.can_read_workout(workout.id)
      and exercise.input_kind = target_row.input_kind
      and (
        (exercise.exercise_source = target_row.exercise_source and exercise.exercise_ref = target_row.exercise_ref)
        or (p_exercise->>'source' = 'custom' and (
          exercise.custom_exercise_id::text = p_exercise->>'customExerciseId'
          or exercise.exercise_ref = 'snapshot:custom:' || (p_exercise->>'customExerciseId')
        ))
      )
      and exists (select 1 from public.workout_sets completed
        where completed.workout_exercise_id = exercise.id and completed.confirmed_at is not null)
    order by workout.workout_date desc, workout.start_time desc nulls last,
      workout.completed_at desc nulls last, workout.created_at desc,
      exercise.position, exercise.id
    limit 1;

    if previous_exercise_id is not null then
      delete from public.workout_sets where workout_exercise_id = result_row.resource_id;
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
        plan_distance_km, plan_rpe, updated_by
      )
      select result_row.resource_id, target_row.trainer_id, target_row.client_id,
        (row_number() over (order by completed.position, completed.id) - 1)::smallint,
        completed.fact_weight_kg, completed.fact_reps,
        case when completed.fact_duration_sec is null then completed.fact_duration_min else null end,
        completed.fact_duration_sec, completed.fact_distance_km, completed.fact_rpe, auth.uid()
      from public.workout_sets completed
      where completed.workout_exercise_id = previous_exercise_id and completed.confirmed_at is not null;
    end if;
  end if;
  return query select result_row.resource_id::uuid, result_row.version::bigint, result_row.replayed::boolean;
end;
$$;
revoke all on function public.append_live_exercise(uuid, jsonb, bigint, uuid) from public;
grant execute on function public.append_live_exercise(uuid, jsonb, bigint, uuid) to fit_api;

-- Down Migration
-- Forward-only. Old callers omit prefillFromHistory and retain the empty set.
