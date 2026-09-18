-- Normalize custom exercises before the Live wrappers switch into the
-- workout owner's partition. Cross-partition exercises are stored as stable
-- snapshots, matching planned and completed workout saves.

create or replace function public.append_live_exercise(
  p_workout_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_trainer uuid;
  effective_workout jsonb;
  effective_exercise jsonb;
  result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  effective_workout := private.normalize_workout_custom_exercises(
    jsonb_build_object('exercises', jsonb_build_array(p_exercise)),
    root_trainer,
    actor_id,
    false
  );
  effective_exercise := effective_workout->'exercises'->0;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_append_live_exercise(
      p_workout_id,
      effective_exercise,
      p_expected_version,
      actor_id
    );
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
exception
  when invalid_text_representation then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.replace_live_exercise(
  p_workout_id uuid,
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_trainer uuid;
  effective_workout jsonb;
  effective_exercise jsonb;
  result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  effective_workout := private.normalize_workout_custom_exercises(
    jsonb_build_object('exercises', jsonb_build_array(p_exercise)),
    root_trainer,
    actor_id,
    false
  );
  effective_exercise := effective_workout->'exercises'->0;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_replace_live_exercise(
      p_workout_id,
      p_exercise_id,
      effective_exercise,
      p_expected_version,
      actor_id
    );
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
exception
  when invalid_text_representation then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.append_live_exercise(uuid, jsonb, bigint)
  from public, anon;
grant execute on function public.append_live_exercise(uuid, jsonb, bigint)
  to authenticated;
revoke all on function public.replace_live_exercise(uuid, uuid, jsonb, bigint)
  from public, anon;
grant execute on function public.replace_live_exercise(uuid, uuid, jsonb, bigint)
  to authenticated;
