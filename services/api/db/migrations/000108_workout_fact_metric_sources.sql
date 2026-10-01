-- Up Migration

-- Historical fact columns do not prove that a person entered a measurement:
-- confirmation and quick completion have always copied planned values here.
alter table public.workout_sets
  add column fact_duration_source text not null default 'unknown',
  add column fact_distance_source text not null default 'unknown',
  add column fact_rpe_source text not null default 'unknown',
  add constraint workout_sets_duration_source_valid check (fact_duration_source in ('unknown', 'planned', 'entered')),
  add constraint workout_sets_distance_source_valid check (fact_distance_source in ('unknown', 'planned', 'entered')),
  add constraint workout_sets_rpe_source_valid check (fact_rpe_source in ('unknown', 'planned', 'entered'));

create function app_private.canonical_set_duration_seconds(p_seconds integer, p_minutes numeric)
returns integer language sql immutable set search_path = '' as $$
  select coalesce(p_seconds, round(p_minutes * 60)::integer)
$$;

create function app_private.set_duration_is_consistent(p_seconds integer, p_minutes numeric)
returns boolean language sql immutable set search_path = '' as $$
  select p_seconds is null or p_minutes is null
    or abs(p_seconds - round(p_minutes * 60)::integer) <= 1
$$;

create function app_private.workout_elapsed_seconds(
  p_started_at timestamptz, p_completed_at timestamptz,
  p_start_time time, p_end_time time
)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_started_at is not null and p_completed_at is not null
      then case when p_completed_at > p_started_at
        then extract(epoch from (p_completed_at - p_started_at))::integer end
    when p_start_time is not null and p_end_time is not null
      then extract(epoch from (
        case when p_end_time > p_start_time then p_end_time - p_start_time
          else interval '24 hours' + (p_end_time - p_start_time) end
      ))::integer
  end
$$;

-- A missing or contradictory clock is not silently capped at three hours.
create function app_private.workout_elapsed_is_plausible(p_seconds integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_seconds is not null and p_seconds between 60 and 43200
$$;

create function app_private.workout_time_quality(p_elapsed_seconds integer, p_work_seconds integer)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_elapsed_seconds is null then 'missing_total'
    when not app_private.workout_elapsed_is_plausible(p_elapsed_seconds) then 'implausible_total'
    when p_work_seconds is null or p_work_seconds <= 0 then 'missing_work'
    when p_work_seconds > p_elapsed_seconds + 300 then 'contradictory'
    else 'consistent'
  end
$$;

-- A later measurement is not evidence of body mass on an earlier workout.
create function app_private.workout_weight_on_date(p_client_id uuid, p_workout_date date)
returns numeric language sql stable set search_path = '' as $$
  select progress.weight_kg
  from public.client_progress progress
  where progress.client_id = p_client_id
    and progress.deleted_at is null
    and progress.weight_kg > 0
    and progress.recorded_on <= p_workout_date
  order by progress.recorded_on desc, progress.id desc
  limit 1
$$;

create function app_private.metric_source(
  p_requested text, p_actual numeric, p_planned numeric
)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_actual is null then 'unknown'
    when p_requested = 'entered' then 'entered'
    when p_requested = 'planned' and p_actual = p_planned then 'planned'
    else 'unknown'
  end
$$;

revoke all on function app_private.canonical_set_duration_seconds(integer, numeric) from public;
revoke all on function app_private.set_duration_is_consistent(integer, numeric) from public;
revoke all on function app_private.workout_elapsed_seconds(timestamptz, timestamptz, time, time) from public;
revoke all on function app_private.workout_elapsed_is_plausible(integer) from public;
revoke all on function app_private.workout_time_quality(integer, integer) from public;
revoke all on function app_private.workout_weight_on_date(uuid, date) from public;
revoke all on function app_private.metric_source(text, numeric, numeric) from public;

alter function public.save_live_set_draft(uuid, jsonb, bigint, uuid)
  rename to save_live_set_draft_without_metric_sources;
alter function public.save_live_set_draft_without_metric_sources(uuid, jsonb, bigint, uuid)
  set schema app_private;
revoke all on function app_private.save_live_set_draft_without_metric_sources(uuid, jsonb, bigint, uuid) from public, fit_api;

create function public.save_live_set_draft(
  p_set_id uuid, p_draft jsonb, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  saved_version bigint;
  was_replayed boolean;
begin
  select saved.version, saved.replayed into saved_version, was_replayed
  from app_private.save_live_set_draft_without_metric_sources(
    p_set_id, p_draft, p_expected_version, p_operation_id
  ) saved;

  if was_replayed then
    return query select saved_version, true;
    return;
  end if;

  update public.workout_sets workout_set set
    fact_duration_source = app_private.metric_source(
      p_draft->'metricSources'->>'duration',
      app_private.canonical_set_duration_seconds(workout_set.fact_duration_sec, workout_set.fact_duration_min),
      app_private.canonical_set_duration_seconds(workout_set.plan_duration_sec, workout_set.plan_duration_min)
    ),
    fact_distance_source = app_private.metric_source(
      p_draft->'metricSources'->>'distance', workout_set.fact_distance_km, workout_set.plan_distance_km
    ),
    fact_rpe_source = app_private.metric_source(
      p_draft->'metricSources'->>'rpe', workout_set.fact_rpe, workout_set.plan_rpe
    )
  where workout_set.id = p_set_id;
  return query select saved_version, false;
end;
$$;
revoke all on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) from public;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) to fit_api;

