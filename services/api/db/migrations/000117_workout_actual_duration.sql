-- Up Migration
-- Manual actual time is a fact, separate from the Live/audit clock.
alter table public.workouts add column actual_duration_sec integer
  check (actual_duration_sec between 1 and 43200);
comment on column public.workouts.actual_duration_sec is
  'Explicit actual workout duration in seconds. Null leaves the existing Live estimate unchanged.';

create or replace function public.save_completed_workout(
  p_workout jsonb, p_expected_version bigint default null
)
returns table (workout_id uuid, version bigint)
language plpgsql security definer set search_path = '' as $$
declare
  saved_workout_id uuid;
  saved_version bigint;
  exercise_item jsonb;
  set_item jsonb;
  was_replayed boolean := false;
begin
  if p_workout->>'id' is null and p_workout->>'requestId' is not null then
    select exists (
      select 1 from app_private.workout_create_requests request
      where request.actor_id = auth.uid()
        and request.request_id = (p_workout->>'requestId')::uuid
        and request.workout_id is not null
    ) into was_replayed;
  end if;

  select saved.workout_id, saved.version into saved_workout_id, saved_version
  from app_private.save_completed_workout_without_metric_sources(p_workout, p_expected_version) saved;

  if was_replayed then
    return query select saved_workout_id, saved_version;
    return;
  end if;

  -- Authorized and version-checked by the lifecycle command above.
  -- Omitted key preserves old clients; JSON null explicitly removes the override.
  if p_workout ? 'actualDurationSec' then
    update public.workouts set actual_duration_sec = (p_workout->>'actualDurationSec')::integer
    where id = saved_workout_id;
  end if;

  -- The only authority to call this wrapper is the original lifecycle function.
  -- Match the post-save snapshot by its validated positions; never infer a
  -- historical source from a fact value simply being present.
  for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
    for set_item in select value from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb)) loop
      update public.workout_sets workout_set set
        fact_duration_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'duration',
            case when p_workout->>'id' is null then 'planned' end),
          app_private.canonical_set_duration_seconds(workout_set.fact_duration_sec, workout_set.fact_duration_min),
          app_private.canonical_set_duration_seconds(workout_set.plan_duration_sec, workout_set.plan_duration_min)
        ),
        fact_distance_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'distance',
            case when p_workout->>'id' is null then 'planned' end),
          workout_set.fact_distance_km, workout_set.plan_distance_km
        ),
        fact_rpe_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'rpe',
            case when p_workout->>'id' is null then 'planned' end),
          workout_set.fact_rpe, workout_set.plan_rpe
        )
      from public.workout_exercises exercise
      where exercise.id = workout_set.workout_exercise_id
        and exercise.workout_id = saved_workout_id
        and exercise.position = (exercise_item->>'position')::smallint
        and workout_set.position = (set_item->>'position')::smallint
        and workout_set.confirmed_at is not null;
    end loop;
  end loop;

  update public.workout_sets workout_set set
    fact_duration_source = 'unknown', fact_distance_source = 'unknown', fact_rpe_source = 'unknown'
  from public.workout_exercises exercise
  where exercise.id = workout_set.workout_exercise_id
    and exercise.workout_id = saved_workout_id
    and workout_set.confirmed_at is null;

  return query select saved_workout_id, saved_version;
end;
$$;

