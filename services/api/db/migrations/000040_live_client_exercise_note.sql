-- Up Migration
alter table public.workout_exercises add column client_note text;
alter table public.workout_exercises add constraint workout_exercises_client_note_length check (length(client_note) <= 5000);

create or replace function public.set_live_exercise_comment(
  p_exercise_id uuid, p_comment text, p_expected_version bigint, p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  normalized_comment text := nullif(btrim(p_comment), '');
  replayed_version bigint;
  next_version bigint;
  is_client boolean;
begin
  if length(coalesce(normalized_comment, '')) > 5000 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  select exercise.workout_id into workout_id_value from public.workout_exercises exercise where exercise.id = p_exercise_id;
  select profile.account_role = 'client' into is_client from public.profiles profile where profile.id = actor_id;
  if is_client then perform app_private.authorize_live_workout(workout_id_value);
  else perform app_private.authorize_live_exercise_comment(workout_id_value); end if;
  replayed_version := app_private.claim_live_workout_operation(
    'set_comment', p_exercise_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text || ':' || coalesce(normalized_comment, ''), 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_exercise_id, replayed_version, true;
    return;
  end if;
  update public.workouts workout set updated_by = actor_id, version = workout.version + 1
  where workout.id = workout_id_value and workout.status = 'in_progress'
    and workout.deleted_at is null and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  update public.workout_exercises exercise
  set client_note = case when is_client then normalized_comment else exercise.client_note end,
    trainer_comment = case when is_client then exercise.trainer_comment else normalized_comment end,
    updated_by = actor_id
  where exercise.id = p_exercise_id;
  if not found then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_exercise_id);
  return query select p_exercise_id, next_version, false;
end $$;

-- Down Migration
-- Forward-only: never discard users' session notes on rollback.
