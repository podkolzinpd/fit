-- Up Migration
-- Extend the existing trainer cancellation, keeping plans and recorded facts.
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
  client_timezone text;
  trainer_actor boolean;
  today_value date;
  next_version bigint;
begin
  select account_role='trainer' into trainer_actor from public.profiles where id=actor_id;
  perform 1
  from app_private.authorize_workout_lifecycle(p_workout_id, not coalesce(trainer_actor, false));

  select coalesce(
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
  into client_timezone
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.profiles client_profile
    on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile
    on trainer_profile.id = client.trainer_id
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  today_value := (now() at time zone client_timezone)::date;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and (workout.status = 'planned' or (trainer_actor and workout.status = 'in_progress'))
      and (trainer_actor or workout.workout_date < today_value)
  ) then
    raise exception 'workout_not_resolvable' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    status = 'cancelled',
    started_at = null,
    paused_seconds = coalesce(workout.paused_seconds,0) + case when workout.paused_at is not null then greatest(0,floor(extract(epoch from (now()-workout.paused_at)))::integer) else 0 end,
    paused_at = null,
    completed_at = null,
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and (workout.status = 'planned' or (trainer_actor and workout.status = 'in_progress'))
    and (trainer_actor or workout.workout_date < today_value)
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

-- Down Migration
-- Forward-only; cancelled records and their data must be preserved.
