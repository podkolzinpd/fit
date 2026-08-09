-- A completed workout may only reference a goal stage of its own client.
create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  stage_id_value uuid := nullif(p_workout->>'stageId', '')::uuid;
  owner_id uuid;
  result uuid;
begin
  if workout_id_value is not null then
    owner_id := public.authorize_workout_mutation(workout_id_value, false);

    if stage_id_value is not null and not exists (
      select 1
      from public.workouts workout
      join public.goal_stages stage on stage.client_id = workout.client_id
      where workout.id = workout_id_value
        and workout.deleted_at is null
        and stage.id = stage_id_value
    ) then
      raise exception 'goal_stage_client_mismatch' using errcode = 'PT422';
    end if;
  end if;

  if workout_id_value is not null or request_id_value is null then
    return private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  end if;

  owner_id := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  result := private.claim_workout_create_request(owner_id, request_id_value);
  if result is not null then
    return result;
  end if;

  result := private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  perform private.finish_workout_create_request(owner_id, request_id_value, result);
  return result;
end;
$$;

revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
