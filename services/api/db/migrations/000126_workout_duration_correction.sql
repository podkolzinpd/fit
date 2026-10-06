-- Up Migration

-- Correct a completed fact without granting the general workout editor.
create function public.set_workout_actual_duration(
  p_workout_id uuid, p_duration_sec integer, p_expected_version bigint
)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  workout_row public.workouts%rowtype;
  next_version bigint;
begin
  if actor_id is null or not public.can_read_workout(p_workout_id) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  select workout.* into workout_row from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null
  for update;
  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if p_expected_version is null or p_expected_version < 1
    or (p_duration_sec is not null and p_duration_sec not between 1 and 43200) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  -- An identical retry is a no-op, including a lost response after commit.
  if workout_row.actual_duration_sec is not distinct from p_duration_sec then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  update public.workouts workout
  set actual_duration_sec = p_duration_sec, updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  -- Existing duration-sensitive calorie triggers run in this transaction.
  return next_version;
end;
$$;
revoke all on function public.set_workout_actual_duration(uuid, integer, bigint) from public;
grant execute on function public.set_workout_actual_duration(uuid, integer, bigint) to fit_api;

-- Down Migration
drop function public.set_workout_actual_duration(uuid, integer, bigint);
