-- Up Migration

create or replace function public.list_exercise_progress(
  p_client_id uuid, p_exercise_ref text, p_limit integer default 20,
  p_before_completed_at timestamptz default null, p_before_workout_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  if nullif(btrim(p_exercise_ref), '') is null or p_limit < 1 or p_limit > 50
    or ((p_before_completed_at is null) is distinct from (p_before_workout_id is null)) then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  return (with aggregated as (
    select workout.id, workout.workout_date, workout.completed_at,
      min(exercise.exercise_name) exercise_name, min(exercise.input_kind) input_kind,
      count(workout_set.id)::integer confirmed_set_count,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) best_weight_kg,
      (array_agg(workout_set.fact_reps
        order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position)
        filter (where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null))[1] reps_at_best_weight,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) best_weight_reps,
      nullif(string_agg(distinct nullif(btrim(exercise.trainer_comment), ''), E'\n'), '') trainer_comment,
      jsonb_agg(jsonb_build_object('weightKg', workout_set.fact_weight_kg,
        'reps', workout_set.fact_reps,
        'durationSec', coalesce(workout_set.fact_duration_sec,
          round(workout_set.fact_duration_min * 60)::integer),
        'distanceKm', workout_set.fact_distance_km, 'rpe', workout_set.fact_rpe)
        order by exercise.position, workout_set.position) sets
    from public.workouts workout
    join public.workout_exercises exercise on exercise.workout_id = workout.id
      and exercise.exercise_ref = p_exercise_ref
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id and workout.status = 'done'
      and workout.deleted_at is null
    group by workout.id, workout.workout_date, workout.completed_at
  ), compared as (
    select aggregated.*,
      lag(primary_value) over ordered previous_primary_value,
      max(primary_value) over prior prior_primary_best,
      max(best_weight_kg) over prior prior_weight_best,
      max(best_weight_reps) over prior prior_weight_reps_best,
      max(primary_value) over () all_time_primary_value,
      max(best_weight_kg) over () all_time_best_weight_kg,
      max(best_weight_reps) over () all_time_best_weight_reps,
      count(*) over () total_count
    from aggregated window
      ordered as (order by completed_at, id),
      prior as (order by completed_at, id rows between unbounded preceding and 1 preceding)
  ), page as (select * from compared
    where p_before_completed_at is null
      or (completed_at, id) < (p_before_completed_at, p_before_workout_id)
    order by completed_at desc, id desc limit p_limit + 1
  ) select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'workoutId', id, 'workoutDate', workout_date, 'completedAt', completed_at,
      'exerciseName', exercise_name, 'inputKind', input_kind,
      'confirmedSetCount', confirmed_set_count, 'primaryValue', primary_value,
      'previousPrimaryValue', previous_primary_value,
      'primaryChange', primary_value - previous_primary_value,
      'allTimePrimaryValue', all_time_primary_value,
      'bestWeightKg', best_weight_kg, 'bestWeightReps', best_weight_reps,
      'repsAtBestWeight', reps_at_best_weight, 'trainerComment', trainer_comment,
      'allTimeBestWeightKg', all_time_best_weight_kg,
      'allTimeBestWeightReps', all_time_best_weight_reps,
      'isPrimaryPr', primary_value is not null and (prior_primary_best is not null and primary_value > prior_primary_best),
      'isWeightPr', best_weight_kg is not null and (prior_weight_best is not null and best_weight_kg > prior_weight_best),
      'isWeightRepsPr', best_weight_reps is not null and (prior_weight_reps_best is not null and best_weight_reps > prior_weight_reps_best),
      'sets', sets
    ) order by completed_at desc, id desc) filter (where row_number <= p_limit), '[]'::jsonb),
    'nextCursor', case when max(page_count) > p_limit then
      (jsonb_agg(jsonb_build_object('completedAt', completed_at, 'workoutId', id)
        order by row_number) filter (where row_number = p_limit))->0
      else null end,
    'totalCount', coalesce(max(total_count), 0)
  ) from (select page.*,
      row_number() over (order by completed_at desc, id desc) row_number,
      count(*) over () page_count from page) numbered);
end;
$$;

