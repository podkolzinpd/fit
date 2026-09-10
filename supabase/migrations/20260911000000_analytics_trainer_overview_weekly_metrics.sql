-- analytics.trainer_overview: rolling-метрики "здоровья практики" тренера за
-- последние 7/30 дней, поверх кумулятивных счётчиков и last-touch активности
-- из YAFIT-500/477. Пересчитываются при каждом refresh (5 раз в день),
-- окно — "последние N дней от момента снапшота", не календарная неделя.
--
-- active_clients_7d — сколько клиентов тренера реально тренировались (status
-- = 'done') за последние 7 дней. Намеренно БЕЗ фильтра по актору: клиент,
-- у которого есть своё приложение и он подключён к тренеру, может провести
-- тренировку самостоятельно (self-service) — это всё равно тренировка ЭТОГО
-- клиента, метрика про вовлечённость клиентской базы, а не про то, кто нажал
-- кнопку "сохранить". См. обсуждение в этой же сессии при проектировании.
--
-- workouts_done_7d_by_trainer / workouts_done_7d_by_client — то же окно, но
-- с фильтром по актору (workouts.created_by, а не workouts.trainer_id —
-- последний лишь владение/scope, как и везде в схеме), потому что тут вопрос
-- другой: "сколько тренер лично провёл" против "сколько клиенты сделали
-- сами". created_by is null (легаси-строки до появления колонки) считаются
-- как тренерские — до self-service колонка не заполнялась вообще, так что
-- null исторически = тренер.
--
-- workouts_cancelled_total — статус 'cancelled' (см. 20260821010000: план,
-- который явно резолвнут как несостоявшийся, не притворяется выполненным и
-- не удаляется). Раньше в матвью не считался вообще — planned+in_progress+
-- done не сходится с workouts_total именно из-за него.
--
-- clients_added_7d/30d — рост ростера тренера (не просто снапшот clients_
-- total). Тот же union clients.trainer_id + client_trainers, что и в
-- clients_total (YAFIT-477), но с дедупом по min(момент подключения) —
-- если клиент виден в обеих ветках union с разными датами (root created_at
-- vs membership joined_at), берётся самая ранняя, чтобы не задвоить его в
-- окне и не потерять реальный момент появления.
--
-- Matview пересоздаётся, поскольку PostgreSQL не поддерживает ALTER для неё
-- (см. 20260801130000). Grant и cron-расписание переносятся без изменений.

drop materialized view analytics.trainer_overview;

