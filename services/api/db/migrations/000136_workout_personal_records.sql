-- Up Migration

-- Read the selected workout directly; Progress pagination is not a lookup API.
-- Historical comparisons intentionally use the client's shared completed history.
create function public.list_workout_personal_records(p_workout_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_read_workout(p_workout_id) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return (
    with target as (
      select id, client_id, completed_at from public.workouts
      where id = p_workout_id and status = 'done' and deleted_at is null
    ), current_results as (
      select exercise.exercise_ref, exercise.input_kind,
        (array_agg(exercise.exercise_name order by exercise.position))[1] exercise_name,
        min(exercise.position) position,
        max(case exercise.input_kind
          when 'strength' then workout_set.fact_weight_kg
          when 'reps' then workout_set.fact_reps::numeric
          when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
            round(workout_set.fact_duration_min * 60))
          when 'distance' then workout_set.fact_distance_km end) primary_value,
        max(workout_set.fact_weight_kg) best_weight,
        (array_agg(workout_set.fact_reps order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last, exercise.position, workout_set.position)
          filter (where workout_set.fact_weight_kg is not null))[1] weight_reps,
        max(workout_set.fact_weight_kg * workout_set.fact_reps) best_volume,
        (array_agg(workout_set.fact_weight_kg
          order by workout_set.fact_weight_kg * workout_set.fact_reps desc,
            workout_set.fact_weight_kg desc, workout_set.fact_reps desc,
            exercise.position, workout_set.position)
          filter (where workout_set.fact_weight_kg is not null and workout_set.fact_reps is not null))[1] volume_weight,
        (array_agg(workout_set.fact_reps
          order by workout_set.fact_weight_kg * workout_set.fact_reps desc,
            workout_set.fact_weight_kg desc, workout_set.fact_reps desc,
            exercise.position, workout_set.position)
          filter (where workout_set.fact_weight_kg is not null and workout_set.fact_reps is not null))[1] volume_reps
      from target
      join public.workout_exercises exercise on exercise.workout_id = target.id
        and exercise.client_id = target.client_id
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
        and workout_set.client_id = target.client_id and workout_set.confirmed_at is not null
      group by exercise.exercise_ref, exercise.input_kind
    ), prior_results as (
      select exercise.exercise_ref, exercise.input_kind,
        max(case exercise.input_kind
          when 'strength' then workout_set.fact_weight_kg
          when 'reps' then workout_set.fact_reps::numeric
          when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
            round(workout_set.fact_duration_min * 60))
          when 'distance' then workout_set.fact_distance_km end) primary_value,
        max(workout_set.fact_weight_kg) best_weight,
        max(workout_set.fact_weight_kg * workout_set.fact_reps) best_volume
      from target
      join public.workouts workout on workout.client_id = target.client_id
        and workout.status = 'done' and workout.deleted_at is null
        and (workout.completed_at, workout.id) < (target.completed_at, target.id)
      join public.workout_exercises exercise on exercise.workout_id = workout.id
        and exercise.client_id = target.client_id
      join current_results selected on selected.exercise_ref = exercise.exercise_ref
        and selected.input_kind = exercise.input_kind
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
        and workout_set.client_id = target.client_id and workout_set.confirmed_at is not null
      group by exercise.exercise_ref, exercise.input_kind
    ), records as (
      select current_result.*, candidate.*
      from current_results current_result
      join prior_results prior using (exercise_ref, input_kind)
      cross join lateral (values
        ('primary', current_result.primary_value, null::numeric, null::integer, 1,
          current_result.input_kind <> 'strength' and current_result.primary_value > prior.primary_value),
        ('weight', current_result.best_weight, current_result.best_weight, current_result.weight_reps, 1,
          current_result.input_kind = 'strength' and current_result.best_weight > prior.best_weight),
        ('weight_reps', current_result.best_volume, current_result.volume_weight, current_result.volume_reps, 2,
          current_result.input_kind = 'strength' and current_result.best_volume > prior.best_volume)
      ) candidate(metric, value, weight, reps, metric_position, is_record)
      where candidate.is_record
    ) select coalesce(jsonb_agg(jsonb_build_object(
      'exerciseRef', exercise_ref, 'exerciseName', exercise_name, 'inputKind', input_kind,
      'metric', metric, 'primaryValue', value, 'weightKg', weight, 'reps', reps
    ) order by position, metric_position, exercise_ref, input_kind), '[]'::jsonb) from records
  );
end;
$$;

revoke all on function public.list_workout_personal_records(uuid) from public;
grant execute on function public.list_workout_personal_records(uuid) to fit_api;

-- Down Migration

drop function public.list_workout_personal_records(uuid);
