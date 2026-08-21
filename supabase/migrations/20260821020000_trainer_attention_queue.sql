-- YAFIT-290: explicit client questions and a small, explainable trainer queue.
-- A completed workout does not require acknowledgement by itself. Only an
-- unresolved question, reported discomfort or an unresolved past plan becomes
-- an action. Planning reminders are stored per trainer/client membership.

alter table public.workouts
  add column client_question text,
  add column client_question_asked_at timestamptz,
  add column client_question_resolved_at timestamptz,
  add column feedback_submitted_at timestamptz;

alter table public.workouts
  add constraint workouts_client_question_length
    check (client_question is null or char_length(client_question) <= 500),
  add constraint workouts_client_question_consistent check (
    (client_question is null and client_question_asked_at is null and client_question_resolved_at is null)
    or (client_question is not null and client_question_asked_at is not null)
  );

alter table public.client_trainers
  add column attention_snoozed_until timestamptz;

create or replace function public.stamp_workout_attention_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_rpe is distinct from old.session_rpe
     or new.wellbeing is distinct from old.wellbeing
     or new.discomfort is distinct from old.discomfort
     or new.client_comment is distinct from old.client_comment then
    new.feedback_submitted_at := now();
  end if;

  if new.trainer_reviewed_at is distinct from old.trainer_reviewed_at
     and new.trainer_reviewed_at is not null
     and new.client_question is not null
     and new.client_question_resolved_at is null then
    new.client_question_resolved_at := now();
  end if;
  return new;
end;
$$;

create trigger workouts_attention_events_before_update
before update of session_rpe, wellbeing, discomfort, client_comment, trainer_reviewed_at
on public.workouts
for each row execute function public.stamp_workout_attention_events();

create function public.ask_workout_question(
  p_workout_id uuid,
  p_question text,
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
  normalized_question text := nullif(btrim(p_question), '');
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
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if normalized_question is null then
    raise exception 'workout_question_required' using errcode = 'PT422';
  end if;
  if char_length(normalized_question) > 500 then
    raise exception 'workout_question_too_long' using errcode = 'PT422';
  end if;

  if workout_row.client_question is not distinct from normalized_question
     and workout_row.client_question_resolved_at is null then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set client_question = normalized_question,
      client_question_asked_at = now(),
      client_question_resolved_at = null,
      version = workout.version + 1,
      updated_at = now()
  where workout.id = p_workout_id
  returning workout.version into next_version;

  return next_version;
end;
$$;

create function public.resolve_workout_question(
  p_workout_id uuid,
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
  next_version bigint;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;

  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;

  select client.trainer_id
  into client_root_trainer_id
  from public.clients client
  where client.id = workout_row.client_id;

  if workout_row.id is null or actor_role is distinct from 'trainer'
     or actor_id is distinct from client_root_trainer_id then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if workout_row.client_question_resolved_at is not null then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set client_question_resolved_at = now(),
      version = workout.version + 1,
      updated_at = now()
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create function public.answer_workout_question(
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
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;

  select workout.* into workout_row
  from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;

  select client.trainer_id into client_root_trainer_id
  from public.clients client where client.id = workout_row.client_id;

  if workout_row.id is null or actor_role is distinct from 'trainer'
     or actor_id is distinct from client_root_trainer_id then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if p_reaction not in ('thumbs_up', 'fire', 'strong')
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

create function public.snooze_client_attention(p_client_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  snoozed_until timestamptz := now() + interval '14 days';
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'trainer'
  ) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;

  insert into public.client_trainers (client_id, trainer_id, attention_snoozed_until)
  select p_client_id, actor_id, snoozed_until
  where exists (
    select 1
    from public.clients client
    left join public.client_trainers membership
      on membership.client_id = client.id and membership.trainer_id = actor_id
    where client.id = p_client_id
      and (client.trainer_id = actor_id or membership.trainer_id = actor_id)
  )
  on conflict (client_id, trainer_id) do update
  set attention_snoozed_until = excluded.attention_snoozed_until;

  if not found then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  return snoozed_until;
end;
$$;

create function public.list_trainer_attention_workouts()
returns table (
  workout_id uuid,
  client_id uuid,
  client_name text,
  workout_date date,
  client_question text,
  client_question_asked_at timestamptz,
  discomfort boolean,
  client_comment text,
  feedback_submitted_at timestamptz,
  version bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select workout.id, workout.client_id, coalesce(membership.alias, client.full_name),
    workout.workout_date, workout.client_question, workout.client_question_asked_at,
    workout.discomfort, workout.client_comment,
    coalesce(workout.feedback_submitted_at, workout.updated_at, workout.completed_at),
    workout.version
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.client_trainers membership
    on membership.client_id = client.id and membership.trainer_id = auth.uid()
  where client.archived_at is null
    and workout.deleted_at is null
    and workout.status = 'done'
    and (client.trainer_id = auth.uid() or membership.trainer_id = auth.uid())
    and auth.uid() = client.trainer_id
    and (
      (workout.client_question is not null and workout.client_question_resolved_at is null)
      or (
        workout.discomfort is true
        and (
          workout.trainer_reviewed_at is null
          or workout.trainer_reviewed_at < coalesce(workout.feedback_submitted_at, workout.updated_at, workout.completed_at)
        )
      )
    )
  order by workout.client_question_asked_at desc nulls last,
    coalesce(workout.feedback_submitted_at, workout.updated_at, workout.completed_at) desc;
$$;

revoke all on function public.ask_workout_question(uuid, text, bigint) from public, anon;
revoke all on function public.answer_workout_question(uuid, text, text, bigint) from public, anon;
revoke all on function public.resolve_workout_question(uuid, bigint) from public, anon;
revoke all on function public.snooze_client_attention(uuid) from public, anon;
revoke all on function public.list_trainer_attention_workouts() from public, anon;
grant execute on function public.ask_workout_question(uuid, text, bigint) to authenticated;
grant execute on function public.answer_workout_question(uuid, text, text, bigint) to authenticated;
grant execute on function public.resolve_workout_question(uuid, bigint) to authenticated;
grant execute on function public.snooze_client_attention(uuid) to authenticated;
grant execute on function public.list_trainer_attention_workouts() to authenticated;