create materialized view analytics.trainer_overview as
select
  t.profile_id as trainer_id,
  t.created_at as registered_at,
  coalesce(clients.clients_total, 0) as clients_total,
  coalesce(clients.clients_archived, 0) as clients_archived,
  coalesce(clients.clients_app_linked, 0) as clients_app_linked,
  lower(u.email) = any(array['test@test.com', 'knyaz187@mail.ru']) as is_test_account,
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
  u.last_sign_in_at,
  greatest(
    workouts.last_workout_at,
    client_notes.last_client_notes_at,
    progress.last_progress_entry_at,
    custom_exercises_authored.last_custom_exercise_at,
    goals.last_goal_activity_at,
    summaries.last_summary_published_at,
    assistant.last_assistant_message_at
  ) as last_active_at,
  floor(extract(epoch from (now() - greatest(
    workouts.last_workout_at,
    client_notes.last_client_notes_at,
    progress.last_progress_entry_at,
    custom_exercises_authored.last_custom_exercise_at,
    goals.last_goal_activity_at,
    summaries.last_summary_published_at,
    assistant.last_assistant_message_at
  ))) / 86400)::bigint as days_since_last_activity,
  case
    when greatest(
      workouts.last_workout_at,
      client_notes.last_client_notes_at,
      progress.last_progress_entry_at,
      custom_exercises_authored.last_custom_exercise_at,
      goals.last_goal_activity_at,
      summaries.last_summary_published_at,
      assistant.last_assistant_message_at
    ) is null then 'new'
    when now() - greatest(
      workouts.last_workout_at,
      client_notes.last_client_notes_at,
      progress.last_progress_entry_at,
      custom_exercises_authored.last_custom_exercise_at,
      goals.last_goal_activity_at,
      summaries.last_summary_published_at,
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
from public.trainers t
join auth.users u on u.id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as clients_total,
    count(*) filter (where archived_at is not null)::bigint as clients_archived,
    count(*) filter (where auth_user_id is not null)::bigint as clients_app_linked
  from (
    select client.trainer_id, client.id as client_id, client.archived_at, client.auth_user_id
    from public.clients client
    union
    select membership.trainer_id, client.id, client.archived_at, client.auth_user_id
    from public.client_trainers membership
    join public.clients client on client.id = membership.client_id
  ) roster
  group by trainer_id
) clients on clients.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as workouts_total,
    count(*) filter (where status = 'planned')::bigint as workouts_planned,
    count(*) filter (where status = 'in_progress')::bigint as workouts_in_progress,
    count(*) filter (where status = 'done')::bigint as workouts_done,
    count(*) filter (where status = 'cancelled')::bigint as workouts_cancelled_total,
    max(updated_at) as last_workout_at
  from public.workouts
  where deleted_at is null
  group by trainer_id
) workouts on workouts.trainer_id = t.profile_id
left join (
  select
    we.trainer_id,
    count(distinct case
      when we.exercise_source = 'system' then 'system:' || we.exercise_ref
      else 'custom:' || we.custom_exercise_id::text
    end)::bigint as exercises_unique_used
  from public.workout_exercises we
  join public.workouts w
    on w.id = we.workout_id and w.trainer_id = we.trainer_id and w.client_id = we.client_id
  where w.status = 'done'
    and w.deleted_at is null
  group by we.trainer_id
) exercises on exercises.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*) filter (where note is not null)::bigint as clients_with_notes_total,
    max(updated_at) as last_client_notes_at
  from public.client_private_details
  group by trainer_id
) client_notes on client_notes.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as progress_entries_total,
    max(updated_at) as last_progress_entry_at
  from public.client_progress
  where deleted_at is null
    and updated_by = trainer_id
  group by trainer_id
) progress on progress.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as custom_exercises_total,
    max(updated_at) as last_custom_exercise_at
  from public.custom_exercises
  where created_by = trainer_id
  group by trainer_id
) custom_exercises_authored on custom_exercises_authored.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as goals_created_total,
    max(updated_at) as last_goal_activity_at
  from public.client_goals
  where created_by = trainer_id
  group by trainer_id
) goals on goals.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as summaries_published_total,
    max(published_at) as last_summary_published_at
  from public.client_published_training_summaries
  where published_by = trainer_id
  group by trainer_id
) summaries on summaries.trainer_id = t.profile_id
left join (
  select
    c.owner_id as trainer_id,
    count(*)::bigint as assistant_messages_total,
    max(m.created_at) as last_assistant_message_at
  from public.assistant_messages m
  join public.assistant_conversations c on c.id = m.conversation_id
  where m.author = 'user'
  group by c.owner_id
) assistant on assistant.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(distinct client_id)::bigint as active_clients_7d,
    count(*) filter (where created_by is null or created_by = trainer_id)::bigint as workouts_done_7d_by_trainer,
    count(*) filter (where created_by is not null and created_by <> trainer_id)::bigint as workouts_done_7d_by_client
  from public.workouts
  where status = 'done'
    and deleted_at is null
    and completed_at >= now() - interval '7 days'
  group by trainer_id
) recent_activity on recent_activity.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*) filter (where first_connected_at >= now() - interval '7 days')::bigint as clients_added_7d,
    count(*) filter (where first_connected_at >= now() - interval '30 days')::bigint as clients_added_30d
  from (
    select trainer_id, client_id, min(connected_at) as first_connected_at
    from (
      select client.trainer_id, client.id as client_id, client.created_at as connected_at
      from public.clients client
      union all
      select membership.trainer_id, client.id, membership.joined_at
      from public.client_trainers membership
      join public.clients client on client.id = membership.client_id
    ) sources
    group by trainer_id, client_id
  ) first_connections
  group by trainer_id
) client_growth on client_growth.trainer_id = t.profile_id;

grant select on analytics.trainer_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-trainer-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
