-- analytics.client_overview: last_client_activity_at считался только по
-- двум категориям (самостоятельная тренировка, свой замер). Расширяем тем же
-- принципом, что уже применён в analytics.trainer_overview (YAFIT-500):
-- считаем только действия, реальным актором которых был сам клиент —
-- created_by/updated_by/connected_by/disconnected_by = clients.auth_user_id,
-- а не owner/partition-колонки вроде trainer_id.
--
-- custom_exercises_total/last_custom_exercise_at — свои упражнения.
-- custom_exercises не имеет client_id вообще (это запись в каталоге, а не
-- дочерняя сущность клиента) — только trainer_id (partition owner, для
-- standalone-клиента без тренера может быть равен его же profile id) и
-- created_by (реальный актор). Поэтому join идёт напрямую по
-- created_by = c.auth_user_id, а не через trainer_id/client_id — это не
-- зависит от того, как именно устроено партиционирование.
--
-- goals_created_total/last_goal_activity_at — свои цели (client_goals,
-- фильтр created_by, см. client_goal_self_service).
--
-- questions_asked_total/last_question_asked_at — вопрос тренеру после
-- тренировки (workouts.client_question_asked_at). У этого поля нет
-- отдельного actor-столбца, но по смыслу фичи оно может быть заполнено
-- только из клиентского post-workout feedback flow.
--
-- connection_changes_total/last_connection_change_at — client_trainer_
-- relationships.connected_at/disconnected_at, каждое СВОИМ отдельным
-- actor-фильтром (connected_by / disconnected_by), а не общим OR на всю
-- строку: trainer тоже может инициировать отключение через отдельный RPC
-- (см. disconnect_selected_trainer), и такое disconnected_at не должно
-- задвоиться в клиентскую активность просто потому, что тот же ряд когда-то
-- содержал client-инициированный connect.
--
-- last_sign_in_at — auth.users через c.auth_user_id (не через
-- c.trainer_id, как у существующего join `u` для is_test_account/email
-- тренера) — отдельная колонка, вход в приложение не равно продуктовая
-- активность, по аналогии с trainer_overview.
--
-- Matview пересоздаётся, PostgreSQL не поддерживает ALTER для неё (см.
-- 20260810030000). Grant и cron-расписание переносятся без изменений.

drop materialized view analytics.client_overview;

create materialized view analytics.client_overview as
select
  c.id as client_id,
  c.created_at as registered_at,
  (c.auth_user_id is not null and c.trainer_id = c.auth_user_id) as is_self_registered,
  lower(u.email) = any(array['test@test.com', 'knyaz187@mail.ru']) as is_test_account,
  greatest(
    cw.last_client_workout_at,
    cp.last_client_progress_at,
    client_exercises.last_custom_exercise_at,
    client_goals_authored.last_goal_activity_at,
    questions.last_question_asked_at,
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
  client_auth.last_sign_in_at,
  floor(extract(epoch from (
    now() - greatest(
      cw.last_client_workout_at,
      cp.last_client_progress_at,
      client_exercises.last_custom_exercise_at,
      client_goals_authored.last_goal_activity_at,
      questions.last_question_asked_at,
      connections.last_connection_change_at
    )
  )) / 86400)::bigint as days_since_last_activity,
  case
    when greatest(
      cw.last_client_workout_at,
      cp.last_client_progress_at,
      client_exercises.last_custom_exercise_at,
      client_goals_authored.last_goal_activity_at,
      questions.last_question_asked_at,
      connections.last_connection_change_at
    ) is null then 'new'
    when now() - greatest(
      cw.last_client_workout_at,
      cp.last_client_progress_at,
      client_exercises.last_custom_exercise_at,
      client_goals_authored.last_goal_activity_at,
      questions.last_question_asked_at,
      connections.last_connection_change_at
    ) <= interval '7 days' then 'active'
    else 'not_active'
  end as client_status,
  now() as refreshed_at
from public.clients c
join auth.users u on u.id = c.trainer_id
left join auth.users client_auth on client_auth.id = c.auth_user_id
left join (
  select w.client_id, max(w.updated_at) as last_client_workout_at
  from public.workouts w
  join public.clients c2 on c2.id = w.client_id
  where w.deleted_at is null
    and c2.auth_user_id is not null
    and w.updated_by = c2.auth_user_id
  group by w.client_id
) cw on cw.client_id = c.id
left join (
  select p.client_id, max(p.updated_at) as last_client_progress_at
  from public.client_progress p
  join public.clients c2 on c2.id = p.client_id
  where p.deleted_at is null
    and c2.auth_user_id is not null
    and p.updated_by = c2.auth_user_id
  group by p.client_id
) cp on cp.client_id = c.id
left join (
  select
    client_id,
    count(*)::bigint as workouts_total,
    count(*) filter (where status = 'planned')::bigint as workouts_planned,
    count(*) filter (where status = 'in_progress')::bigint as workouts_in_progress,
    count(*) filter (where status = 'done')::bigint as workouts_done
  from public.workouts
  where deleted_at is null
  group by client_id
) wc on wc.client_id = c.id
left join (
  select
    created_by as auth_user_id,
    count(*)::bigint as custom_exercises_total,
    max(updated_at) as last_custom_exercise_at
  from public.custom_exercises
  where created_by is not null
  group by created_by
) client_exercises on client_exercises.auth_user_id = c.auth_user_id
left join (
  select
    created_by as auth_user_id,
    count(*)::bigint as goals_created_total,
    max(updated_at) as last_goal_activity_at
  from public.client_goals
  where created_by is not null
  group by created_by
) client_goals_authored on client_goals_authored.auth_user_id = c.auth_user_id
left join (
  select
    client_id,
    count(*)::bigint as questions_asked_total,
    max(client_question_asked_at) as last_question_asked_at
  from public.workouts
  where deleted_at is null
    and client_question_asked_at is not null
  group by client_id
) questions on questions.client_id = c.id
left join (
  select client_id, count(*)::bigint as connection_changes_total, max(event_at) as last_connection_change_at
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
  group by client_id
) connections on connections.client_id = c.id;

grant select on analytics.client_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-client-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.client_overview$$
);
