-- Up Migration

-- analytics.trainer_overview/client_overview were created once in
-- 000036_app_feedback_operations.sql and never kept in sync with the many
-- Supabase migrations that extended analytics.trainer_overview/client_overview
-- since (activity breakdown, weekly metrics, workout counts, membership
-- rollup). Switching the DataLens connection from Supabase to Yandex surfaced
-- the drift as ERR.DS_API.FORMULA.UNKNOWN_SOURCE_COLUMN for every column added
-- after the initial cut. This migration brings both views back to parity with
-- the current Supabase definitions, with three deliberate exceptions where
-- Yandex's schema has no equivalent data:
--   - is_test_account: Supabase detects test accounts by auth.users.email.
--     Yandex never stores email (app_private.auth_identities only keeps a
--     sha256 of the provider subject) - always false here.
--   - last_sign_in_at: Supabase reads auth.users.last_sign_in_at. Yandex has
--     no login table, only session issuance
--     (app_private.yandex_app_sessions/yandex_pilot_sessions) - approximated
--     as the most recent session created for the profile.
--   - clients_with_notes_total/last_client_notes_at: Supabase stores the note
--     in a dedicated client_private_details table with its own updated_at.
--     Yandex keeps the same note directly on client_trainers, which had no
--     updated_at column - added below. Nullable (not the usual not-null
--     default now(), see set_updated_at convention elsewhere): tenant
--     migration imports client_trainers rows via jsonb_populate_recordset
--     from a Supabase source row that never had this key, which fills
--     absent keys with null rather than the column default - a not-null
--     column would make every tenant migration with a client note fail.
--     Existing Yandex-native rows and any future update still get a real
--     timestamp from the trigger.

alter table public.client_trainers
  add column updated_at timestamptz default now();

create trigger set_updated_at
before update on public.client_trainers
for each row execute function public.set_updated_at();

revoke all on analytics.trainer_overview, analytics.client_overview
  from public, fit_api;

drop view analytics.trainer_overview;
drop view analytics.client_overview;

