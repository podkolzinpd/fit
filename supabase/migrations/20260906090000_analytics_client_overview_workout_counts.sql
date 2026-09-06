-- YAFIT-273, итерация 4: workouts_total/planned/in_progress/done для
-- analytics.client_overview.
--
-- Точный перенос уже проверенного паттерна analytics.trainer_overview (см.
-- 20260801130000) на per-client грейн: агрегат-подзапрос по client_id
-- (а не trainer_id) с тем же набором count(*) filter (where status = ...),
-- отфильтрованный по deleted_at is null. workouts_total считает ВСЕ
-- неудалённые тренировки клиента независимо от статуса (включая
-- 'cancelled') — так же, как в trainer_overview; отдельной колонки под
-- cancelled не заводим, т.к. её не запрашивали в этой итерации, и она
-- невелируется как total - planned - in_progress - done при необходимости.
--
-- coalesce(..., 0) — клиент без единой тренировки должен получить нули,
-- а не null, так же как clients_total/clients_archived в trainer_overview.
--
-- Matview пересоздаётся, PostgreSQL не поддерживает ALTER для неё (см.
-- 20260810030000).

drop materialized view analytics.client_overview;

create materialized view analytics.client_overview as
select
  c.id as client_id,
  c.created_at as registered_at,
  (c.auth_user_id is not null and c.trainer_id = c.auth_user_id) as is_self_registered,
  lower(u.email) = any(array['test@test.com', 'knyaz187@mail.ru']) as is_test_account,
  greatest(cw.last_client_workout_at, cp.last_client_progress_at) as last_client_activity_at,
  coalesce(wc.workouts_total, 0) as workouts_total,
  coalesce(wc.workouts_planned, 0) as workouts_planned,
  coalesce(wc.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(wc.workouts_done, 0) as workouts_done
from public.clients c
join auth.users u on u.id = c.trainer_id
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
) wc on wc.client_id = c.id;

grant select on analytics.client_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-client-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.client_overview$$
);
