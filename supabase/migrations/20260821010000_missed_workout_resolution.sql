-- YAFIT-332: a past plan can be resolved without pretending that it was
-- completed or deleting the trainer's prescription.

alter table public.workouts drop constraint workouts_status_allowed;
alter table public.workouts add constraint workouts_status_allowed
  check (status in ('planned', 'in_progress', 'done', 'cancelled'));

alter table public.workouts drop constraint workouts_status_timestamps;
alter table public.workouts add constraint workouts_status_timestamps check (
  (status in ('planned', 'cancelled') and started_at is null and completed_at is null)
  or (status = 'in_progress' and started_at is not null and completed_at is null)
  or (status = 'done' and completed_at is not null)
);

create or replace function public.cancel_planned_workout(
  p_workout_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  root_trainer_id uuid;
  client_timezone text;
  today_value date;
  next_version bigint;
begin
  root_trainer_id := public.authorize_workout_mutation(p_workout_id, true);

  select coalesce(
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone where zone.name = client_profile.timezone
    ) then client_profile.timezone end,
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone where zone.name = trainer_profile.timezone
    ) then trainer_profile.timezone end,
    'Europe/Moscow'
  )
  into client_timezone
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  today_value := (now() at time zone client_timezone)::date;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.trainer_id = root_trainer_id
      and workout.deleted_at is null
      and workout.status = 'planned'
      and workout.workout_date < today_value
  ) then
    raise exception 'workout_not_resolvable' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set status = 'cancelled',
      started_at = null,
      completed_at = null,
      updated_by = actor_id,
      version = workout.version + 1,
      updated_at = now()
  where workout.id = p_workout_id
    and workout.trainer_id = root_trainer_id
    and workout.status = 'planned'
    and workout.workout_date < today_value
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.reschedule_workout(
  p_workout_id uuid,
  p_workout_date date,
  p_start_time time,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  root_trainer_id uuid;
  client_timezone text;
  today_value date;
  next_version bigint;
begin
  root_trainer_id := public.authorize_workout_mutation(p_workout_id, true);

  select coalesce(
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone where zone.name = client_profile.timezone
    ) then client_profile.timezone end,
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone where zone.name = trainer_profile.timezone
    ) then trainer_profile.timezone end,
    'Europe/Moscow'
  )
  into client_timezone
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  today_value := (now() at time zone client_timezone)::date;
  if p_workout_date is null or p_workout_date < today_value then
    raise exception 'workout_date_in_past' using errcode = 'PT422';
  end if;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.trainer_id = root_trainer_id
      and workout.deleted_at is null
      and (
        workout.status = 'cancelled'
        or (workout.status = 'planned' and workout.workout_date < today_value)
      )
  ) then
    raise exception 'workout_not_resolvable' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set workout_date = p_workout_date,
      start_time = p_start_time,
      end_time = null,
      status = 'planned',
      started_at = null,
      completed_at = null,
      updated_by = actor_id,
      version = workout.version + 1,
      updated_at = now()
  where workout.id = p_workout_id
    and workout.trainer_id = root_trainer_id
    and workout.deleted_at is null
    and workout.version = p_expected_version
    and (
      workout.status = 'cancelled'
      or (workout.status = 'planned' and workout.workout_date < today_value)
    )
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

revoke all on function public.cancel_planned_workout(uuid, bigint) from public, anon;
revoke all on function public.reschedule_workout(uuid, date, time, bigint) from public, anon;
grant execute on function public.cancel_planned_workout(uuid, bigint) to authenticated;
grant execute on function public.reschedule_workout(uuid, date, time, bigint) to authenticated;

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

  select client.auth_user_id, client.trainer_id,
    coalesce(
      case when exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = client_profile.timezone) then client_profile.timezone end,
      case when exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = trainer_profile.timezone) then trainer_profile.timezone end,
      'Europe/Moscow'
    )
  into client_auth_user_id, root_trainer_id, client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id and client.archived_at is null;

  if root_trainer_id is null or not (
    actor_id = root_trainer_id or actor_id = client_auth_user_id
    or exists (select 1 from public.client_trainers membership where membership.client_id = p_client_id and membership.trainer_id = actor_id)
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
    select 'month'::text, month_start, (month_start + interval '1 month - 1 day')::date, 2
  ),
  workout_facts as (
    select workout.id, workout.workout_date, workout.status,
      client_auth_user_id is not null and workout.created_by = client_auth_user_id as client_authored,
      count(workout_set.id)::integer as total_sets,
      count(workout_set.id) filter (where workout_set.confirmed_at is not null)::integer as confirmed_sets
    from public.workouts workout
    left join public.workout_exercises exercise on exercise.workout_id = workout.id and exercise.trainer_id = workout.trainer_id and exercise.client_id = workout.client_id
    left join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id and workout_set.trainer_id = exercise.trainer_id and workout_set.client_id = exercise.client_id
    where workout.client_id = p_client_id
      and workout.deleted_at is null
      and workout.workout_date >= least(week_start, month_start)
      and workout.workout_date <= greatest(week_start + 6, (month_start + interval '1 month - 1 day')::date)
    group by workout.id, workout.workout_date, workout.status, workout.created_by
  ),
  aggregates as (
    select periods.kind, periods.starts_on, periods.ends_on, periods.position,
      count(fact.id) filter (where not fact.client_authored)::integer as planned,
      count(fact.id) filter (where fact.status = 'done')::integer as completed,
      count(fact.id) filter (where not fact.client_authored and fact.status = 'done')::integer as completed_planned,
      count(fact.id) filter (where fact.status = 'done' and fact.total_sets > 0 and fact.confirmed_sets > 0 and fact.confirmed_sets < fact.total_sets)::integer as partial,
      count(fact.id) filter (
        where not fact.client_authored and (
          fact.status = 'cancelled'
          or (fact.status = 'planned' and fact.workout_date < today_value)
        )
      )::integer as skipped
    from periods
    left join workout_facts fact on fact.workout_date between periods.starts_on and periods.ends_on
    group by periods.kind, periods.starts_on, periods.ends_on, periods.position
  )
  select aggregates.kind, aggregates.starts_on, aggregates.ends_on, aggregates.planned,
    aggregates.completed, aggregates.completed_planned, aggregates.partial, aggregates.skipped,
    case when aggregates.planned = 0 then null else round(aggregates.completed_planned * 100.0 / aggregates.planned)::integer end
  from aggregates order by aggregates.position;
end;
$$;

comment on function public.cancel_planned_workout(uuid, bigint) is
  'Resolve a past plan as not occurred without deleting it or creating workout facts.';
comment on function public.reschedule_workout(uuid, date, time, bigint) is
  'Move a past or cancelled plan without granting access to edit its contents.';
comment on function public.get_workout_regularity(uuid, timestamptz) is
  'Current week/month workout attendance in client timezone. Done workouts count as attendance; cancelled and unresolved past trainer plans remain separate.';
