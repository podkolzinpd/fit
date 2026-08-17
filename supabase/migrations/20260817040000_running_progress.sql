-- YAFIT-302: беговой прогресс строится только по подтверждённому факту.
-- Один workout считается одной пробежкой, даже если интервалы хранятся
-- несколькими running-упражнениями. Формат нужен клиенту для честного
-- сопоставления темпа, но все варианты остаются в одном running-семействе.

create or replace function public.list_running_progress(
  p_client_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  workout_id uuid,
  workout_date date,
  running_format text,
  distance_km numeric,
  duration_sec integer,
  pace_sec_per_km numeric,
  rpe numeric
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
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid_period' using errcode = '22007';
  end if;
  if not public.can_access_client(p_client_id) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;

  return query
  with confirmed_running as (
    select
      workout.id as source_workout_id,
      workout.workout_date as source_workout_date,
      workout.session_rpe,
      exercise.exercise_name,
      exercise.block_preset,
      workout_set.fact_distance_km,
      coalesce(
        workout_set.fact_duration_sec,
        round(workout_set.fact_duration_min * 60)::integer
      ) as fact_duration_sec,
      workout_set.fact_rpe
    from public.workouts workout
    join public.workout_exercises exercise
      on exercise.workout_id = workout.id
      and exercise.client_id = workout.client_id
    join public.workout_sets workout_set
      on workout_set.workout_exercise_id = exercise.id
      and workout_set.client_id = exercise.client_id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id
      and workout.status = 'done'
      and workout.deleted_at is null
      and workout.workout_date between p_period_start and p_period_end
      and exercise.exercise_ref = 'running'
  ),
  normalized as (
    select
      confirmed_running.*,
      case
        when confirmed_running.block_preset = 'interval'
          and lower(confirmed_running.exercise_name) like '%восстанов%'
          then 'interval_active'
        when confirmed_running.block_preset = 'interval' then 'interval'
        when lower(confirmed_running.exercise_name) like 'лёгк%'
          or lower(confirmed_running.exercise_name) like 'легк%' then 'easy'
        when lower(confirmed_running.exercise_name) like 'длительн%' then 'long'
        when lower(confirmed_running.exercise_name) like 'темпов%' then 'tempo'
        when lower(confirmed_running.exercise_name) like 'восстановительн%' then 'recovery'
        else 'free'
      end as format_key
    from confirmed_running
  ),
  sessions as (
    select
      normalized.source_workout_id,
      normalized.source_workout_date,
      case
        when bool_or(normalized.format_key = 'interval_active') then 'interval_active'
        when bool_or(normalized.format_key = 'interval') then 'interval'
        when count(distinct normalized.format_key) = 1 then min(normalized.format_key)
        else 'mixed'
      end as session_format,
      sum(normalized.fact_distance_km) filter (
        where normalized.fact_distance_km is not null
      ) as session_distance_km,
      sum(normalized.fact_duration_sec) filter (
        where normalized.fact_duration_sec is not null
      )::integer as session_duration_sec,
      coalesce(
        round(avg(normalized.fact_rpe) filter (
          where normalized.fact_rpe is not null
        ), 1),
        max(normalized.session_rpe)::numeric
      ) as session_rpe
    from normalized
    group by normalized.source_workout_id, normalized.source_workout_date
  )
  select
    sessions.source_workout_id,
    sessions.source_workout_date,
    sessions.session_format,
    sessions.session_distance_km,
    sessions.session_duration_sec,
    case
      when sessions.session_distance_km > 0 and sessions.session_duration_sec > 0
        then round(sessions.session_duration_sec / sessions.session_distance_km, 1)
      else null
    end,
    sessions.session_rpe
  from sessions
  order by sessions.source_workout_date, sessions.source_workout_id;
end;
$$;

comment on function public.list_running_progress(uuid, date, date) is
  'Confirmed running sessions for a client. Aggregates interval exercises by workout and exposes a format key for comparable pace analysis.';

revoke all on function public.list_running_progress(uuid, date, date) from public, anon;
grant execute on function public.list_running_progress(uuid, date, date) to authenticated;
