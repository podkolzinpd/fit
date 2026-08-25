-- Up Migration

alter table public.workouts
  add column session_rpe smallint,
  add column wellbeing text,
  add column discomfort boolean,
  add column feedback_submitted_at timestamptz,
  add column trainer_reaction text,
  add column trainer_review text,
  add column trainer_review_author_id uuid
    references public.profiles (id) on delete set null,
  add column trainer_reviewed_at timestamptz,
  add column client_question text,
  add column client_question_asked_at timestamptz,
  add column client_question_resolved_at timestamptz,
  add constraint workouts_session_rpe_valid
    check (session_rpe is null or session_rpe between 1 and 10),
  add constraint workouts_wellbeing_valid
    check (wellbeing is null or wellbeing in ('good', 'normal', 'hard')),
  add constraint workouts_feedback_complete check (
    (session_rpe is null and wellbeing is null and discomfort is null)
    or (session_rpe is not null and wellbeing is not null and discomfort is not null)
  ),
  add constraint workouts_trainer_reaction_valid check (
    trainer_reaction is null
    or trainer_reaction in ('thumbs_up', 'fire', 'strong')
  ),
  add constraint workouts_trainer_review_length
    check (trainer_review is null or char_length(trainer_review) <= 500),
  add constraint workouts_client_question_length
    check (client_question is null or char_length(client_question) <= 500),
  add constraint workouts_client_question_consistent check (
    (client_question is null
      and client_question_asked_at is null
      and client_question_resolved_at is null)
    or (client_question is not null and client_question_asked_at is not null)
  );

alter table public.client_trainers
  add column attention_snoozed_until timestamptz;

