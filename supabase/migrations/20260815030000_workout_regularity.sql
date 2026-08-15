-- YAFIT-286: один серверный источник weekly/monthly regularity для обеих ролей.
-- Периоды считаются в timezone клиента (fallback: root trainer, затем Moscow),
-- поэтому trainer и client видят одинаковые границы и числа.

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
    select 'week'::text as kind, week_start as starts_on, week_start + 6 as ends_on, 1 as position
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
      count(workout_set.id) filter (where workout_set.confirmed_at is not null)::integer as confirmed_sets
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
          and (fact.total_sets = 0 or fact.confirmed_sets = fact.total_sets)
      )::integer as completed,
      count(fact.id) filter (
        where not fact.client_authored
          and fact.status = 'done'
          and (fact.total_sets = 0 or fact.confirmed_sets = fact.total_sets)
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
      else round(aggregates.completed_planned * 100.0 / aggregates.planned)::integer
    end
  from aggregates
  order by aggregates.position;
end;
$$;

comment on function public.get_workout_regularity(uuid, timestamptz) is
  'Deterministic current week/month plan completion in the client timezone. Completed includes client-authored workouts; plan percentage uses trainer-authored workouts only.';

revoke all on function public.get_workout_regularity(uuid, timestamptz) from public, anon;
grant execute on function public.get_workout_regularity(uuid, timestamptz) to authenticated;
