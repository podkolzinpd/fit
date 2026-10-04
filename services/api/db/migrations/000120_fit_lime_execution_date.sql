-- Up Migration

-- New pilot executions only. Existing history is deliberately not backfilled.
alter table public.workouts
  add column planned_date date,
  add column planned_start_time time,
  add column planned_end_time time;

create function app_private.workout_client_local_time(p_client_id uuid, p_at timestamptz)
returns timestamp
language plpgsql stable security definer set search_path = ''
as $$
declare client_timezone text;
begin
  select coalesce(client_profile.timezone, trainer_profile.timezone, 'Europe/Moscow')
    into client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id;
  if not exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = client_timezone)
    then client_timezone := 'Europe/Moscow'; end if;
  return p_at at time zone client_timezone;
end;
$$;
revoke all on function app_private.workout_client_local_time(uuid, timestamptz) from public;

create function app_private.capture_fit_lime_execution_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare local_start timestamp;
begin
  if old.status = 'planned' and new.status = 'in_progress'
    and old.started_at is null and new.started_at is not null
    and app_private.fit_lime_enabled() then
    local_start := app_private.workout_client_local_time(new.client_id, new.started_at);
    new.planned_date := coalesce(old.planned_date, old.workout_date);
    new.planned_start_time := old.start_time;
    new.planned_end_time := old.end_time;
    new.workout_date := local_start::date;
    new.start_time := date_trunc('second', local_start)::time;
    -- The planned end is not an actual completion time. Live completion remains
    -- in completed_at and does not move the workout to another calendar day.
    new.end_time := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.capture_fit_lime_execution_date() from public;

create trigger capture_fit_lime_execution_date
before update of status on public.workouts
for each row execute function app_private.capture_fit_lime_execution_date();

-- Down Migration
drop trigger capture_fit_lime_execution_date on public.workouts;
drop function app_private.capture_fit_lime_execution_date();
drop function app_private.workout_client_local_time(uuid, timestamptz);
alter table public.workouts drop column planned_date,
  drop column planned_start_time, drop column planned_end_time;