create or replace function app_private.refresh_workout_calorie_estimate(
  p_workout_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  workout_row public.workouts%rowtype;
  weight_kg_value numeric;
  confirmed_set_count integer := 0;
  duration_set_count integer := 0;
  exercise_count integer := 0;
  recorded_duration_min numeric := 0;
  average_rpe numeric;
  has_circuit boolean := false;
  has_interval boolean := false;
  bodyweight_only boolean := false;
  has_heavy_compound boolean := false;
  raw_duration_min numeric;
  structural_duration_min numeric;
  effective_duration_min numeric;
  met_value numeric;
  calories_value integer;
begin
  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  if workout_row.id is null then
    return;
  end if;

  if workout_row.status <> 'done' then
    if workout_row.active_calories_kcal is not null then
      update public.workouts workout
      set active_calories_kcal = null,
          calorie_estimate_version = null,
          calorie_estimate_weight_kg = null,
          calorie_estimate_duration_min = null,
          calorie_estimated_at = null
      where workout.id = p_workout_id;
    end if;
    return;
  end if;

  select progress.weight_kg into weight_kg_value
  from public.client_progress progress
  where progress.client_id = workout_row.client_id
    and progress.deleted_at is null
    and progress.weight_kg > 0
  order by
    (progress.recorded_on > workout_row.workout_date),
    case
      when progress.recorded_on <= workout_row.workout_date
        then workout_row.workout_date - progress.recorded_on
      else progress.recorded_on - workout_row.workout_date
    end,
    progress.recorded_on desc,
    progress.id desc
  limit 1;

  select
    count(*)::integer,
    count(*) filter (
      where exercise.input_kind in ('duration', 'distance')
        and coalesce(workout_set.fact_duration_min, 0) * 60
          + coalesce(workout_set.fact_duration_sec, 0) > 0
    )::integer,
    count(distinct exercise.id)::integer,
    coalesce(sum(
      coalesce(workout_set.fact_duration_min, 0)
      + coalesce(workout_set.fact_duration_sec, 0) / 60.0
    ), 0),
    avg(coalesce(workout_set.fact_rpe, workout_set.plan_rpe)),
    coalesce(bool_or(exercise.block_preset = 'circuit'), false),
    coalesce(bool_or(exercise.block_preset = 'interval'), false),
    coalesce(bool_and(
      exercise.input_kind = 'reps'
      and coalesce(workout_set.fact_weight_kg, workout_set.plan_weight_kg, 0) = 0
    ), false),
    coalesce(bool_or(
      exercise.exercise_ref ~* '(squat|deadlift|leg[-_ ]?press)'
      or exercise.exercise_name ~* '(присед|станов|жим ногами|squat|deadlift|leg press)'
    ), false)
  into
    confirmed_set_count,
    duration_set_count,
    exercise_count,
    recorded_duration_min,
    average_rpe,
    has_circuit,
    has_interval,
    bodyweight_only,
    has_heavy_compound
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where exercise.workout_id = p_workout_id
    and workout_set.confirmed_at is not null;

  if weight_kg_value is null or confirmed_set_count = 0 then
    update public.workouts workout
    set active_calories_kcal = null,
        calorie_estimate_version = null,
        calorie_estimate_weight_kg = null,
        calorie_estimate_duration_min = null,
        calorie_estimated_at = null
    where workout.id = p_workout_id
      and (
        workout.active_calories_kcal is not null
        or workout.calorie_estimate_version is not null
        or workout.calorie_estimate_weight_kg is not null
        or workout.calorie_estimate_duration_min is not null
        or workout.calorie_estimated_at is not null
      );
    return;
  end if;

  raw_duration_min := case
    when workout_row.actual_duration_sec is not null then workout_row.actual_duration_sec / 60.0
    when workout_row.started_at is not null
      and workout_row.completed_at is not null
      and workout_row.completed_at > workout_row.started_at
      then extract(epoch from (workout_row.completed_at - workout_row.started_at)) / 60.0
    when workout_row.start_time is not null
      and workout_row.end_time is not null
      and workout_row.end_time > workout_row.start_time
      then extract(epoch from (workout_row.end_time - workout_row.start_time)) / 60.0
    else null
  end;

  -- 3.5 minutes per ordinary strength set includes work and the usual rest.
  -- Recorded cardio/duration sets keep their measured time instead.
  structural_duration_min := recorded_duration_min
    + greatest(confirmed_set_count - duration_set_count, 0) * 3.5
    + exercise_count * 2
    + 5;

  effective_duration_min := least(
    180,
    case
      when raw_duration_min is not null and raw_duration_min >= 5 then
        least(raw_duration_min, greatest(structural_duration_min * 1.25, recorded_duration_min, 10))
      else greatest(structural_duration_min, recorded_duration_min, 10)
    end
  );

  met_value := case
    when has_interval then 6.5
    when has_circuit then 5.8
    when bodyweight_only and coalesce(workout_row.session_rpe, average_rpe, 0) >= 8 then 6.5
    when bodyweight_only then 3.0
    when coalesce(workout_row.session_rpe, average_rpe, 0) >= 8.5 then 6.0
    when has_heavy_compound then 5.0
    else 3.5
  end;

  -- Active energy only: subtract the resting 1 MET before applying the
  -- standard MET formula. Rounded to 5 kcal to avoid false precision.
  calories_value := greatest(5, (
    round((((met_value - 1) * 3.5 * weight_kg_value / 200)
      * effective_duration_min) / 5) * 5
  )::integer);

  update public.workouts workout
  set active_calories_kcal = calories_value,
      calorie_estimate_version = 1,
      calorie_estimate_weight_kg = weight_kg_value,
      calorie_estimate_duration_min = round(effective_duration_min, 1),
      calorie_estimated_at = now()
  where workout.id = p_workout_id
    and (
      workout.active_calories_kcal is distinct from calories_value
      or workout.calorie_estimate_version is distinct from 1
      or workout.calorie_estimate_weight_kg is distinct from weight_kg_value
      or workout.calorie_estimate_duration_min is distinct from round(effective_duration_min, 1)
    );
end;
$$;

create or replace function app_private.refresh_workout_calorie_shadow_v2(p_workout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  workout_row public.workouts%rowtype;
  weight_kg_value numeric;
  elapsed_seconds integer;
  set_row record;
  activity text;
  work_seconds integer;
  total_work_seconds integer := 0;
  total_strength_seconds integer := 0;
  strength_seconds integer;
  effective_seconds integer;
  speed_kmh numeric;
  met_value numeric;
  energy numeric := 0;
  strength_energy numeric := 0;
  scale_factor numeric := 1;
  estimated_kcal integer;
  reason_value text;
  segments jsonb := '[]'::jsonb;
  confirmed_count integer := 0;
begin
  select * into workout_row from public.workouts
  where id = p_workout_id and deleted_at is null;
  if workout_row.id is null then return; end if;

  if workout_row.status <> 'done' then
    reason_value := 'not_completed';
  else
    weight_kg_value := app_private.workout_weight_on_date(
      workout_row.client_id, workout_row.workout_date);
    elapsed_seconds := coalesce(workout_row.actual_duration_sec, app_private.workout_elapsed_seconds(
      workout_row.started_at, workout_row.completed_at,
      workout_row.start_time, workout_row.end_time));
    if weight_kg_value is null then reason_value := 'missing_weight'; end if;
  end if;

  if reason_value is null then
    for set_row in
      select exercise.exercise_ref, exercise.exercise_source, exercise.muscle_group,
        exercise.block_preset, workout_set.id,
        workout_set.fact_duration_source, workout_set.fact_distance_source,
        workout_set.fact_rpe_source, workout_set.fact_distance_km,
        workout_set.fact_rpe, workout_set.fact_weight_kg,
        app_private.canonical_set_duration_seconds(
          workout_set.fact_duration_sec, workout_set.fact_duration_min) as duration_seconds,
        app_private.set_duration_is_consistent(
          workout_set.fact_duration_sec, workout_set.fact_duration_min) as duration_consistent
      from public.workout_exercises exercise
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      where exercise.workout_id = p_workout_id
        and workout_set.confirmed_at is not null
      order by exercise.position, workout_set.position
    loop
      confirmed_count := confirmed_count + 1;
      activity := app_private.calorie_v2_activity(
        set_row.exercise_source, set_row.exercise_ref,
        set_row.muscle_group, set_row.block_preset);
      if not set_row.duration_consistent then
        reason_value := 'contradictory_duration'; exit;
      end if;
      work_seconds := case when set_row.fact_duration_source = 'entered'
        then set_row.duration_seconds end;
      if activity not in ('strength', 'strength-heavy', 'strength-circuit') then
        if work_seconds is null or work_seconds <= 0 then
          reason_value := 'missing_activity_duration'; exit;
        end if;
        if work_seconds > 21600 then
          reason_value := 'implausible_activity_duration'; exit;
        end if;
        total_work_seconds := total_work_seconds + work_seconds;
        speed_kmh := null;
        if set_row.fact_distance_source = 'entered'
          and set_row.fact_distance_km > 0
          and activity in ('running', 'walking', 'interval-walking',
            'rowing-machine', 'interval-rowing') then
          speed_kmh := set_row.fact_distance_km * 3600 / work_seconds;
          if (activity = 'running' and speed_kmh not between 5 and 25)
            or (activity in ('walking', 'interval-walking') and speed_kmh not between 1 and 9)
            or (activity in ('rowing-machine', 'interval-rowing') and speed_kmh not between 3 and 20) then
            speed_kmh := null;
          end if;
        end if;
        met_value := app_private.calorie_v2_met(activity, speed_kmh,
          case when set_row.fact_rpe_source = 'entered' then set_row.fact_rpe end);
        energy := energy + (met_value - 1) * 3.5 * weight_kg_value / 200 * work_seconds / 60;
        segments := segments || jsonb_build_array(jsonb_build_object(
          'exerciseRef', set_row.exercise_ref, 'activity', activity,
          'setId', set_row.id, 'workSeconds', work_seconds,
          'distanceKm', case when set_row.fact_distance_source = 'entered'
            then set_row.fact_distance_km end,
          'speedKmh', case when speed_kmh is not null then round(speed_kmh, 2) end,
          'met', met_value, 'durationSource', set_row.fact_duration_source,
          'distanceSource', set_row.fact_distance_source,
          'rpeSource', set_row.fact_rpe_source));
      else
        -- A strength set includes limited ordinary rest; no cardio is inferred
        -- from the remaining wall-clock session time.
        strength_seconds := coalesce(work_seconds,
          case when set_row.fact_weight_kg > 0 then 180 else 150 end);
        strength_seconds := least(strength_seconds, 300);
        total_strength_seconds := total_strength_seconds + strength_seconds;
        met_value := app_private.calorie_v2_met(activity, null,
          case when set_row.fact_rpe_source = 'entered' then set_row.fact_rpe end);
        strength_energy := strength_energy
          + (met_value - 1) * 3.5 * weight_kg_value / 200 * strength_seconds / 60;
        segments := segments || jsonb_build_array(jsonb_build_object(
          'exerciseRef', set_row.exercise_ref, 'activity', activity,
          'setId', set_row.id, 'structuralSeconds', strength_seconds,
          'met', met_value, 'rpeSource', set_row.fact_rpe_source));
      end if;
    end loop;
  end if;

  if reason_value is null and confirmed_count = 0 then reason_value := 'no_confirmed_sets'; end if;
  if reason_value is null and app_private.workout_elapsed_is_plausible(elapsed_seconds) then
    if total_work_seconds > elapsed_seconds + 300 then
      reason_value := 'work_exceeds_session';
    elsif total_strength_seconds > 0 then
      scale_factor := least(1, greatest(0,
        (elapsed_seconds - total_work_seconds)::numeric / total_strength_seconds));
      strength_energy := strength_energy * scale_factor;
    end if;
  end if;
  if reason_value is null and total_work_seconds + total_strength_seconds = 0 then
    reason_value := 'missing_work';
  end if;
  if reason_value is null then
    effective_seconds := total_work_seconds + round(total_strength_seconds * scale_factor)::integer;
    estimated_kcal := greatest(5, round((energy + strength_energy) / 5)::integer * 5);
  end if;

  update public.workouts set
    calorie_v2_shadow_kcal = estimated_kcal,
    calorie_v2_shadow_reason = reason_value,
    calorie_v2_shadow_details = jsonb_build_object(
      'version', 2, 'weightKg', weight_kg_value,
      'elapsedSeconds', elapsed_seconds, 'recordedWorkSeconds', total_work_seconds,
      'structuralSeconds', total_strength_seconds,
      'effectiveSeconds', effective_seconds, 'strengthScale', scale_factor,
      'segments', segments),
    calorie_v2_shadow_at = now()
  where id = p_workout_id;
end;
$$;

drop trigger refresh_workout_calories_on_workout on public.workouts;
create trigger refresh_workout_calories_on_workout
after insert or update of status, workout_date, start_time, end_time,
  started_at, completed_at, session_rpe, actual_duration_sec
on public.workouts for each row
execute function app_private.refresh_workout_calories_from_workout();

-- No guessed historical backfill. A fact edit triggers the existing calculation.

-- Down Migration
create or replace function public.save_completed_workout(
  p_workout jsonb, p_expected_version bigint default null
)
returns table (workout_id uuid, version bigint)
language plpgsql security definer set search_path = '' as $$
declare
  saved_workout_id uuid;
  saved_version bigint;
  exercise_item jsonb;
  set_item jsonb;
  was_replayed boolean := false;
begin
  if p_workout->>'id' is null and p_workout->>'requestId' is not null then
    select exists (
      select 1 from app_private.workout_create_requests request
      where request.actor_id = auth.uid()
        and request.request_id = (p_workout->>'requestId')::uuid
        and request.workout_id is not null
    ) into was_replayed;
  end if;

  select saved.workout_id, saved.version into saved_workout_id, saved_version
  from app_private.save_completed_workout_without_metric_sources(p_workout, p_expected_version) saved;

  if was_replayed then
    return query select saved_workout_id, saved_version;
    return;
  end if;

  -- The only authority to call this wrapper is the original lifecycle function.
  -- Match the post-save snapshot by its validated positions; never infer a
  -- historical source from a fact value simply being present.
  for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
    for set_item in select value from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb)) loop
      update public.workout_sets workout_set set
        fact_duration_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'duration',
            case when p_workout->>'id' is null then 'planned' end),
          app_private.canonical_set_duration_seconds(workout_set.fact_duration_sec, workout_set.fact_duration_min),
          app_private.canonical_set_duration_seconds(workout_set.plan_duration_sec, workout_set.plan_duration_min)
        ),
        fact_distance_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'distance',
            case when p_workout->>'id' is null then 'planned' end),
          workout_set.fact_distance_km, workout_set.plan_distance_km
        ),
        fact_rpe_source = app_private.metric_source(
          coalesce(set_item->'metricSources'->>'rpe',
            case when p_workout->>'id' is null then 'planned' end),
          workout_set.fact_rpe, workout_set.plan_rpe
        )
      from public.workout_exercises exercise
      where exercise.id = workout_set.workout_exercise_id
        and exercise.workout_id = saved_workout_id
        and exercise.position = (exercise_item->>'position')::smallint
        and workout_set.position = (set_item->>'position')::smallint
        and workout_set.confirmed_at is not null;
    end loop;
  end loop;

  update public.workout_sets workout_set set
    fact_duration_source = 'unknown', fact_distance_source = 'unknown', fact_rpe_source = 'unknown'
  from public.workout_exercises exercise
  where exercise.id = workout_set.workout_exercise_id
    and exercise.workout_id = saved_workout_id
    and workout_set.confirmed_at is null;

  return query select saved_workout_id, saved_version;
