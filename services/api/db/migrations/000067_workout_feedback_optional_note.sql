-- Up Migration

-- Итоговая заметка относится ко всей тренировке, а не только к дискомфорту.
create or replace function public.submit_workout_feedback(
  p_workout_id uuid,
  p_session_rpe smallint,
  p_wellbeing text,
  p_discomfort boolean,
  p_comment text,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_row public.workouts%rowtype;
  normalized_comment text := nullif(btrim(p_comment), '');
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and client.auth_user_id = actor_id
    and profile.account_role = 'client'
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if p_session_rpe is null or p_session_rpe not between 1 and 10
    or p_wellbeing is null or p_wellbeing not in ('good', 'normal', 'hard')
    or p_discomfort is null
  then
    raise exception 'workout_feedback_invalid' using errcode = 'PT422';
  end if;
  if (p_discomfort or p_session_rpe >= 9) and normalized_comment is null then
    raise exception 'workout_feedback_invalid' using errcode = 'PT422';
  end if;
  if char_length(coalesce(normalized_comment, '')) > 500 then
    raise exception 'workout_feedback_invalid' using errcode = 'PT422';
  end if;

  if workout_row.session_rpe is not distinct from p_session_rpe
    and workout_row.wellbeing is not distinct from p_wellbeing
    and workout_row.discomfort is not distinct from p_discomfort
    and workout_row.client_comment is not distinct from normalized_comment
  then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set session_rpe = p_session_rpe,
      wellbeing = p_wellbeing,
      discomfort = p_discomfort,
      client_comment = normalized_comment,
      feedback_submitted_at = now(),
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

-- Down Migration

-- Intentionally omitted: reverting would silently delete neutral workout notes.
