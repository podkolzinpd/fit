-- analytics.trainer_overview: last_workout_at/trainer_status считались только
-- по public.workouts и теряли тренеров, которые реально пользуются
-- приложением (ведут клиентов, ставят цели, делают замеры, публикуют
-- AI-сводки, пишут ассистенту), но в моменте снапшота не трогали ни одну
-- тренировку. Добавляем детальный breakdown по 7 категориям активности —
-- у каждой count (сколько раз/объектов) и last-touch timestamp — чтобы
-- DataLens видел не только общий скор, но и каким именно функционалом
-- пользуется тренер, плюс отдельный last_sign_in_at (факт входа — не то же
-- самое, что продуктовая активность, поэтому не входит в last_active_at).
--
-- Ключевое правило, из-за которого категории не сведены к простому
-- `trainer_id = t.profile_id` по каждой таблице: в схеме `trainer_id` почти
-- везде — это владение/scope записи, а не актор. У части фич есть
-- self-service путь для клиента (свои замеры, свои упражнения, свои цели),
-- поэтому реальный актор берётся из `created_by`/`updated_by`, иначе
-- активность клиента задвоилась бы как активность тренера:
--   * client_progress.updated_by, custom_exercises.created_by,
--     client_goals.created_by — колонки актора есть, фильтруем по ним.
--   * client_private_details — данные видит только тренер (клиент их не
--     видит вообще), поэтому вся таблица однозначно тренерская без
--     дополнительного фильтра. Строка создаётся эагерли на каждого клиента
--     (см. 20260721000400_rpc.sql), поэтому count фильтруется по `note is
--     not null`, а last-touch берётся по всей таблице — updated_at
--     обновляется той же RPC при любой правке карточки клиента, не только
--     заметки.
--   * client_published_training_summaries.published_by — FK жёстко на
--     public.trainers, клиент публиковать не может в принципе, фильтр не
--     нужен по смыслу, но пишем явно для симметрии с остальными.
--   * assistant_messages — маршрут /assistant защищён TrainerOnly guard'ом
--     (клиентского ассистента нет), но сама LLM тоже пишет строки
--     (author='assistant') — фильтруем author='user', чтобы считать
--     реплики тренера, а не ответы модели.
-- goal_stages сознательно не считаются отдельно — этапы клиент может вести
-- самостоятельно, а колонки актора там нет.
--
-- last_active_at = greatest() по last-touch всех категорий (postgres
-- greatest() игнорирует NULL и возвращает NULL только если абсолютно все
-- аргументы NULL — то же поведение, что раньше было только у
-- last_workout_at). trainer_status/days_since_last_activity считаются от
-- last_active_at вместо last_workout_at, порог активности (7 дней) не
-- меняется.
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
) assistant on assistant.trainer_id = t.profile_id;

grant select on analytics.trainer_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-trainer-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