end;
$$;

create or replace function app_private.refresh_workout_calorie_estimate(
  p_workout_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  workout_row public.workouts%rowtype;
  weight_kg_value numeric;
  confirmed_set_count integer := 0;
  duration_set_count integer := 0;
  exercise_count integer := 0;
  recorded_duration_min numeric := 0;
  average_rpe numeric;
  has_circuit boolean := false;
  has_interval boolean := false;
  bodyweight_only boolean := false;
  has_heavy_compound boolean := false;
  raw_duration_min numeric;
  structural_duration_min numeric;
  effective_duration_min numeric;
  met_value numeric;
  calories_value integer;
begin
  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  if workout_row.id is null then
    return;
  end if;

  if workout_row.status <> 'done' then
    if workout_row.active_calories_kcal is not null then
      update public.workouts workout
      set active_calories_kcal = null,
          calorie_estimate_version = null,
          calorie_estimate_weight_kg = null,
          calorie_estimate_duration_min = null,
          calorie_estimated_at = null
      where workout.id = p_workout_id;
    end if;
    return;
  end if;

  select progress.weight_kg into weight_kg_value
  from public.client_progress progress
  where progress.client_id = workout_row.client_id
    and progress.deleted_at is null
    and progress.weight_kg > 0
  order by
    (progress.recorded_on > workout_row.workout_date),
    case
      when progress.recorded_on <= workout_row.workout_date
        then workout_row.workout_date - progress.recorded_on
      else progress.recorded_on - workout_row.workout_date
    end,
    progress.recorded_on desc,
    progress.id desc
  limit 1;

  select
    count(*)::integer,
    count(*) filter (
      where exercise.input_kind in ('duration', 'distance')
        and coalesce(workout_set.fact_duration_min, 0) * 60
          + coalesce(workout_set.fact_duration_sec, 0) > 0
    )::integer,
    count(distinct exercise.id)::integer,
    coalesce(sum(
      coalesce(workout_set.fact_duration_min, 0)
      + coalesce(workout_set.fact_duration_sec, 0) / 60.0
    ), 0),
    avg(coalesce(workout_set.fact_rpe, workout_set.plan_rpe)),
    coalesce(bool_or(exercise.block_preset = 'circuit'), false),
    coalesce(bool_or(exercise.block_preset = 'interval'), false),
    coalesce(bool_and(
      exercise.input_kind = 'reps'
      and coalesce(workout_set.fact_weight_kg, workout_set.plan_weight_kg, 0) = 0
    ), false),
    coalesce(bool_or(
      exercise.exercise_ref ~* '(squat|deadlift|leg[-_ ]?press)'
      or exercise.exercise_name ~* '(присед|станов|жим ногами|squat|deadlift|leg press)'
    ), false)
  into
    confirmed_set_count,
    duration_set_count,
    exercise_count,
    recorded_duration_min,
    average_rpe,
    has_circuit,
    has_interval,
    bodyweight_only,
    has_heavy_compound
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where exercise.workout_id = p_workout_id
    and workout_set.confirmed_at is not null;

  if weight_kg_value is null or confirmed_set_count = 0 then
    update public.workouts workout
    set active_calories_kcal = null,
        calorie_estimate_version = null,
        calorie_estimate_weight_kg = null,
        calorie_estimate_duration_min = null,
        calorie_estimated_at = null
    where workout.id = p_workout_id
      and (
        workout.active_calories_kcal is not null
        or workout.calorie_estimate_version is not null
        or workout.calorie_estimate_weight_kg is not null
        or workout.calorie_estimate_duration_min is not null
        or workout.calorie_estimated_at is not null
      );
    return;
  end if;

  raw_duration_min := case
    when workout_row.started_at is not null
      and workout_row.completed_at is not null
      and workout_row.completed_at > workout_row.started_at
      then extract(epoch from (workout_row.completed_at - workout_row.started_at)) / 60.0
    when workout_row.start_time is not null
      and workout_row.end_time is not null
      and workout_row.end_time > workout_row.start_time
      then extract(epoch from (workout_row.end_time - workout_row.start_time)) / 60.0
    else null
  end;

  -- 3.5 minutes per ordinary strength set includes work and the usual rest.
  -- Recorded cardio/duration sets keep their measured time instead.
  structural_duration_min := recorded_duration_min
    + greatest(confirmed_set_count - duration_set_count, 0) * 3.5
    + exercise_count * 2
    + 5;

  effective_duration_min := least(
    180,
    case
      when raw_duration_min is not null and raw_duration_min >= 5 then
        least(raw_duration_min, greatest(structural_duration_min * 1.25, recorded_duration_min, 10))
      else greatest(structural_duration_min, recorded_duration_min, 10)
    end
  );

  met_value := case
    when has_interval then 6.5
    when has_circuit then 5.8
    when bodyweight_only and coalesce(workout_row.session_rpe, average_rpe, 0) >= 8 then 6.5
    when bodyweight_only then 3.0
    when coalesce(workout_row.session_rpe, average_rpe, 0) >= 8.5 then 6.0
    when has_heavy_compound then 5.0
    else 3.5
  end;

  -- Active energy only: subtract the resting 1 MET before applying the
  -- standard MET formula. Rounded to 5 kcal to avoid false precision.
  calories_value := greatest(5, (
    round((((met_value - 1) * 3.5 * weight_kg_value / 200)
      * effective_duration_min) / 5) * 5
  )::integer);

  update public.workouts workout
  set active_calories_kcal = calories_value,
      calorie_estimate_version = 1,
      calorie_estimate_weight_kg = weight_kg_value,
      calorie_estimate_duration_min = round(effective_duration_min, 1),
      calorie_estimated_at = now()
  where workout.id = p_workout_id
    and (
      workout.active_calories_kcal is distinct from calories_value
      or workout.calorie_estimate_version is distinct from 1
      or workout.calorie_estimate_weight_kg is distinct from weight_kg_value
      or workout.calorie_estimate_duration_min is distinct from round(effective_duration_min, 1)
    );
end;
$$;

create or replace function app_private.refresh_workout_calorie_shadow_v2(p_workout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  workout_row public.workouts%rowtype;
  weight_kg_value numeric;
  elapsed_seconds integer;
  set_row record;
  activity text;
  work_seconds integer;
  total_work_seconds integer := 0;
  total_strength_seconds integer := 0;
  strength_seconds integer;
  effective_seconds integer;
  speed_kmh numeric;
  met_value numeric;
  energy numeric := 0;
  strength_energy numeric := 0;
  scale_factor numeric := 1;
  estimated_kcal integer;
  reason_value text;
  segments jsonb := '[]'::jsonb;
  confirmed_count integer := 0;
begin
  select * into workout_row from public.workouts
  where id = p_workout_id and deleted_at is null;
  if workout_row.id is null then return; end if;

  if workout_row.status <> 'done' then
    reason_value := 'not_completed';
  else
    weight_kg_value := app_private.workout_weight_on_date(
      workout_row.client_id, workout_row.workout_date);
    elapsed_seconds := app_private.workout_elapsed_seconds(
      workout_row.started_at, workout_row.completed_at,
      workout_row.start_time, workout_row.end_time);
    if weight_kg_value is null then reason_value := 'missing_weight'; end if;
  end if;

  if reason_value is null then
    for set_row in
      select exercise.exercise_ref, exercise.exercise_source, exercise.muscle_group,
        exercise.block_preset, workout_set.id,
        workout_set.fact_duration_source, workout_set.fact_distance_source,
        workout_set.fact_rpe_source, workout_set.fact_distance_km,
        workout_set.fact_rpe, workout_set.fact_weight_kg,
        app_private.canonical_set_duration_seconds(
          workout_set.fact_duration_sec, workout_set.fact_duration_min) as duration_seconds,
        app_private.set_duration_is_consistent(
          workout_set.fact_duration_sec, workout_set.fact_duration_min) as duration_consistent
      from public.workout_exercises exercise
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      where exercise.workout_id = p_workout_id
        and workout_set.confirmed_at is not null
      order by exercise.position, workout_set.position
    loop
      confirmed_count := confirmed_count + 1;
      activity := app_private.calorie_v2_activity(
        set_row.exercise_source, set_row.exercise_ref,
        set_row.muscle_group, set_row.block_preset);
      if not set_row.duration_consistent then
        reason_value := 'contradictory_duration'; exit;
      end if;
      work_seconds := case when set_row.fact_duration_source = 'entered'
        then set_row.duration_seconds end;
      if activity not in ('strength', 'strength-heavy', 'strength-circuit') then
        if work_seconds is null or work_seconds <= 0 then
          reason_value := 'missing_activity_duration'; exit;
        end if;
        if work_seconds > 21600 then
          reason_value := 'implausible_activity_duration'; exit;
        end if;
        total_work_seconds := total_work_seconds + work_seconds;
        speed_kmh := null;
        if set_row.fact_distance_source = 'entered'
          and set_row.fact_distance_km > 0
          and activity in ('running', 'walking', 'interval-walking',
            'rowing-machine', 'interval-rowing') then
          speed_kmh := set_row.fact_distance_km * 3600 / work_seconds;
          if (activity = 'running' and speed_kmh not between 5 and 25)
            or (activity in ('walking', 'interval-walking') and speed_kmh not between 1 and 9)
            or (activity in ('rowing-machine', 'interval-rowing') and speed_kmh not between 3 and 20) then
            speed_kmh := null;
          end if;
        end if;
        met_value := app_private.calorie_v2_met(activity, speed_kmh,
          case when set_row.fact_rpe_source = 'entered' then set_row.fact_rpe end);
        energy := energy + (met_value - 1) * 3.5 * weight_kg_value / 200 * work_seconds / 60;
        segments := segments || jsonb_build_array(jsonb_build_object(
          'exerciseRef', set_row.exercise_ref, 'activity', activity,
          'setId', set_row.id, 'workSeconds', work_seconds,
          'distanceKm', case when set_row.fact_distance_source = 'entered'
            then set_row.fact_distance_km end,
          'speedKmh', case when speed_kmh is not null then round(speed_kmh, 2) end,
          'met', met_value, 'durationSource', set_row.fact_duration_source,
          'distanceSource', set_row.fact_distance_source,
          'rpeSource', set_row.fact_rpe_source));
      else
        -- A strength set includes limited ordinary rest; no cardio is inferred
        -- from the remaining wall-clock session time.
        strength_seconds := coalesce(work_seconds,
          case when set_row.fact_weight_kg > 0 then 180 else 150 end);
        strength_seconds := least(strength_seconds, 300);
        total_strength_seconds := total_strength_seconds + strength_seconds;
        met_value := app_private.calorie_v2_met(activity, null,
          case when set_row.fact_rpe_source = 'entered' then set_row.fact_rpe end);
        strength_energy := strength_energy
          + (met_value - 1) * 3.5 * weight_kg_value / 200 * strength_seconds / 60;
        segments := segments || jsonb_build_array(jsonb_build_object(
          'exerciseRef', set_row.exercise_ref, 'activity', activity,
          'setId', set_row.id, 'structuralSeconds', strength_seconds,
          'met', met_value, 'rpeSource', set_row.fact_rpe_source));
      end if;
    end loop;
  end if;

  if reason_value is null and confirmed_count = 0 then reason_value := 'no_confirmed_sets'; end if;
  if reason_value is null and app_private.workout_elapsed_is_plausible(elapsed_seconds) then
    if total_work_seconds > elapsed_seconds + 300 then
      reason_value := 'work_exceeds_session';
    elsif total_strength_seconds > 0 then
      scale_factor := least(1, greatest(0,
        (elapsed_seconds - total_work_seconds)::numeric / total_strength_seconds));
      strength_energy := strength_energy * scale_factor;
    end if;
  end if;
  if reason_value is null and total_work_seconds + total_strength_seconds = 0 then
    reason_value := 'missing_work';
  end if;
  if reason_value is null then
    effective_seconds := total_work_seconds + round(total_strength_seconds * scale_factor)::integer;
    estimated_kcal := greatest(5, round((energy + strength_energy) / 5)::integer * 5);
  end if;

  update public.workouts set
    calorie_v2_shadow_kcal = estimated_kcal,
    calorie_v2_shadow_reason = reason_value,
    calorie_v2_shadow_details = jsonb_build_object(
      'version', 2, 'weightKg', weight_kg_value,
      'elapsedSeconds', elapsed_seconds, 'recordedWorkSeconds', total_work_seconds,
      'structuralSeconds', total_strength_seconds,
      'effectiveSeconds', effective_seconds, 'strengthScale', scale_factor,
      'segments', segments),
    calorie_v2_shadow_at = now()
  where id = p_workout_id;
end;
$$;

drop trigger refresh_workout_calories_on_workout on public.workouts;
create trigger refresh_workout_calories_on_workout
after insert or update of status, workout_date, start_time, end_time,
  started_at, completed_at, session_rpe
on public.workouts for each row
execute function app_private.refresh_workout_calories_from_workout();
alter table public.workouts drop column actual_duration_sec;
