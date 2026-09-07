-- analytics.trainer_overview: clients_total/clients_archived/clients_app_linked
-- считались только по public.clients.trainer_id (корневой тренер клиента) и
-- теряли клиентов, подключившихся к тренеру самостоятельно через отдельную
-- membership-таблицу public.client_trainers (клиент видит тренера в своём
-- профиле как «Подключённый тренер», но его clients.trainer_id при этом
-- указывает на другого — обычно того, кто изначально завёл карточку).
--
-- public.list_clients() (см. 20260802013000) уже считает ростер тренера
-- именно так — client.trainer_id = actor_id or membership.trainer_id is not
-- null — эта миграция приводит матвью к тому же определению клиента «у
-- тренера сейчас», чтобы аналитика не расходилась с тем, что тренер видит в
-- приложении.
--
-- Изменился только источник для clients-агрегата: делаем один набор
-- (trainer_id, client_id) как UNION корневых и membership-строк (UNION, а не
-- UNION ALL — если у клиента когда-либо появится client_trainers-запись с
-- тем же trainer_id, что и корневой, дубликат схлопнется), затем агрегируем
-- по trainer_id как раньше. workouts/exercises не трогаем — они уже считаются
-- по собственному workouts.trainer_id на каждой тренировке, а не через
-- clients.trainer_id, так что фан-аут на разных тренеров одного клиента там
-- уже работал верно.
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
  floor(extract(epoch from (now() - workouts.last_workout_at)) / 86400)::bigint as days_since_last_activity,
  case
    when workouts.last_workout_at is null then 'new'
    when now() - workouts.last_workout_at <= interval '7 days' then 'active'
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
) exercises on exercises.trainer_id = t.profile_id;

grant select on analytics.trainer_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-trainer-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
