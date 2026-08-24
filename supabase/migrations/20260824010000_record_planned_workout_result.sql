-- A past plan can be recorded as a completed fact without starting a Live
-- session. The transition and fact write stay in one transaction: if the
-- completed-workout write conflicts, the plan remains unchanged.
create or replace function public.record_planned_workout_result(
  p_workout jsonb,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  client_id_value uuid := nullif(p_workout->>'clientId', '')::uuid;
  transitioned_id uuid;
begin
  if workout_id_value is null or client_id_value is null then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  perform public.authorize_workout_mutation(workout_id_value, false);

  update public.workouts set
    status = 'done',
    completed_at = now(),
    version = version + 1,
    updated_by = actor_id
  where id = workout_id_value
    and client_id = client_id_value
    and status = 'planned'
    and deleted_at is null
    and version = p_expected_version
  returning id into transitioned_id;

  if transitioned_id is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  return public.save_completed_workout(p_workout, p_expected_version + 1);
end;
$$;

comment on function public.record_planned_workout_result(jsonb, bigint) is
  'Atomically records an existing planned workout as completed fact without Live.';

revoke all on function public.record_planned_workout_result(jsonb, bigint) from public, anon;
grant execute on function public.record_planned_workout_result(jsonb, bigint) to authenticated;
