-- YAFIT-299: переналожение updated_by-контракта поверх текущего main (см. supabase/migrations/20260817010000_redo_live_workout_progress_updated_by.sql).

-- analytics.client_overview: точное last_client_activity_at через updated_by.
--
-- Итерация 2 (20260810040000) определяла активность клиента приближённо:
-- "запись клиентская, если её создал клиент" (created_by = auth_user_id),
-- потому что схема не умела отличать "клиент создал" от "клиент последний
-- раз редактировал". Явно зафиксированное тогда ограничение: тренер,
-- отредактировавший клиентскую запись, двигал updated_at, но не менял
-- created_by — активность ошибочно приписывалась клиенту.
--
-- Теперь (20260811010000) в workouts и client_progress есть updated_by —
-- кто последний раз реально редактировал запись, явно проставляется в
-- каждом мутирующем RPC. Заменяем created_by на updated_by в условии:
-- last_client_activity_at считается только по записям, которые клиент
-- САМ последний раз редактировал, независимо от того, кто их создал.
--
-- Побочный эффект перехода: у строк, созданных/отредактированных ДО
-- миграции 20260811010000, updated_by = null (историю не восстановить) —
-- такие записи временно выпадают из подсчёта, пока клиент их не тронет
-- снова. Это ожидаемо и симметрично тому, как уже принято ограничение
-- created_by в прошлой итерации — новое поле не может знать прошлое.
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
) cp on cp.client_id = c.id;

grant select on analytics.client_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-client-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.client_overview$$
);