create view analytics.trainer_overview
with (security_barrier = true, security_invoker = false)
as
select
  trainer.profile_id as trainer_id,
  trainer.created_at as registered_at,
  coalesce(clients.clients_total, 0) as clients_total,
  coalesce(clients.clients_archived, 0) as clients_archived,
  coalesce(clients.clients_app_linked, 0) as clients_app_linked,
  false as is_test_account,
  coalesce(workouts.workouts_total, 0) as workouts_total,
  coalesce(workouts.workouts_planned, 0) as workouts_planned,
  coalesce(workouts.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(workouts.workouts_done, 0) as workouts_done,
  coalesce(workouts.workouts_cancelled_total, 0) as workouts_cancelled_total,
  coalesce(exercises.exercises_unique_used, 0) as exercises_unique_used,
  workouts.last_workout_at,
  coalesce(client_notes.clients_with_notes_total, 0) as clients_with_notes_total,
  client_notes.last_client_notes_at,
  coalesce(progress.progress_entries_total, 0) as progress_entries_total,
  progress.last_progress_entry_at,
  coalesce(custom_exercises_authored.custom_exercises_total, 0) as custom_exercises_total,
  custom_exercises_authored.last_custom_exercise_at,
  coalesce(goals.goals_created_total, 0) as goals_created_total,
  goals.last_goal_activity_at,
  coalesce(summaries.summaries_published_total, 0) as summaries_published_total,
  summaries.last_summary_published_at,
  coalesce(assistant.assistant_messages_total, 0) as assistant_messages_total,
  assistant.last_assistant_message_at,
  sign_ins.last_sign_in_at,
  greatest(
    workouts.last_workout_at, client_notes.last_client_notes_at,
    progress.last_progress_entry_at, custom_exercises_authored.last_custom_exercise_at,
    goals.last_goal_activity_at, summaries.last_summary_published_at,
    assistant.last_assistant_message_at
  ) as last_active_at,
  floor(extract(epoch from (now() - greatest(
    workouts.last_workout_at, client_notes.last_client_notes_at,
    progress.last_progress_entry_at, custom_exercises_authored.last_custom_exercise_at,
    goals.last_goal_activity_at, summaries.last_summary_published_at,
    assistant.last_assistant_message_at
  ))) / 86400)::bigint as days_since_last_activity,
  case
    when greatest(
      workouts.last_workout_at, client_notes.last_client_notes_at,
      progress.last_progress_entry_at, custom_exercises_authored.last_custom_exercise_at,
      goals.last_goal_activity_at, summaries.last_summary_published_at,
      assistant.last_assistant_message_at
    ) is null then 'new'
    when now() - greatest(
      workouts.last_workout_at, client_notes.last_client_notes_at,
      progress.last_progress_entry_at, custom_exercises_authored.last_custom_exercise_at,
      goals.last_goal_activity_at, summaries.last_summary_published_at,
      assistant.last_assistant_message_at
    ) <= interval '7 days' then 'active'
    else 'not_active'
  end as trainer_status,
  coalesce(recent_activity.active_clients_7d, 0) as active_clients_7d,
  coalesce(recent_activity.workouts_done_7d_by_trainer, 0) as workouts_done_7d_by_trainer,
  coalesce(recent_activity.workouts_done_7d_by_client, 0) as workouts_done_7d_by_client,
  coalesce(client_growth.clients_added_7d, 0) as clients_added_7d,
  coalesce(client_growth.clients_added_30d, 0) as clients_added_30d,
  now() as refreshed_at
from public.trainers trainer
left join (
  select
    roster.trainer_id,
    count(*) as clients_total,
    count(*) filter (where roster.archived_at is not null) as clients_archived,
    count(*) filter (where roster.auth_user_id is not null) as clients_app_linked
  from (
    select client.trainer_id, client.id as client_id, client.archived_at, client.auth_user_id
    from public.clients client
    union
    select membership.trainer_id, client.id, client.archived_at, client.auth_user_id
    from public.client_trainers membership
    join public.clients client on client.id = membership.client_id
  ) roster
  group by roster.trainer_id
) clients on clients.trainer_id = trainer.profile_id
left join (
  select
    w.trainer_id,
    count(*) as workouts_total,
    count(*) filter (where w.status = 'planned') as workouts_planned,
    count(*) filter (where w.status = 'in_progress') as workouts_in_progress,
    count(*) filter (where w.status = 'done') as workouts_done,
    count(*) filter (where w.status = 'cancelled') as workouts_cancelled_total,
    max(w.updated_at) as last_workout_at
  from public.workouts w
  where w.deleted_at is null
  group by w.trainer_id
) workouts on workouts.trainer_id = trainer.profile_id
left join (
  select
    we.trainer_id,
    count(distinct case
      when we.exercise_source = 'system' then 'system:' || we.exercise_ref
      else 'custom:' || we.custom_exercise_id::text
    end) as exercises_unique_used
  from public.workout_exercises we
  join public.workouts w
    on w.id = we.workout_id and w.trainer_id = we.trainer_id and w.client_id = we.client_id
  where w.status = 'done' and w.deleted_at is null
  group by we.trainer_id
) exercises on exercises.trainer_id = trainer.profile_id
left join (
  select
    membership.trainer_id,
    count(*) filter (where membership.note is not null) as clients_with_notes_total,
    max(membership.updated_at) as last_client_notes_at
  from public.client_trainers membership
  group by membership.trainer_id
) client_notes on client_notes.trainer_id = trainer.profile_id
left join (
  select
    cp.trainer_id,
    count(*) as progress_entries_total,
    max(cp.updated_at) as last_progress_entry_at
  from public.client_progress cp
  where cp.deleted_at is null and cp.created_by = cp.trainer_id
  group by cp.trainer_id
) progress on progress.trainer_id = trainer.profile_id
left join (
  select
    ce.trainer_id,
    count(*) as custom_exercises_total,
    max(ce.updated_at) as last_custom_exercise_at
  from public.custom_exercises ce
  where ce.created_by = ce.trainer_id
  group by ce.trainer_id
) custom_exercises_authored on custom_exercises_authored.trainer_id = trainer.profile_id
left join (
  select
    cg.trainer_id,
    count(*) as goals_created_total,
    max(cg.updated_at) as last_goal_activity_at
  from public.client_goals cg
  where cg.created_by = cg.trainer_id
  group by cg.trainer_id
) goals on goals.trainer_id = trainer.profile_id
left join (
  select
    s.trainer_id,
    count(*) as summaries_published_total,
    max(s.published_at) as last_summary_published_at
  from public.client_published_training_summaries s
  where s.published_by = s.trainer_id
  group by s.trainer_id
) summaries on summaries.trainer_id = trainer.profile_id
left join (
  select
    c.owner_id as trainer_id,
    count(*) as assistant_messages_total,
    max(m.created_at) as last_assistant_message_at
  from public.assistant_messages m
  join public.assistant_conversations c on c.id = m.conversation_id
  where m.author = 'user'
  group by c.owner_id
) assistant on assistant.trainer_id = trainer.profile_id
left join (
  select profile_id, max(created_at) as last_sign_in_at
  from (
    select profile_id, created_at from app_private.yandex_app_sessions
    union all
    select profile_id, created_at from app_private.yandex_pilot_sessions
  ) all_sessions
  group by profile_id
) sign_ins on sign_ins.profile_id = trainer.profile_id
left join (
  select
    w.trainer_id,
    count(distinct w.client_id) as active_clients_7d,
    count(*) filter (where w.created_by is null or w.created_by = w.trainer_id) as workouts_done_7d_by_trainer,
    count(*) filter (where w.created_by is not null and w.created_by <> w.trainer_id) as workouts_done_7d_by_client
  from public.workouts w
  where w.status = 'done' and w.deleted_at is null and w.completed_at >= now() - interval '7 days'
  group by w.trainer_id
) recent_activity on recent_activity.trainer_id = trainer.profile_id
left join (
  select
    first_connections.trainer_id,
    count(*) filter (where first_connections.first_connected_at >= now() - interval '7 days') as clients_added_7d,
    count(*) filter (where first_connections.first_connected_at >= now() - interval '30 days') as clients_added_30d
  from (
    select sources.trainer_id, sources.client_id, min(sources.connected_at) as first_connected_at
    from (
      select client.trainer_id, client.id as client_id, client.created_at as connected_at
      from public.clients client
      union all
      select membership.trainer_id, client.id, membership.joined_at
      from public.client_trainers membership
      join public.clients client on client.id = membership.client_id
    ) sources
    group by sources.trainer_id, sources.client_id
  ) first_connections
  group by first_connections.trainer_id
) client_growth on client_growth.trainer_id = trainer.profile_id;

create view analytics.client_overview
with (security_barrier = true, security_invoker = false)
as
select
  c.id as client_id,
  c.created_at as registered_at,
  c.auth_user_id is not null and c.trainer_id = c.auth_user_id as is_self_registered,
  false as is_test_account,
  greatest(
    cw.last_client_workout_at, cp.last_client_progress_at, client_exercises.last_custom_exercise_at,
    client_goals_authored.last_goal_activity_at, questions.last_question_asked_at,
    connections.last_connection_change_at
  ) as last_client_activity_at,
  coalesce(wc.workouts_total, 0) as workouts_total,
  coalesce(wc.workouts_planned, 0) as workouts_planned,
  coalesce(wc.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(wc.workouts_done, 0) as workouts_done,
  coalesce(client_exercises.custom_exercises_total, 0) as custom_exercises_total,
  client_exercises.last_custom_exercise_at,
  coalesce(client_goals_authored.goals_created_total, 0) as goals_created_total,
  client_goals_authored.last_goal_activity_at,
  coalesce(questions.questions_asked_total, 0) as questions_asked_total,
  questions.last_question_asked_at,
  coalesce(connections.connection_changes_total, 0) as connection_changes_total,
  connections.last_connection_change_at,
  client_sign_ins.last_sign_in_at,
  floor(extract(epoch from (now() - greatest(
    cw.last_client_workout_at, cp.last_client_progress_at, client_exercises.last_custom_exercise_at,
    client_goals_authored.last_goal_activity_at, questions.last_question_asked_at,
    connections.last_connection_change_at
  ))) / 86400)::bigint as days_since_last_activity,
  case
    when greatest(
      cw.last_client_workout_at, cp.last_client_progress_at, client_exercises.last_custom_exercise_at,
      client_goals_authored.last_goal_activity_at, questions.last_question_asked_at,
      connections.last_connection_change_at
    ) is null then 'new'
    when now() - greatest(
      cw.last_client_workout_at, cp.last_client_progress_at, client_exercises.last_custom_exercise_at,
      client_goals_authored.last_goal_activity_at, questions.last_question_asked_at,
      connections.last_connection_change_at
    ) <= interval '7 days' then 'active'
    else 'not_active'
  end as client_status,
  now() as refreshed_at
from public.clients c
left join (
  select w.client_id, max(w.updated_at) as last_client_workout_at
  from public.workouts w
  join public.clients c2 on c2.id = w.client_id
  where w.deleted_at is null and c2.auth_user_id is not null
    and (w.status = 'done' or w.updated_by = c2.auth_user_id)
  group by w.client_id
) cw on cw.client_id = c.id
left join (
  select p.client_id, max(p.updated_at) as last_client_progress_at
  from public.client_progress p
  join public.clients c2 on c2.id = p.client_id
  where p.deleted_at is null and c2.auth_user_id is not null and p.created_by = c2.auth_user_id
  group by p.client_id
) cp on cp.client_id = c.id
left join (
  select w.client_id,
    count(*) as workouts_total,
    count(*) filter (where w.status = 'planned') as workouts_planned,
    count(*) filter (where w.status = 'in_progress') as workouts_in_progress,
    count(*) filter (where w.status = 'done') as workouts_done
  from public.workouts w
  where w.deleted_at is null
  group by w.client_id
) wc on wc.client_id = c.id
left join (
  select ce.created_by as auth_user_id,
    count(*) as custom_exercises_total,
    max(ce.updated_at) as last_custom_exercise_at
  from public.custom_exercises ce
  where ce.created_by is not null
  group by ce.created_by
) client_exercises on client_exercises.auth_user_id = c.auth_user_id
left join (
  select cg.created_by as auth_user_id,
    count(*) as goals_created_total,
    max(cg.updated_at) as last_goal_activity_at
  from public.client_goals cg
  where cg.created_by is not null
  group by cg.created_by
) client_goals_authored on client_goals_authored.auth_user_id = c.auth_user_id
left join (
  select w.client_id,
    count(*) as questions_asked_total,
    max(w.client_question_asked_at) as last_question_asked_at
  from public.workouts w
  where w.deleted_at is null and w.client_question_asked_at is not null
  group by w.client_id
) questions on questions.client_id = c.id
left join (
  select events.client_id,
    count(*) as connection_changes_total,
    max(events.event_at) as last_connection_change_at
  from (
    select r.client_id, r.connected_at as event_at
    from public.client_trainer_relationships r
    join public.clients c2 on c2.id = r.client_id
    where c2.auth_user_id is not null and r.connected_by = c2.auth_user_id
    union all
    select r.client_id, r.disconnected_at as event_at
    from public.client_trainer_relationships r
    join public.clients c2 on c2.id = r.client_id
    where c2.auth_user_id is not null and r.disconnected_by = c2.auth_user_id
  ) events
  group by events.client_id
) connections on connections.client_id = c.id
left join (
  select profile_id, max(created_at) as last_sign_in_at
  from (
    select profile_id, created_at from app_private.yandex_app_sessions
    union all
    select profile_id, created_at from app_private.yandex_pilot_sessions
  ) all_sessions
  group by profile_id
) client_sign_ins on client_sign_ins.profile_id = c.auth_user_id;

revoke all on analytics.trainer_overview, analytics.client_overview
  from public, fit_api;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    grant select on analytics.trainer_overview, analytics.client_overview to fit_datalens;
  end if;
end
$$;

-- Down Migration

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    revoke all on analytics.trainer_overview, analytics.client_overview from fit_datalens;
  end if;
end
$$;

revoke all on analytics.trainer_overview, analytics.client_overview
  from public, fit_api;

drop view analytics.trainer_overview;
drop view analytics.client_overview;

create view analytics.trainer_overview
with (security_barrier = true, security_invoker = false)
as
select
  trainer.profile_id as trainer_id,
  trainer.created_at as registered_at,
  coalesce(clients.clients_total, 0) as clients_total,
  coalesce(clients.clients_archived, 0) as clients_archived,
  coalesce(clients.clients_app_linked, 0) as clients_app_linked,
  false as is_test_account,
  coalesce(workouts.workouts_total, 0) as workouts_total,
  coalesce(workouts.workouts_planned, 0) as workouts_planned,
  coalesce(workouts.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(workouts.workouts_done, 0) as workouts_done,
  coalesce(exercises.exercises_unique_used, 0) as exercises_unique_used,
  workouts.last_workout_at,
  floor(extract(epoch from (now() - workouts.last_workout_at)) / 86400)::bigint
    as days_since_last_activity,
  case
    when workouts.last_workout_at is null then 'new'
    when now() - workouts.last_workout_at <= interval '7 days' then 'active'
    else 'not_active'
  end as trainer_status,
  now() as refreshed_at
from public.trainers trainer
left join (
  select
    client.trainer_id,
    count(*) as clients_total,
    count(*) filter (where client.archived_at is not null) as clients_archived,
    count(*) filter (where client.auth_user_id is not null) as clients_app_linked
  from public.clients client
  group by client.trainer_id
) clients on clients.trainer_id = trainer.profile_id
left join (
  select
    workout.trainer_id,
    count(*) as workouts_total,
    count(*) filter (where workout.status = 'planned') as workouts_planned,
    count(*) filter (where workout.status = 'in_progress') as workouts_in_progress,
    count(*) filter (where workout.status = 'done') as workouts_done,
    max(workout.updated_at) as last_workout_at
  from public.workouts workout
  where workout.deleted_at is null
  group by workout.trainer_id
) workouts on workouts.trainer_id = trainer.profile_id
left join (
  select
    exercise.trainer_id,
    count(distinct case
      when exercise.exercise_source = 'system'
        then 'system:' || exercise.exercise_ref
      else 'custom:' || exercise.custom_exercise_id::text
    end) as exercises_unique_used
  from public.workout_exercises exercise
  join public.workouts workout
    on workout.id = exercise.workout_id
      and workout.trainer_id = exercise.trainer_id
      and workout.client_id = exercise.client_id
  where workout.status = 'done' and workout.deleted_at is null
  group by exercise.trainer_id
) exercises on exercises.trainer_id = trainer.profile_id;

create view analytics.client_overview
with (security_barrier = true, security_invoker = false)
as
select
  client.id as client_id,
  client.created_at as registered_at,
  client.auth_user_id is not null
    and client.trainer_id = client.auth_user_id as is_self_registered,
  false as is_test_account,
  greatest(workouts.last_client_workout_at, progress.last_client_progress_at)
    as last_client_activity_at
from public.clients client
left join (
  select workout.client_id, max(workout.updated_at) as last_client_workout_at
  from public.workouts workout
  join public.clients owner on owner.id = workout.client_id
  where workout.deleted_at is null
    and owner.auth_user_id is not null
    and workout.updated_by = owner.auth_user_id
  group by workout.client_id
) workouts on workouts.client_id = client.id
left join (
  select item.client_id, max(item.updated_at) as last_client_progress_at
  from public.client_progress item
  join public.clients owner on owner.id = item.client_id
  where item.deleted_at is null
    and owner.auth_user_id is not null
    and item.created_by = owner.auth_user_id
  group by item.client_id
) progress on progress.client_id = client.id;

revoke all on analytics.trainer_overview, analytics.client_overview
  from public, fit_api;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    grant select on analytics.trainer_overview, analytics.client_overview to fit_datalens;
  end if;
end
$$;

drop trigger set_updated_at on public.client_trainers;

alter table public.client_trainers
  drop column updated_at;
