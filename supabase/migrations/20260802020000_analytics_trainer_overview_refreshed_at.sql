-- Итерация 2 analytics.trainer_overview (см. 20260801130000): добавляем
-- refreshed_at — момент последнего REFRESH MATERIALIZED VIEW, одинаковый
-- для всех строк снапшота. now() в определении matview фиксируется на
-- момент CREATE/REFRESH и не меняется до следующего рефреша — то есть это
-- ровно "когда данные в этой таблице последний раз обновлялись", не время
-- запроса к ней.
--
-- У matview нет ALTER ADD COLUMN и CREATE OR REPLACE MATERIALIZED VIEW —
-- поэтому drop + create заново под тем же именем, имя матвью и cron-job
-- остаются стабильными между итерациями (см. комментарий в 20260801130000).

drop materialized view analytics.trainer_overview;

create materialized view analytics.trainer_overview as
select
  t.profile_id as trainer_id,
  t.created_at as registered_at,
  coalesce(clients.clients_total, 0) as clients_total,
  coalesce(clients.clients_archived, 0) as clients_archived,
  coalesce(clients.clients_app_linked, 0) as clients_app_linked,
  u.email = any(array['test@test.com']) as is_test_account,
  coalesce(workouts.workouts_total, 0) as workouts_total,
  coalesce(workouts.workouts_planned, 0) as workouts_planned,
  coalesce(workouts.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(workouts.workouts_done, 0) as workouts_done,
  coalesce(exercises.exercises_unique_used, 0) as exercises_unique_used,
  now() as refreshed_at
from public.trainers t
join auth.users u on u.id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as clients_total,
    count(*) filter (where archived_at is not null)::bigint as clients_archived,
    count(*) filter (where auth_user_id is not null)::bigint as clients_app_linked
  from public.clients
  group by trainer_id
) clients on clients.trainer_id = t.profile_id
left join (
  select
    trainer_id,
    count(*)::bigint as workouts_total,
    count(*) filter (where status = 'planned')::bigint as workouts_planned,
    count(*) filter (where status = 'in_progress')::bigint as workouts_in_progress,
    count(*) filter (where status = 'done')::bigint as workouts_done
  from public.workouts
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
  group by we.trainer_id
) exercises on exercises.trainer_id = t.profile_id;

grant select on analytics.trainer_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-trainer-overview',
  '10 2 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
