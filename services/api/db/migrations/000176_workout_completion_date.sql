-- Up Migration

create or replace function app_private.guard_new_workout_completion_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_timezone text;
begin
  if actor_id is null or new.status <> 'done' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'done' then return new; end if;
  end if;
  -- Historical dates are past in every supported timezone. Avoid enumerating
  -- the timezone catalog for each row of an already-reviewed history import.
  if new.workout_date < (now() at time zone 'UTC')::date - 1 then return new; end if;
  select profile.timezone into actor_timezone from public.profiles profile where profile.id = actor_id;
  if not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name = actor_timezone)
    then actor_timezone := 'Europe/Moscow'; end if;
  if new.workout_date > (now() at time zone actor_timezone)::date then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_new_workout_completion_date() from public, fit_api;

-- Reapplication after an older API rollback keeps the guard in place.
drop trigger if exists guard_new_workout_completion_date on public.workouts;
create trigger guard_new_workout_completion_date
before insert or update of status on public.workouts
for each row execute function app_private.guard_new_workout_completion_date();

-- Down Migration
-- Forward-only: no recorded history or financial data is rewritten.
