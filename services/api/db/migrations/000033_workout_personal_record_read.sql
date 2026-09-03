-- Up Migration

create or replace function public.read_workout_has_personal_record(
  p_workout_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.can_read_workout(p_workout_id)
      then app_private.workout_has_personal_record(p_workout_id)
    else false
  end
$$;

revoke all on function public.read_workout_has_personal_record(uuid)
  from public;
grant execute on function public.read_workout_has_personal_record(uuid)
  to fit_api;

-- Down Migration

revoke execute on function public.read_workout_has_personal_record(uuid)
  from fit_api;
drop function public.read_workout_has_personal_record(uuid);
