-- A first comparable result is a baseline. No historical rows are rewritten.
create or replace function public.workout_has_personal_record(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select workout.id, workout.client_id, workout.completed_at
    from public.workouts workout
    where workout.id = p_workout_id
      and workout.status = 'done'
      and workout.deleted_at is null
  ),
  current_results as (
    select
      exercise.exercise_ref,
      exercise.input_kind,
      max(case exercise.input_kind
        when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(
          workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60)
        )
        when 'distance' then workout_set.fact_distance_km
      end) as primary_value,
      max(workout_set.fact_weight_kg) filter (
        where exercise.input_kind = 'strength'
      ) as best_weight_kg,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
          and workout_set.fact_reps is not null
      ) as best_weight_reps
    from target
    join public.workout_exercises exercise
      on exercise.workout_id = target.id
      and exercise.client_id = target.client_id
    join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id
      and workout_set.client_id = exercise.client_id
      and workout_set.confirmed_at is not null
    group by exercise.exercise_ref, exercise.input_kind
  ),
  compared as (
    select
      current_result.*,
      max(case prior_exercise.input_kind
        when 'strength' then prior_set.fact_weight_kg
        when 'reps' then prior_set.fact_reps::numeric
        when 'duration' then coalesce(
          prior_set.fact_duration_sec::numeric,
          round(prior_set.fact_duration_min * 60)
        )
        when 'distance' then prior_set.fact_distance_km
      end) as prior_primary_value,
      max(prior_set.fact_weight_kg) filter (
        where prior_exercise.input_kind = 'strength'
      ) as prior_best_weight_kg,
      max(prior_set.fact_weight_kg * prior_set.fact_reps) filter (
        where prior_exercise.input_kind = 'strength'
          and prior_set.fact_weight_kg is not null
          and prior_set.fact_reps is not null
      ) as prior_best_weight_reps
    from target
    join current_results current_result on true
    left join public.workouts prior_workout
      on prior_workout.client_id = target.client_id
      and prior_workout.status = 'done'
      and prior_workout.deleted_at is null
      and (prior_workout.completed_at, prior_workout.id)
        < (target.completed_at, target.id)
    left join public.workout_exercises prior_exercise
      on prior_exercise.workout_id = prior_workout.id
      and prior_exercise.client_id = prior_workout.client_id
      and prior_exercise.exercise_ref = current_result.exercise_ref
      and prior_exercise.input_kind = current_result.input_kind
    left join public.workout_sets prior_set
      on prior_set.workout_exercise_id = prior_exercise.id
      and prior_set.client_id = prior_exercise.client_id
      and prior_set.confirmed_at is not null
    group by
      current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps
  )
  select coalesce(bool_or(case
    when compared.input_kind = 'strength' then
      (
        compared.best_weight_kg is not null
        and (
          compared.prior_best_weight_kg is not null and compared.best_weight_kg > compared.prior_best_weight_kg
        )
      )
      or
      (
        compared.best_weight_reps is not null
        and (
          compared.prior_best_weight_reps is not null and compared.best_weight_reps > compared.prior_best_weight_reps
        )
      )
    else
      compared.primary_value is not null
      and (
        compared.prior_primary_value is not null and compared.primary_value > compared.prior_primary_value
      )
  end), false)
  from compared;
$$;

