-- Up Migration

-- Shadow values are intentionally separate from the published v1 estimate.
alter table public.workouts
  add column calorie_v2_shadow_kcal integer,
  add column calorie_v2_shadow_reason text,
  add column calorie_v2_shadow_details jsonb,
  add column calorie_v2_shadow_at timestamptz,
  add constraint workouts_calorie_v2_shadow_positive
    check (calorie_v2_shadow_kcal is null or calorie_v2_shadow_kcal > 0);

create function app_private.calorie_v2_activity(
  p_source text, p_ref text, p_group text, p_preset text
)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_source = 'system' and p_ref in ('running', 'walking', 'interval-walking',
      'stationary-bike', 'interval-bike', 'elliptical', 'rowing-machine', 'interval-rowing',
      'jump-rope', 'burpees', 'tabata', 'emom', 'amrap', 'circuit-training',
      'farmer-carry', 'sled-push') then p_ref
    when p_source = 'system' and p_ref like 'running-%' then 'running-drill'
    when p_group = 'cardio' then 'unknown-cardio'
    when p_ref ~* '(stretch|yoga|mobility|warm[-_ ]?up|cool[-_ ]?down)'
      then 'recovery'
    when p_preset in ('circuit', 'interval') then 'strength-circuit'
    when p_source = 'system' and p_ref ~* '(squat|deadlift|leg[-_]?press)'
      then 'strength-heavy'
    else 'strength'
  end
$$;
revoke all on function app_private.calorie_v2_activity(text, text, text, text) from public;

-- A measured pace can select a published MET band; an absent or implausible
-- pace does not manufacture one. Cycling distance has no intensity meaning.
create function app_private.calorie_v2_met(
  p_activity text, p_speed_kmh numeric, p_rpe numeric
)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  base_met numeric;
begin
  base_met := case
    when p_activity = 'running' then case
      when p_speed_kmh between 7 and 8.4 then 8.5
      when p_speed_kmh between 8.4 and 10.4 then 9.3
      when p_speed_kmh between 10.4 and 11.5 then 10.5
      when p_speed_kmh between 11.5 and 14 then 11.0
      else 8.5 end
    when p_activity in ('walking', 'interval-walking') then case
      when p_speed_kmh between 1 and 3.9 then 2.3
      when p_speed_kmh between 3.9 and 4.5 then 3.0
      when p_speed_kmh between 4.5 and 5.6 then 3.8
      when p_speed_kmh between 5.6 and 6.4 then 4.8
      when p_speed_kmh between 6.4 and 8 then 5.5
      else 3.0 end
    when p_activity = 'stationary-bike' then 6.8
    when p_activity = 'interval-bike' then 8.8
    when p_activity = 'elliptical' then 5.0
    when p_activity in ('rowing-machine', 'interval-rowing') then
      case when p_speed_kmh between 8 and 15 then 7.3 else 5.0 end
    when p_activity = 'jump-rope' then 11.0
    when p_activity in ('tabata', 'emom', 'amrap', 'circuit-training', 'burpees') then 5.8
    when p_activity in ('farmer-carry', 'sled-push', 'running-drill') then 5.0
    when p_activity = 'unknown-cardio' then 4.0
    when p_activity = 'recovery' then 2.3
    when p_activity = 'strength-circuit' then 5.0
    when p_activity = 'strength-heavy' then
      case when p_rpe >= 8 then 5.0 else 3.5 end
    else 3.5
  end;
  -- RPE is subjective, so even an entered value makes only a small adjustment.
  return round(base_met * case
    when p_rpe >= 8.5 then 1.08
    when p_rpe <= 6.5 then 0.92
    else 1 end, 2);
end;
$$;
revoke all on function app_private.calorie_v2_met(text, numeric, numeric) from public;

create function app_private.refresh_workout_calorie_shadow_v2(p_workout_id uuid)
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
revoke all on function app_private.refresh_workout_calorie_shadow_v2(uuid) from public;

-- Reuse the existing calorie refresh triggers. Source-only changes in the
-- provenance wrappers must also refresh the shadow after their final update.
create or replace function app_private.refresh_workout_calories_from_workout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.refresh_workout_calorie_estimate(new.id);
  perform app_private.refresh_workout_calorie_shadow_v2(new.id);
  return new;
end;
$$;
create or replace function app_private.refresh_workout_calories_from_set()
returns trigger language plpgsql security definer set search_path = '' as $$
declare workout_id_value uuid;
begin
  select exercise.workout_id into workout_id_value from public.workout_exercises exercise
  where exercise.id = case when tg_op = 'DELETE' then old.workout_exercise_id
    else new.workout_exercise_id end;
  if workout_id_value is not null then
    perform app_private.refresh_workout_calorie_estimate(workout_id_value);
    perform app_private.refresh_workout_calorie_shadow_v2(workout_id_value);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create or replace function app_private.refresh_workout_calories_from_exercise()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.refresh_workout_calorie_estimate(
    case when tg_op = 'DELETE' then old.workout_id else new.workout_id end);
  perform app_private.refresh_workout_calorie_shadow_v2(
    case when tg_op = 'DELETE' then old.workout_id else new.workout_id end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger refresh_workout_calories_on_set on public.workout_sets;
create trigger refresh_workout_calories_on_set
after insert or update of fact_weight_kg, fact_reps, fact_duration_min,
  fact_duration_sec, fact_distance_km, fact_rpe, fact_duration_source,
  fact_distance_source, fact_rpe_source, confirmed_at or delete
on public.workout_sets for each row
execute function app_private.refresh_workout_calories_from_set();

-- No historical backfill: unknown-source records remain untouched.

-- Down Migration
drop trigger refresh_workout_calories_on_set on public.workout_sets;
create trigger refresh_workout_calories_on_set
after insert or update of fact_weight_kg, fact_reps, fact_duration_min,
  fact_duration_sec, fact_distance_km, fact_rpe, confirmed_at or delete
on public.workout_sets for each row
execute function app_private.refresh_workout_calories_from_set();

create or replace function app_private.refresh_workout_calories_from_workout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.refresh_workout_calorie_estimate(new.id);
  return new;
end;
$$;
create or replace function app_private.refresh_workout_calories_from_set()
returns trigger language plpgsql security definer set search_path = '' as $$
declare workout_id_value uuid;
begin
  select exercise.workout_id into workout_id_value from public.workout_exercises exercise
  where exercise.id = case when tg_op = 'DELETE' then old.workout_exercise_id
    else new.workout_exercise_id end;
  if workout_id_value is not null then
    perform app_private.refresh_workout_calorie_estimate(workout_id_value);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create or replace function app_private.refresh_workout_calories_from_exercise()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.refresh_workout_calorie_estimate(
    case when tg_op = 'DELETE' then old.workout_id else new.workout_id end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop function app_private.refresh_workout_calorie_shadow_v2(uuid);
drop function app_private.calorie_v2_met(text, numeric, numeric);
drop function app_private.calorie_v2_activity(text, text, text, text);
alter table public.workouts
  drop constraint workouts_calorie_v2_shadow_positive,
  drop column calorie_v2_shadow_at,
  drop column calorie_v2_shadow_details,
  drop column calorie_v2_shadow_reason,
  drop column calorie_v2_shadow_kcal;
