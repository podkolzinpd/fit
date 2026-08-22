-- Текстовый ответ сам по себе завершает вопрос клиента. Реакция остаётся
-- необязательным эмоциональным дополнением и не блокирует основное действие.
create or replace function public.answer_workout_question(
  p_workout_id uuid,
  p_reaction text,
  p_review text,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  workout_row public.workouts%rowtype;
  client_root_trainer_id uuid;
  client_auth_user_id uuid;
  responsible_trainer_id uuid;
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;

  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;

  select client.trainer_id, client.auth_user_id
  into client_root_trainer_id, client_auth_user_id
  from public.clients client
  where client.id = workout_row.client_id;

  responsible_trainer_id := case
    when workout_row.created_by = client_auth_user_id then client_root_trainer_id
    when workout_row.created_by is null then workout_row.trainer_id
    else workout_row.created_by
  end;

  if workout_row.id is null or actor_role is distinct from 'trainer'
     or actor_id is distinct from responsible_trainer_id
     or not public.can_access_client(workout_row.client_id) then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if (p_reaction is not null and p_reaction not in ('thumbs_up', 'fire', 'strong'))
     or normalized_review is null then
    raise exception 'invalid_trainer_response' using errcode = 'PT422';
  end if;
  if char_length(normalized_review) > 500 then
    raise exception 'trainer_response_too_long' using errcode = 'PT422';
  end if;

  if workout_row.trainer_reaction is not distinct from p_reaction
     and workout_row.trainer_review is not distinct from normalized_review
     and workout_row.trainer_review_author_id = actor_id
     and workout_row.client_question_resolved_at is not null then
    return workout_row.version;
  end if;
  if workout_row.client_question_resolved_at is not null then
    raise exception 'workout_question_resolved' using errcode = 'PT422';
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set trainer_reaction = p_reaction,
      trainer_review = normalized_review,
      trainer_review_author_id = actor_id,
      trainer_reviewed_at = now(),
      version = workout.version + 1,
      updated_at = now()
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

revoke all on function public.answer_workout_question(uuid, text, text, bigint) from public, anon;
grant execute on function public.answer_workout_question(uuid, text, text, bigint) to authenticated;
