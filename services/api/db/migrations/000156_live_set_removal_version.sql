-- Up Migration

-- Optional set-version guard for the client pilot. The three-argument command
-- and existing callers retain their contract; no stored workout is rewritten.
create or replace function public.remove_live_set(
  p_set_id uuid,
  p_expected_version bigint,
  p_operation_id uuid,
  p_expected_set_version bigint
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  exercise_id_value uuid;
  exercise_block_type text;
  remaining_count integer;
  replayed_version bigint;
  next_version bigint;
begin
  if p_expected_set_version is null or p_expected_set_version <= 0 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'remove_set',
    p_set_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text || ':' || p_expected_set_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_set_id, replayed_version, true;
    return;
  end if;

  select exercise.workout_id, workout_set.workout_exercise_id, exercise.block_type
  into workout_id_value, exercise_id_value, exercise_block_type
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  perform app_private.authorize_live_workout(workout_id_value);
  if exercise_block_type <> 'single' then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  -- save_live_set_draft locks this same parent before changing set.version.
  -- Recheck inside that lock: an edited fact never loses a race to deletion.
  if not exists (
    select 1 from public.workout_sets workout_set
    where workout_set.id = p_set_id and workout_set.version = p_expected_set_version
  ) then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;

  select count(*)::integer
  into remaining_count
  from public.workout_sets workout_set
  where workout_set.workout_exercise_id = exercise_id_value;
  if remaining_count <= 1 then
    raise exception 'last_set_cannot_be_removed' using errcode = 'PT422';
  end if;

  delete from public.workout_sets workout_set
  where workout_set.id = p_set_id;
  if not found then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  set constraints all deferred;
  with ordered_sets as (
    select
      workout_set.id,
      (row_number() over (
        order by workout_set.position, workout_set.id
      ) - 1)::smallint as new_position
    from public.workout_sets workout_set
    where workout_set.workout_exercise_id = exercise_id_value
  )
  update public.workout_sets workout_set
  set
    position = ordered.new_position,
    updated_by = actor_id
  from ordered_sets ordered
  where workout_set.id = ordered.id
    and workout_set.position <> ordered.new_position;

  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version, p_set_id
  );
  return query select p_set_id, next_version, false;
end;
$$;

revoke all on function public.remove_live_set(uuid, bigint, uuid, bigint) from public;
grant execute on function public.remove_live_set(uuid, bigint, uuid, bigint) to fit_api;

-- Down Migration
revoke execute on function public.remove_live_set(uuid, bigint, uuid, bigint) from fit_api;
drop function public.remove_live_set(uuid, bigint, uuid, bigint);