create or replace function app_private.responsible_workout_trainer(
  p_workout_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when workout.created_by = client.auth_user_id then client.trainer_id
    when workout.created_by is null then workout.trainer_id
    else workout.created_by
  end
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
$$;

revoke all on function app_private.responsible_workout_trainer(uuid)
  from public;

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
  if p_discomfort and normalized_comment is null then
    raise exception 'workout_feedback_invalid' using errcode = 'PT422';
  end if;
  if char_length(coalesce(normalized_comment, '')) > 500 then
    raise exception 'workout_feedback_invalid' using errcode = 'PT422';
  end if;
  if not p_discomfort then
    normalized_comment := null;
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

create or replace function public.set_workout_review(
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
  workout_row public.workouts%rowtype;
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and profile.account_role = 'trainer'
    and actor_id = app_private.responsible_workout_trainer(workout.id)
    and public.can_access_client(workout.client_id)
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if not (
    (p_reaction is null and normalized_review is null)
    or (p_reaction in ('thumbs_up', 'fire', 'strong')
      and normalized_review is not null)
  ) or char_length(coalesce(normalized_review, '')) > 500 then
    raise exception 'workout_response_invalid' using errcode = 'PT422';
  end if;

  if workout_row.trainer_reaction is not distinct from p_reaction
    and workout_row.trainer_review is not distinct from normalized_review
    and (normalized_review is null
      or workout_row.trainer_review_author_id = actor_id)
  then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set trainer_reaction = p_reaction,
      trainer_review = normalized_review,
      trainer_review_author_id = case
        when normalized_review is null then null else actor_id end,
      trainer_reviewed_at = case
        when normalized_review is null then null else now() end,
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create or replace function public.ask_workout_question(
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
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if normalized_question is null or char_length(normalized_question) > 500 then
    raise exception 'workout_question_invalid' using errcode = 'PT422';
  end if;
  if workout_row.client_question is not distinct from normalized_question
    and workout_row.client_question_resolved_at is null
  then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set client_question = normalized_question,
      client_question_asked_at = now(),
      client_question_resolved_at = null,
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

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
  workout_row public.workouts%rowtype;
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and profile.account_role = 'trainer'
    and actor_id = client.trainer_id
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if (p_reaction is not null
      and p_reaction not in ('thumbs_up', 'fire', 'strong'))
    or normalized_review is null
    or char_length(normalized_review) > 500
  then
    raise exception 'workout_response_invalid' using errcode = 'PT422';
  end if;
  if workout_row.trainer_reaction is not distinct from p_reaction
    and workout_row.trainer_review is not distinct from normalized_review
    and workout_row.trainer_review_author_id = actor_id
    and workout_row.client_question_resolved_at is not null
  then
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
      client_question_resolved_at = now(),
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create or replace function public.resolve_workout_question(
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
  workout_row public.workouts%rowtype;
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and profile.account_role = 'trainer'
    and actor_id = client.trainer_id
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
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
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create or replace function public.snooze_client_attention(p_client_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  snoozed_until timestamptz := now() + interval '14 days';
  stored_snoozed_until timestamptz;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'trainer'
  ) then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select membership.attention_snoozed_until
  into stored_snoozed_until
  from public.client_trainers membership
  join public.clients client on client.id = membership.client_id
  where membership.client_id = p_client_id
    and membership.trainer_id = actor_id
    and client.archived_at is null
  for update of membership;

  if stored_snoozed_until > now() then
    return stored_snoozed_until;
  end if;

  insert into public.client_trainers (
    client_id, trainer_id, attention_snoozed_until
  )
  select p_client_id, actor_id, snoozed_until
  from public.clients client
  where client.id = p_client_id
    and client.archived_at is null
    and (client.trainer_id = actor_id or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = client.id
        and membership.trainer_id = actor_id
    ))
  on conflict (client_id, trainer_id) do update
  set attention_snoozed_until = excluded.attention_snoozed_until,
      version = public.client_trainers.version + 1;

  if not found then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  return snoozed_until;
end;
$$;

create or replace function public.list_trainer_attention_workouts()
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
  select workout.id, workout.client_id,
    coalesce(membership.alias, client.full_name), workout.workout_date,
    workout.client_question, workout.client_question_asked_at,
    workout.discomfort, workout.client_comment,
    coalesce(workout.feedback_submitted_at, workout.updated_at),
    workout.version
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.client_trainers membership
    on membership.client_id = client.id and membership.trainer_id = auth.uid()
  where client.archived_at is null
    and workout.deleted_at is null
    and workout.status = 'done'
    and client.trainer_id = auth.uid()
    and (
      (workout.client_question is not null
        and workout.client_question_resolved_at is null)
      or (
        workout.discomfort is true
        and (workout.trainer_reviewed_at is null
          or workout.trainer_reviewed_at < coalesce(
            workout.feedback_submitted_at, workout.updated_at
          ))
      )
    )
  order by workout.client_question_asked_at desc nulls last,
    coalesce(workout.feedback_submitted_at, workout.updated_at) desc;
$$;

revoke all on function public.submit_workout_feedback(
  uuid, smallint, text, boolean, text, bigint
) from public;
revoke all on function public.set_workout_review(uuid, text, text, bigint)
  from public;
revoke all on function public.ask_workout_question(uuid, text, bigint)
  from public;
revoke all on function public.answer_workout_question(uuid, text, text, bigint)
  from public;
revoke all on function public.resolve_workout_question(uuid, bigint)
  from public;
revoke all on function public.snooze_client_attention(uuid) from public;
revoke all on function public.list_trainer_attention_workouts() from public;

grant execute on function public.submit_workout_feedback(
  uuid, smallint, text, boolean, text, bigint
) to fit_api;
grant execute on function public.set_workout_review(uuid, text, text, bigint)
  to fit_api;
grant execute on function public.ask_workout_question(uuid, text, bigint)
  to fit_api;
grant execute on function public.answer_workout_question(
  uuid, text, text, bigint
) to fit_api;
grant execute on function public.resolve_workout_question(uuid, bigint)
  to fit_api;
grant execute on function public.snooze_client_attention(uuid) to fit_api;
grant execute on function public.list_trainer_attention_workouts() to fit_api;

-- Down Migration

revoke execute on function public.list_trainer_attention_workouts()
  from fit_api;
revoke execute on function public.snooze_client_attention(uuid) from fit_api;
revoke execute on function public.resolve_workout_question(uuid, bigint)
  from fit_api;
revoke execute on function public.answer_workout_question(
  uuid, text, text, bigint
) from fit_api;
revoke execute on function public.ask_workout_question(uuid, text, bigint)
  from fit_api;
revoke execute on function public.set_workout_review(uuid, text, text, bigint)
  from fit_api;
revoke execute on function public.submit_workout_feedback(
  uuid, smallint, text, boolean, text, bigint
) from fit_api;

drop function public.list_trainer_attention_workouts();
drop function public.snooze_client_attention(uuid);
drop function public.resolve_workout_question(uuid, bigint);
drop function public.answer_workout_question(uuid, text, text, bigint);
drop function public.ask_workout_question(uuid, text, bigint);
drop function public.set_workout_review(uuid, text, text, bigint);
drop function public.submit_workout_feedback(
  uuid, smallint, text, boolean, text, bigint
);
drop function app_private.responsible_workout_trainer(uuid);

alter table public.client_trainers drop column attention_snoozed_until;
alter table public.workouts
  drop column client_question_resolved_at,
  drop column client_question_asked_at,
  drop column client_question,
  drop column trainer_reviewed_at,
  drop column trainer_review_author_id,
  drop column trainer_review,
  drop column trainer_reaction,
  drop column feedback_submitted_at,
  drop column discomfort,
  drop column wellbeing,
  drop column session_rpe;
