-- Up Migration
--
-- Live structural mutations predated cross-partition custom-exercise
-- snapshots. Normalize a selected custom exercise before delegating to the
-- existing idempotent mutation so an accessible exercise can be added to or
-- used to replace an exercise in a workout owned by another partition.

alter function public.append_live_exercise(uuid, jsonb, bigint, uuid)
  rename to append_live_exercise_without_cross_partition_snapshots;
alter function public.append_live_exercise_without_cross_partition_snapshots(
  uuid, jsonb, bigint, uuid
) set schema app_private;
revoke all on function app_private.append_live_exercise_without_cross_partition_snapshots(
  uuid, jsonb, bigint, uuid
) from public, fit_api;

create or replace function public.append_live_exercise(
  p_workout_id uuid,
  p_exercise jsonb,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id_value uuid := auth.uid();
  owner_id_value uuid;
  effective_workout jsonb;
  effective_exercise jsonb;
begin
  owner_id_value := app_private.authorize_live_workout(p_workout_id);
  effective_workout := app_private.normalize_workout_custom_exercises(
    jsonb_build_object('exercises', jsonb_build_array(p_exercise)),
    owner_id_value,
    actor_id_value,
    false
  );
  effective_exercise := effective_workout->'exercises'->0;

  return query
  select mutation.resource_id, mutation.version, mutation.replayed
  from app_private.append_live_exercise_without_cross_partition_snapshots(
    p_workout_id,
    effective_exercise,
    p_expected_version,
    p_operation_id
  ) mutation;
exception
  when invalid_text_representation then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.append_live_exercise(
  uuid, jsonb, bigint, uuid
) from public;
grant execute on function public.append_live_exercise(
  uuid, jsonb, bigint, uuid
) to fit_api;

alter function public.replace_live_exercise(uuid, uuid, jsonb, bigint, uuid)
  rename to replace_live_exercise_without_cross_partition_snapshots;
alter function public.replace_live_exercise_without_cross_partition_snapshots(
  uuid, uuid, jsonb, bigint, uuid
) set schema app_private;
revoke all on function app_private.replace_live_exercise_without_cross_partition_snapshots(
  uuid, uuid, jsonb, bigint, uuid
) from public, fit_api;

create or replace function public.replace_live_exercise(
  p_workout_id uuid,
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id_value uuid := auth.uid();
  owner_id_value uuid;
  effective_workout jsonb;
  effective_exercise jsonb;
begin
  owner_id_value := app_private.authorize_live_workout(p_workout_id);
  effective_workout := app_private.normalize_workout_custom_exercises(
    jsonb_build_object('exercises', jsonb_build_array(p_exercise)),
    owner_id_value,
    actor_id_value,
    false
  );
  effective_exercise := effective_workout->'exercises'->0;

  return query
  select mutation.resource_id, mutation.version, mutation.replayed
  from app_private.replace_live_exercise_without_cross_partition_snapshots(
    p_workout_id,
    p_exercise_id,
    effective_exercise,
    p_expected_version,
    p_operation_id
  ) mutation;
exception
  when invalid_text_representation then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.replace_live_exercise(
  uuid, uuid, jsonb, bigint, uuid
) from public;
grant execute on function public.replace_live_exercise(
  uuid, uuid, jsonb, bigint, uuid
) to fit_api;

-- Down Migration
-- Forward-only: reverting would make accessible custom exercises fail in Live.
