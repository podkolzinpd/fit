-- Итоговый feedback относится к уже сохранённому факту тренировки и не входит
-- в finish_workout: сбой или отказ от feedback не может отменить завершение.
alter table public.workouts
  add column session_rpe smallint,
  add column wellbeing text,
  add column discomfort boolean;

alter table public.workouts
  add constraint workouts_session_rpe_valid
    check (session_rpe is null or session_rpe between 1 and 10),
  add constraint workouts_wellbeing_valid
    check (wellbeing is null or wellbeing in ('good', 'normal', 'hard')),
  add constraint workouts_feedback_complete
    check (
      (session_rpe is null and wellbeing is null and discomfort is null)
      or
      (session_rpe is not null and wellbeing is not null and discomfort is not null)
    );

create function public.submit_workout_feedback(
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
  select workout.*
    into workout_row
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    join public.profiles profile on profile.id = actor_id
   where workout.id = p_workout_id
     and workout.deleted_at is null
     and client.auth_user_id = actor_id
     and profile.account_role = 'client'
   for update of workout;

  if workout_row.id is null then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if p_session_rpe is null or p_session_rpe not between 1 and 10
     or p_wellbeing is null or p_wellbeing not in ('good', 'normal', 'hard')
     or p_discomfort is null then
    raise exception 'invalid_workout_feedback' using errcode = 'PT422';
  end if;
  if p_discomfort and normalized_comment is null then
    raise exception 'discomfort_comment_required' using errcode = 'PT422';
  end if;
  if char_length(coalesce(normalized_comment, '')) > 500 then
    raise exception 'workout_feedback_comment_too_long' using errcode = 'PT422';
  end if;
  if not p_discomfort then
    normalized_comment := null;
  end if;

  -- Потерянный сетевой ответ можно повторить с исходной version: если payload
  -- уже сохранён, это тот же submit, поэтому новую запись/версию не создаём.
  if workout_row.session_rpe is not distinct from p_session_rpe
     and workout_row.wellbeing is not distinct from p_wellbeing
     and workout_row.discomfort is not distinct from p_discomfort
     and workout_row.client_comment is not distinct from normalized_comment then
    return workout_row.version;
  end if;

  update public.workouts workout
     set session_rpe = p_session_rpe,
         wellbeing = p_wellbeing,
         discomfort = p_discomfort,
         client_comment = normalized_comment,
         version = workout.version + 1,
         updated_at = now()
   where workout.id = p_workout_id
     and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  return next_version;
end;
$$;

revoke all on function public.submit_workout_feedback(uuid, smallint, text, boolean, text, bigint)
  from public, anon;
grant execute on function public.submit_workout_feedback(uuid, smallint, text, boolean, text, bigint)
  to authenticated;
