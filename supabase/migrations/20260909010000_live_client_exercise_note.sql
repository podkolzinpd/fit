-- A session note belongs to the exercising client, never to the trainer's cue.
alter table public.workout_exercises add column client_note text;
alter table public.workout_exercises add constraint workout_exercises_client_note_length check (length(client_note) <= 5000);

create or replace function public.set_exercise_comment(p_exercise_id uuid, p_comment text, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  next_version bigint;
  root_trainer uuid;
  result bigint;
begin
  if length(coalesce(p_comment, '')) > 5000 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  select workout_id into workout_id_value from public.workout_exercises where id = p_exercise_id;
  if exists (select 1 from public.profiles where id = actor_id and account_role = 'client') then
    perform public.authorize_workout_mutation(workout_id_value, true);
    update public.workouts set version = version + 1, updated_by = actor_id
    where id = workout_id_value and status = 'in_progress' and deleted_at is null and version = p_expected_version
    returning version into next_version;
    if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
    update public.workout_exercises set client_note = nullif(btrim(p_comment), ''), updated_by = actor_id
    where id = p_exercise_id;
    return next_version;
  end if;
  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_set_exercise_comment(p_exercise_id, p_comment, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', actor_id::text, true); raise; end;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  return result;
end $$;