create or replace function public.list_workout_personal_records(
  p_workout_id uuid
)
returns table (
  exercise_ref text,
  exercise_name text,
  input_kind text,
  metric text,
  primary_value numeric,
  weight_kg numeric,
  reps integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not public.can_read_workout(p_workout_id) then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;

  return query
  with target as (
    select workout.id, workout.client_id, workout.completed_at
    from public.workouts workout
    where workout.id = p_workout_id
      and workout.status = 'done'
      and workout.deleted_at is null
  ),
  current_results as (
    select
      exercise.exercise_ref as result_exercise_ref,
      (array_agg(exercise.exercise_name order by exercise.position))[1]
        as result_exercise_name,
      exercise.input_kind as result_input_kind,
      min(exercise.position) as result_position,
      max(case exercise.input_kind
        when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(
          workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60)
        )
        when 'distance' then workout_set.fact_distance_km
      end) as result_primary_value,
      max(workout_set.fact_weight_kg) filter (
        where exercise.input_kind = 'strength'
      ) as result_best_weight_kg,
      (array_agg(
        workout_set.fact_reps
        order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position
      ) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
      ))[1] as result_reps_at_best_weight,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
          and workout_set.fact_reps is not null
      ) as result_best_weight_reps,
      (array_agg(
        workout_set.fact_weight_kg
        order by workout_set.fact_weight_kg * workout_set.fact_reps desc nulls last,
          workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position
      ) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
          and workout_set.fact_reps is not null
      ))[1] as result_volume_weight_kg,
      (array_agg(
        workout_set.fact_reps
        order by workout_set.fact_weight_kg * workout_set.fact_reps desc nulls last,
          workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position
      ) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
          and workout_set.fact_reps is not null
      ))[1] as result_volume_reps
    from target
    join public.workout_exercises exercise
      on exercise.workout_id = target.id
      and exercise.client_id = target.client_id
    join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id
      and workout_set.client_id = exercise.client_id
      and workout_set.confirmed_at is not null
    group by exercise.exercise_ref, exercise.input_kind
  ),
  compared as (
    select
      current_result.*,
      max(case prior_exercise.input_kind
        when 'strength' then prior_set.fact_weight_kg
        when 'reps' then prior_set.fact_reps::numeric
        when 'duration' then coalesce(
          prior_set.fact_duration_sec::numeric,
          round(prior_set.fact_duration_min * 60)
        )
        when 'distance' then prior_set.fact_distance_km
      end) as prior_primary_value,
      max(prior_set.fact_weight_kg) filter (
        where prior_exercise.input_kind = 'strength'
      ) as prior_best_weight_kg,
      max(prior_set.fact_weight_kg * prior_set.fact_reps) filter (
        where prior_exercise.input_kind = 'strength'
          and prior_set.fact_weight_kg is not null
          and prior_set.fact_reps is not null
      ) as prior_best_weight_reps
    from target
    join current_results current_result on true
    left join public.workouts prior_workout
      on prior_workout.client_id = target.client_id
      and prior_workout.status = 'done'
      and prior_workout.deleted_at is null
      and (prior_workout.completed_at, prior_workout.id)
        < (target.completed_at, target.id)
    left join public.workout_exercises prior_exercise
      on prior_exercise.workout_id = prior_workout.id
      and prior_exercise.client_id = prior_workout.client_id
      and prior_exercise.exercise_ref = current_result.result_exercise_ref
      and prior_exercise.input_kind = current_result.result_input_kind
    left join public.workout_sets prior_set
      on prior_set.workout_exercise_id = prior_exercise.id
      and prior_set.client_id = prior_exercise.client_id
      and prior_set.confirmed_at is not null
    group by
      current_result.result_exercise_ref,
      current_result.result_exercise_name,
      current_result.result_input_kind,
      current_result.result_position,
      current_result.result_primary_value,
      current_result.result_best_weight_kg,
      current_result.result_reps_at_best_weight,
      current_result.result_best_weight_reps,
      current_result.result_volume_weight_kg,
      current_result.result_volume_reps
  ),
  record_candidates as (
    select
      compared.result_exercise_ref,
      compared.result_exercise_name,
      compared.result_input_kind,
      'weight'::text as result_metric,
      compared.result_best_weight_kg as result_value,
      compared.result_best_weight_kg as result_weight_kg,
      compared.result_reps_at_best_weight as result_reps,
      compared.result_position,
      1 as metric_position
    from compared
    where compared.result_input_kind = 'strength'
      and compared.result_best_weight_kg is not null
      and (
        compared.prior_best_weight_kg is not null and compared.result_best_weight_kg > compared.prior_best_weight_kg
      )
    union all
    select
      compared.result_exercise_ref,
      compared.result_exercise_name,
      compared.result_input_kind,
      'weight_reps'::text,
      compared.result_best_weight_reps,
      compared.result_volume_weight_kg,
      compared.result_volume_reps,
      compared.result_position,
      2
    from compared
    where compared.result_input_kind = 'strength'
      and compared.result_best_weight_reps is not null
      and (
        compared.prior_best_weight_reps is not null and compared.result_best_weight_reps > compared.prior_best_weight_reps
      )
    union all
    select
      compared.result_exercise_ref,
      compared.result_exercise_name,
      compared.result_input_kind,
      'primary'::text,
      compared.result_primary_value,
      null::numeric,
      null::integer,
      compared.result_position,
      1
    from compared
    where compared.result_input_kind <> 'strength'
      and compared.result_primary_value is not null
      and (
        compared.prior_primary_value is not null and compared.result_primary_value > compared.prior_primary_value
      )
  )
  select
    candidate.result_exercise_ref,
    candidate.result_exercise_name,
    candidate.result_input_kind,
    candidate.result_metric,
    candidate.result_value,
    candidate.result_weight_kg,
    candidate.result_reps
  from record_candidates candidate
  order by candidate.result_position, candidate.metric_position;
end;
$$;

