-- YAFIT-287: постраничный серверный прогресс упражнения и вычисляемые PR.
-- Источник истины — только confirmed sets завершённых, неудалённых workouts.

create index if not exists workout_exercises_client_ref_workout_idx
  on public.workout_exercises (client_id, exercise_ref, workout_id);

create index if not exists workouts_completed_client_cursor_idx
  on public.workouts (client_id, completed_at desc, id desc)
  where status = 'done' and deleted_at is null;

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
      compared.prior_primary_best is null
      or compared.result_primary_value > compared.prior_primary_best
    ),
    compared.result_best_weight_kg is not null and (
      compared.prior_weight_best is null
      or compared.result_best_weight_kg > compared.prior_weight_best
    ),
    compared.result_best_weight_reps is not null and (
      compared.prior_weight_reps_best is null
      or compared.result_best_weight_reps > compared.prior_weight_reps_best
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

comment on function public.list_exercise_progress(uuid, text, integer, timestamptz, uuid) is
  'Paginated confirmed exercise facts with deterministic PR flags compared only to earlier completed workouts.';

revoke all on function public.list_exercise_progress(uuid, text, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_exercise_progress(uuid, text, integer, timestamptz, uuid)
  to authenticated;
