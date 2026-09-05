-- Up Migration

create or replace function public.remove_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid,version bigint,replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation('remove_exercise',p_exercise_id,p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_expected_version::text,'UTF8')),'hex'));
  if replayed_version is not null then
    return query select p_exercise_id,replayed_version,true;
    return;
  end if;
  update public.workouts workout set updated_by=auth.uid(),version=workout.version+1
    where workout.id=p_workout_id and workout.status in ('in_progress','done')
      and workout.deleted_at is null and workout.version=p_expected_version
    returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  delete from public.workout_exercises exercise
    where exercise.id=p_exercise_id and exercise.workout_id=p_workout_id;
  if not found then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_exercise_id);
  return query select p_exercise_id,next_version,false;
end;
$$;

-- Down Migration

create or replace function public.remove_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table(resource_id uuid,version bigint,replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation('remove_exercise',p_exercise_id,p_operation_id,
    encode(sha256(convert_to(p_workout_id::text || ':' || p_expected_version::text,'UTF8')),'hex'));
  if replayed_version is not null then
    return query select p_exercise_id,replayed_version,true;
    return;
  end if;
  update public.workouts workout set updated_by=auth.uid(),version=workout.version+1
    where workout.id=p_workout_id and workout.status='in_progress'
      and workout.deleted_at is null and workout.version=p_expected_version
    returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  delete from public.workout_exercises exercise
    where exercise.id=p_exercise_id and exercise.workout_id=p_workout_id;
  if not found then
    raise exception 'workout_conflict' using errcode='PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_exercise_id);
  return query select p_exercise_id,next_version,false;
end;
$$;