create or replace function public.list_exercise_progress(
  p_client_id uuid,
  p_exercise_ref text,
  p_limit integer default 20,
  p_before_completed_at timestamptz default null,
  p_before_workout_id uuid default null
)
returns table (
  workout_id uuid,
  workout_date date,
  completed_at timestamptz,
  exercise_name text,
  input_kind text,
  confirmed_set_count integer,
  primary_value numeric,
  previous_primary_value numeric,
  primary_change numeric,
  all_time_primary_value numeric,
  best_weight_kg numeric,
  reps_at_best_weight integer,
  best_weight_reps numeric,
  all_time_best_weight_kg numeric,
  all_time_best_weight_reps numeric,
  is_primary_pr boolean,
  is_weight_pr boolean,
  is_weight_reps_pr boolean,
  trainer_comment text,
  sets jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_auth_user_id uuid;
  root_trainer_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select client.auth_user_id, client.trainer_id
  into client_auth_user_id, root_trainer_id
  from public.clients client
  where client.id = p_client_id;

  if not found or not (
    coalesce(actor_id = root_trainer_id, false)
    or coalesce(actor_id = client_auth_user_id, false)
    or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = p_client_id
        and membership.trainer_id = actor_id
    )
  ) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;

  if nullif(btrim(p_exercise_ref), '') is null then
    raise exception 'exercise_ref_required' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'exercise_progress_limit_out_of_range' using errcode = '22023';
  end if;
  if (p_before_completed_at is null) is distinct from (p_before_workout_id is null) then
    raise exception 'exercise_progress_cursor_incomplete' using errcode = '22023';
  end if;

  return query
  with aggregated as (
    select
      workout.id as result_workout_id,
      workout.workout_date as result_workout_date,
      workout.completed_at as result_completed_at,
      (array_agg(exercise.exercise_name order by exercise.position))[1] as result_exercise_name,
      (array_agg(exercise.input_kind order by exercise.position))[1] as result_input_kind,
      count(workout_set.id)::integer as result_confirmed_set_count,
      max(case exercise.input_kind
        when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(
          workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60)
        )
        when 'distance' then workout_set.fact_distance_km
      end) as result_primary_value,
      max(workout_set.fact_weight_kg) filter (
        where exercise.input_kind = 'strength'
      ) as result_best_weight_kg,
      (array_agg(
        workout_set.fact_reps
        order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position,
          workout_set.position
      ) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
      ))[1] as result_reps_at_best_weight,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) filter (
        where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null
          and workout_set.fact_reps is not null
      ) as result_best_weight_reps,
      nullif(string_agg(
        distinct nullif(btrim(exercise.trainer_comment), ''),
        E'\n' order by nullif(btrim(exercise.trainer_comment), '')
      ), '') as result_trainer_comment,
      jsonb_agg(jsonb_build_object(
        'weightKg', workout_set.fact_weight_kg,
        'reps', workout_set.fact_reps,
        'durationSec', coalesce(
          workout_set.fact_duration_sec,
          round(workout_set.fact_duration_min * 60)::integer
        ),
        'distanceKm', workout_set.fact_distance_km,
        'rpe', workout_set.fact_rpe
      ) order by exercise.position, workout_set.position) as result_sets
    from public.workouts workout
    join public.workout_exercises exercise
      on exercise.workout_id = workout.id
      and exercise.client_id = workout.client_id
      and exercise.trainer_id = workout.trainer_id
    join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id
      and workout_set.client_id = exercise.client_id
      and workout_set.trainer_id = exercise.trainer_id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id
      and workout.status = 'done'
      and workout.deleted_at is null
      and exercise.exercise_ref = p_exercise_ref
    group by workout.id, workout.workout_date, workout.completed_at
  ),
  compared as (
    select
      aggregated.*,
      lag(aggregated.result_primary_value) over progress_order as result_previous_primary_value,
      max(aggregated.result_primary_value) over prior_results as prior_primary_best,
      max(aggregated.result_best_weight_kg) over prior_results as prior_weight_best,
      max(aggregated.result_best_weight_reps) over prior_results as prior_weight_reps_best,
      max(aggregated.result_primary_value) over () as result_all_time_primary_value,
      max(aggregated.result_best_weight_kg) over () as result_all_time_best_weight_kg,
      max(aggregated.result_best_weight_reps) over () as result_all_time_best_weight_reps,
      count(*) over () as result_total_count
    from aggregated
    window
      progress_order as (
        order by aggregated.result_completed_at, aggregated.result_workout_id
      ),
      prior_results as (
        order by aggregated.result_completed_at, aggregated.result_workout_id
        rows between unbounded preceding and 1 preceding
      )
  )
  select
    compared.result_workout_id,
    compared.result_workout_date,
    compared.result_completed_at,
    compared.result_exercise_name,
    compared.result_input_kind,
    compared.result_confirmed_set_count,
    compared.result_primary_value,
    compared.result_previous_primary_value,
    compared.result_primary_value - compared.result_previous_primary_value,
    compared.result_all_time_primary_value,
    compared.result_best_weight_kg,
    compared.result_reps_at_best_weight,
    compared.result_best_weight_reps,
    compared.result_all_time_best_weight_kg,
    compared.result_all_time_best_weight_reps,
    compared.result_primary_value is not null and (
      compared.prior_primary_best is not null and compared.result_primary_value > compared.prior_primary_best
    ),
    compared.result_best_weight_kg is not null and (
      compared.prior_weight_best is not null and compared.result_best_weight_kg > compared.prior_weight_best
    ),
    compared.result_best_weight_reps is not null and (
      compared.prior_weight_reps_best is not null and compared.result_best_weight_reps > compared.prior_weight_reps_best
    ),
    compared.result_trainer_comment,
    compared.result_sets,
    compared.result_total_count
  from compared
  where p_before_completed_at is null
    or (compared.result_completed_at, compared.result_workout_id)
      < (p_before_completed_at, p_before_workout_id)
  order by compared.result_completed_at desc, compared.result_workout_id desc
  limit p_limit;
end;
$$;
