-- YAFIT-296: завершённая тренировка считается состоявшейся независимо от
-- полноты плана. Детали PR возвращаются отдельно для понятной карточки Home.

create or replace function public.get_workout_regularity(
  p_client_id uuid,
  p_reference_time timestamptz default now()
)
returns table (
  period text,
  period_start date,
  period_end date,
  planned_count integer,
  completed_count integer,
  completed_planned_count integer,
  partial_count integer,
  skipped_count integer,
  completion_percent integer
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
  client_timezone text;
  today_value date;
  week_start date;
  month_start date;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select
    client.auth_user_id,
    client.trainer_id,
    coalesce(
      case when exists (
        select 1 from pg_catalog.pg_timezone_names zone
        where zone.name = client_profile.timezone
      ) then client_profile.timezone end,
      case when exists (
        select 1 from pg_catalog.pg_timezone_names zone
        where zone.name = trainer_profile.timezone
      ) then trainer_profile.timezone end,
      'Europe/Moscow'
    )
  into client_auth_user_id, root_trainer_id, client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id
    and client.archived_at is null;

  if root_trainer_id is null or not (
    actor_id = root_trainer_id
    or actor_id = client_auth_user_id
    or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = p_client_id
        and membership.trainer_id = actor_id
    )
  ) then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;

  today_value := (p_reference_time at time zone client_timezone)::date;
  week_start := today_value - (extract(isodow from today_value)::integer - 1);
  month_start := date_trunc('month', today_value::timestamp)::date;

  return query
  with periods as (
    select 'week'::text as kind, week_start as starts_on,
      week_start + 6 as ends_on, 1 as position
    union all
    select 'month'::text, month_start,
      (month_start + interval '1 month - 1 day')::date, 2
  ),
  workout_facts as (
    select
      workout.id,
      workout.workout_date,
      workout.status,
      client_auth_user_id is not null
        and workout.created_by = client_auth_user_id as client_authored,
      count(workout_set.id)::integer as total_sets,
      count(workout_set.id) filter (
        where workout_set.confirmed_at is not null
      )::integer as confirmed_sets
    from public.workouts workout
    left join public.workout_exercises exercise
      on exercise.workout_id = workout.id
      and exercise.trainer_id = workout.trainer_id
      and exercise.client_id = workout.client_id
    left join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id
      and workout_set.trainer_id = exercise.trainer_id
      and workout_set.client_id = exercise.client_id
    where workout.client_id = p_client_id
      and workout.deleted_at is null
      and workout.workout_date >= least(week_start, month_start)
      and workout.workout_date <= greatest(
        week_start + 6,
        (month_start + interval '1 month - 1 day')::date
      )
    group by workout.id, workout.workout_date, workout.status, workout.created_by
  ),
  aggregates as (
    select
      periods.kind,
      periods.starts_on,
      periods.ends_on,
      periods.position,
      count(fact.id) filter (where not fact.client_authored)::integer as planned,
      count(fact.id) filter (
        where fact.status = 'done'
      )::integer as completed,
      count(fact.id) filter (
        where not fact.client_authored
          and fact.status = 'done'
      )::integer as completed_planned,
      count(fact.id) filter (
        where fact.status = 'done'
          and fact.total_sets > 0
          and fact.confirmed_sets > 0
          and fact.confirmed_sets < fact.total_sets
      )::integer as partial,
      count(fact.id) filter (
        where not fact.client_authored
          and fact.status = 'planned'
          and fact.workout_date < today_value
      )::integer as skipped
    from periods
    left join workout_facts fact
      on fact.workout_date between periods.starts_on and periods.ends_on
    group by periods.kind, periods.starts_on, periods.ends_on, periods.position
  )
  select
    aggregates.kind,
    aggregates.starts_on,
    aggregates.ends_on,
    aggregates.planned,
    aggregates.completed,
    aggregates.completed_planned,
    aggregates.partial,
    aggregates.skipped,
    case when aggregates.planned = 0 then null
      else round(
        aggregates.completed_planned * 100.0 / aggregates.planned
      )::integer
    end
  from aggregates
  order by aggregates.position;
end;
$$;

comment on function public.get_workout_regularity(uuid, timestamptz) is
  'Current week/month workout attendance in client timezone. Every done workout counts; partial plan completion remains a separate detail.';

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
        compared.prior_best_weight_kg is null
        or compared.result_best_weight_kg > compared.prior_best_weight_kg
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
        compared.prior_best_weight_reps is null
        or compared.result_best_weight_reps > compared.prior_best_weight_reps
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
        compared.prior_primary_value is null
        or compared.result_primary_value > compared.prior_primary_value
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

comment on function public.list_workout_personal_records(uuid) is
  'Confirmed PR details for one accessible completed workout, with the exercise and exact achieved result.';

revoke all on function public.list_workout_personal_records(uuid)
  from public, anon;
grant execute on function public.list_workout_personal_records(uuid)
  to authenticated;