create or replace function app_private.workout_has_personal_record(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select workout.id, workout.client_id, workout.completed_at
    from public.workouts workout
    where workout.id = p_workout_id and workout.status = 'done'
      and workout.deleted_at is null
  ), current_results as (
    select exercise.exercise_ref, exercise.input_kind,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) filter (where exercise.input_kind = 'strength') best_weight_kg,
      max(workout_set.fact_weight_kg * workout_set.fact_reps)
        filter (where exercise.input_kind = 'strength') best_weight_reps
    from target
    join public.workout_exercises exercise on exercise.workout_id = target.id
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    group by exercise.exercise_ref, exercise.input_kind
  ), prior_results as (
    select current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps,
      max(case prior_exercise.input_kind when 'strength' then prior_set.fact_weight_kg
        when 'reps' then prior_set.fact_reps::numeric
        when 'duration' then coalesce(prior_set.fact_duration_sec::numeric,
          round(prior_set.fact_duration_min * 60))
        when 'distance' then prior_set.fact_distance_km end) prior_primary_value,
      max(prior_set.fact_weight_kg) filter (where prior_exercise.input_kind = 'strength') prior_weight_kg,
      max(prior_set.fact_weight_kg * prior_set.fact_reps)
        filter (where prior_exercise.input_kind = 'strength') prior_weight_reps
    from target join current_results current_result on true
    left join public.workouts prior_workout on prior_workout.client_id = target.client_id
      and prior_workout.status = 'done' and prior_workout.deleted_at is null
      and (prior_workout.completed_at, prior_workout.id) < (target.completed_at, target.id)
    left join public.workout_exercises prior_exercise
      on prior_exercise.workout_id = prior_workout.id
      and prior_exercise.exercise_ref = current_result.exercise_ref
      and prior_exercise.input_kind = current_result.input_kind
    left join public.workout_sets prior_set on prior_set.workout_exercise_id = prior_exercise.id
      and prior_set.confirmed_at is not null
    group by current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps
  )
  select coalesce(bool_or(case when input_kind = 'strength' then
      (best_weight_kg is not null and (prior_weight_kg is not null and best_weight_kg > prior_weight_kg))
      or (best_weight_reps is not null
        and (prior_weight_reps is not null and best_weight_reps > prior_weight_reps))
    else primary_value is not null
      and (prior_primary_value is not null and primary_value > prior_primary_value) end), false)
  from prior_results
$$;

-- Down Migration

create or replace function public.list_exercise_progress(
  p_client_id uuid, p_exercise_ref text, p_limit integer default 20,
  p_before_completed_at timestamptz default null, p_before_workout_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  if nullif(btrim(p_exercise_ref), '') is null or p_limit < 1 or p_limit > 50
    or ((p_before_completed_at is null) is distinct from (p_before_workout_id is null)) then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  return (with aggregated as (
    select workout.id, workout.workout_date, workout.completed_at,
      min(exercise.exercise_name) exercise_name, min(exercise.input_kind) input_kind,
      count(workout_set.id)::integer confirmed_set_count,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) best_weight_kg,
      (array_agg(workout_set.fact_reps
        order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position)
        filter (where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null))[1] reps_at_best_weight,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) best_weight_reps,
      nullif(string_agg(distinct nullif(btrim(exercise.trainer_comment), ''), E'\n'), '') trainer_comment,
      jsonb_agg(jsonb_build_object('weightKg', workout_set.fact_weight_kg,
        'reps', workout_set.fact_reps,
        'durationSec', coalesce(workout_set.fact_duration_sec,
          round(workout_set.fact_duration_min * 60)::integer),
        'distanceKm', workout_set.fact_distance_km, 'rpe', workout_set.fact_rpe)
        order by exercise.position, workout_set.position) sets
    from public.workouts workout
    join public.workout_exercises exercise on exercise.workout_id = workout.id
      and exercise.exercise_ref = p_exercise_ref
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id and workout.status = 'done'
      and workout.deleted_at is null
    group by workout.id, workout.workout_date, workout.completed_at
  ), compared as (
    select aggregated.*,
      lag(primary_value) over ordered previous_primary_value,
      max(primary_value) over prior prior_primary_best,
      max(best_weight_kg) over prior prior_weight_best,
      max(best_weight_reps) over prior prior_weight_reps_best,
      max(primary_value) over () all_time_primary_value,
      max(best_weight_kg) over () all_time_best_weight_kg,
      max(best_weight_reps) over () all_time_best_weight_reps,
      count(*) over () total_count
    from aggregated window
      ordered as (order by completed_at, id),
      prior as (order by completed_at, id rows between unbounded preceding and 1 preceding)
  ), page as (select * from compared
    where p_before_completed_at is null
      or (completed_at, id) < (p_before_completed_at, p_before_workout_id)
    order by completed_at desc, id desc limit p_limit + 1
  ) select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'workoutId', id, 'workoutDate', workout_date, 'completedAt', completed_at,
      'exerciseName', exercise_name, 'inputKind', input_kind,
      'confirmedSetCount', confirmed_set_count, 'primaryValue', primary_value,
      'previousPrimaryValue', previous_primary_value,
      'primaryChange', primary_value - previous_primary_value,
      'allTimePrimaryValue', all_time_primary_value,
      'bestWeightKg', best_weight_kg, 'bestWeightReps', best_weight_reps,
      'repsAtBestWeight', reps_at_best_weight, 'trainerComment', trainer_comment,
      'allTimeBestWeightKg', all_time_best_weight_kg,
      'allTimeBestWeightReps', all_time_best_weight_reps,
      'isPrimaryPr', primary_value is not null and (prior_primary_best is null or primary_value > prior_primary_best),
      'isWeightPr', best_weight_kg is not null and (prior_weight_best is null or best_weight_kg > prior_weight_best),
      'isWeightRepsPr', best_weight_reps is not null and (prior_weight_reps_best is null or best_weight_reps > prior_weight_reps_best),
      'sets', sets
    ) order by completed_at desc, id desc) filter (where row_number <= p_limit), '[]'::jsonb),
    'nextCursor', case when max(page_count) > p_limit then
      (jsonb_agg(jsonb_build_object('completedAt', completed_at, 'workoutId', id)
        order by row_number) filter (where row_number = p_limit))->0
      else null end,
    'totalCount', coalesce(max(total_count), 0)
  ) from (select page.*,
      row_number() over (order by completed_at desc, id desc) row_number,
      count(*) over () page_count from page) numbered);
