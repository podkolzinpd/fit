-- The same occurrence-level removal is available after completion. A client
-- can clean up an assigned result, while trainer authors keep their existing
-- ownership boundary. Deleting the occurrence cascades only to its sets.
create or replace function public.remove_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_expected_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  next_version bigint;
begin
  perform public.authorize_workout_mutation(p_workout_id, true);
  update public.workouts set version = version + 1, updated_by = auth.uid()
    where id = p_workout_id and status in ('in_progress', 'done')
      and deleted_at is null and version = p_expected_version
    returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  delete from public.workout_exercises
    where id = p_exercise_id and workout_id = p_workout_id;
  if not found then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;
  return next_version;
end;
$$;
revoke all on function public.remove_live_exercise(uuid, uuid, bigint) from public, anon;
grant execute on function public.remove_live_exercise(uuid, uuid, bigint) to authenticated;