alter function public.confirm_live_set(uuid, bigint, uuid)
  rename to confirm_live_set_without_metric_sources;
alter function public.confirm_live_set_without_metric_sources(uuid, bigint, uuid)
  set schema app_private;
revoke all on function app_private.confirm_live_set_without_metric_sources(uuid, bigint, uuid) from public, fit_api;

create function public.confirm_live_set(
  p_set_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  previous_duration numeric;
  previous_distance numeric;
  previous_rpe numeric;
  saved_version bigint;
  was_replayed boolean;
begin
  select app_private.canonical_set_duration_seconds(fact_duration_sec, fact_duration_min),
    fact_distance_km, fact_rpe
  into previous_duration, previous_distance, previous_rpe
  from public.workout_sets where id = p_set_id;

  select saved.version, saved.replayed into saved_version, was_replayed
  from app_private.confirm_live_set_without_metric_sources(
    p_set_id, p_expected_version, p_operation_id
  ) saved;

  if was_replayed then
    return query select saved_version, true;
    return;
  end if;

  update public.workout_sets workout_set set
    fact_duration_source = case when previous_duration is null
      then app_private.metric_source('planned',
        app_private.canonical_set_duration_seconds(workout_set.fact_duration_sec, workout_set.fact_duration_min),
        app_private.canonical_set_duration_seconds(workout_set.plan_duration_sec, workout_set.plan_duration_min))
      else workout_set.fact_duration_source end,
    fact_distance_source = case when previous_distance is null
      then app_private.metric_source('planned', workout_set.fact_distance_km, workout_set.plan_distance_km)
      else workout_set.fact_distance_source end,
    fact_rpe_source = case when previous_rpe is null
      then app_private.metric_source('planned', workout_set.fact_rpe, workout_set.plan_rpe)
      else workout_set.fact_rpe_source end
  where workout_set.id = p_set_id;
  return query select saved_version, false;
end;
$$;
revoke all on function public.confirm_live_set(uuid, bigint, uuid) from public;
grant execute on function public.confirm_live_set(uuid, bigint, uuid) to fit_api;

alter function public.save_completed_workout(jsonb, bigint)
  rename to save_completed_workout_without_metric_sources;
alter function public.save_completed_workout_without_metric_sources(jsonb, bigint)
  set schema app_private;
revoke all on function app_private.save_completed_workout_without_metric_sources(jsonb, bigint) from public, fit_api;

create function public.save_completed_workout(
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
revoke all on function public.save_completed_workout(jsonb, bigint) from public;
grant execute on function public.save_completed_workout(jsonb, bigint) to fit_api;

-- Down Migration
drop function public.save_completed_workout(jsonb, bigint);
alter function app_private.save_completed_workout_without_metric_sources(jsonb, bigint) set schema public;
alter function public.save_completed_workout_without_metric_sources(jsonb, bigint) rename to save_completed_workout;
grant execute on function public.save_completed_workout(jsonb, bigint) to fit_api;

drop function public.confirm_live_set(uuid, bigint, uuid);
alter function app_private.confirm_live_set_without_metric_sources(uuid, bigint, uuid) set schema public;
alter function public.confirm_live_set_without_metric_sources(uuid, bigint, uuid) rename to confirm_live_set;
grant execute on function public.confirm_live_set(uuid, bigint, uuid) to fit_api;

drop function public.save_live_set_draft(uuid, jsonb, bigint, uuid);
alter function app_private.save_live_set_draft_without_metric_sources(uuid, jsonb, bigint, uuid) set schema public;
alter function public.save_live_set_draft_without_metric_sources(uuid, jsonb, bigint, uuid) rename to save_live_set_draft;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid) to fit_api;

drop function app_private.metric_source(text, numeric, numeric);
drop function app_private.workout_time_quality(integer, integer);
drop function app_private.workout_elapsed_is_plausible(integer);
drop function app_private.workout_weight_on_date(uuid, date);
drop function app_private.workout_elapsed_seconds(timestamptz, timestamptz, time, time);
drop function app_private.set_duration_is_consistent(integer, numeric);
drop function app_private.canonical_set_duration_seconds(integer, numeric);
alter table public.workout_sets
  drop constraint workout_sets_rpe_source_valid,
  drop constraint workout_sets_distance_source_valid,
  drop constraint workout_sets_duration_source_valid,
  drop column fact_rpe_source,
  drop column fact_distance_source,
  drop column fact_duration_source;
