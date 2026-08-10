-- analytics.client_overview: активность самого клиента (итерация 2).
--
-- last_client_activity_at — greatest(max(workouts.updated_at),
-- max(client_progress.updated_at)) СРЕДИ ЗАПИСЕЙ, КОТОРЫЕ СОЗДАЛ САМ
-- КЛИЕНТ (created_by = clients.auth_user_id), не тренер и не другой
-- подключённый тренер. Осознанно НЕ "любое касание записи клиента" (как
-- last_workout_at у trainer_overview) — цель этой колонки именно
-- собственная активность пользователя-клиента в приложении.
--
-- Известное ограничение данных: в схеме нет поля "кто последнее трогал
-- запись", только created_by (кто создал) и общее updated_at (когда
-- трогали, кем угодно). Если клиент сам завёл тренировку, а тренер потом
-- её отредактировал — updated_at подвинется от действия тренера, хотя
-- created_by останется клиентским. Это лучшее приближение на текущей
-- схеме, осознанно принятое как есть.
--
-- null у клиента без auth_user_id (бумажный клиент) — у него по
-- определению нет собственной активности в приложении.
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
  greatest(cw.last_client_workout_at, cp.last_client_progress_at) as last_client_activity_at
from public.clients c
join auth.users u on u.id = c.trainer_id
left join (
  select w.client_id, max(w.updated_at) as last_client_workout_at
  from public.workouts w
  join public.clients c2 on c2.id = w.client_id
  where w.deleted_at is null
    and c2.auth_user_id is not null
    and w.created_by = c2.auth_user_id
  group by w.client_id
) cw on cw.client_id = c.id
left join (
  select p.client_id, max(p.updated_at) as last_client_progress_at
  from public.client_progress p
  join public.clients c2 on c2.id = p.client_id
  where p.deleted_at is null
    and c2.auth_user_id is not null
    and p.created_by = c2.auth_user_id
  group by p.client_id
) cp on cp.client_id = c.id;

grant select on analytics.client_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-client-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.client_overview$$
);