end;
$$;

create or replace function app_private.workout_has_personal_record(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select workout.id, workout.client_id, workout.completed_at
    from public.workouts workout
    where workout.id = p_workout_id and workout.status = 'done'
      and workout.deleted_at is null
  ), current_results as (
    select exercise.exercise_ref, exercise.input_kind,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) filter (where exercise.input_kind = 'strength') best_weight_kg,
      max(workout_set.fact_weight_kg * workout_set.fact_reps)
        filter (where exercise.input_kind = 'strength') best_weight_reps
    from target
    join public.workout_exercises exercise on exercise.workout_id = target.id
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    group by exercise.exercise_ref, exercise.input_kind
  ), prior_results as (
    select current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps,
      max(case prior_exercise.input_kind when 'strength' then prior_set.fact_weight_kg
        when 'reps' then prior_set.fact_reps::numeric
        when 'duration' then coalesce(prior_set.fact_duration_sec::numeric,
          round(prior_set.fact_duration_min * 60))
        when 'distance' then prior_set.fact_distance_km end) prior_primary_value,
      max(prior_set.fact_weight_kg) filter (where prior_exercise.input_kind = 'strength') prior_weight_kg,
      max(prior_set.fact_weight_kg * prior_set.fact_reps)
        filter (where prior_exercise.input_kind = 'strength') prior_weight_reps
    from target join current_results current_result on true
    left join public.workouts prior_workout on prior_workout.client_id = target.client_id
      and prior_workout.status = 'done' and prior_workout.deleted_at is null
      and (prior_workout.completed_at, prior_workout.id) < (target.completed_at, target.id)
    left join public.workout_exercises prior_exercise
      on prior_exercise.workout_id = prior_workout.id
      and prior_exercise.exercise_ref = current_result.exercise_ref
      and prior_exercise.input_kind = current_result.input_kind
    left join public.workout_sets prior_set on prior_set.workout_exercise_id = prior_exercise.id
      and prior_set.confirmed_at is not null
    group by current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps
  )
  select coalesce(bool_or(case when input_kind = 'strength' then
      (best_weight_kg is not null and (prior_weight_kg is null or best_weight_kg > prior_weight_kg))
      or (best_weight_reps is not null
        and (prior_weight_reps is null or best_weight_reps > prior_weight_reps))
    else primary_value is not null
      and (prior_primary_value is null or primary_value > prior_primary_value) end), false)
  from prior_results
$$;
