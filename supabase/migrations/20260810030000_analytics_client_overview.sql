-- Новый канал бизнес-метрик по клиентам, аналог analytics.trainer_overview
-- (см. 20260801130000 и далее) — тот же паттерн: широкая матвью, одна строка
-- на клиента, наращивается колонками итеративно.
--
-- Итерация 1 — 4 базовых столбца:
--   client_id, registered_at, is_self_registered, is_test_account
--
-- is_self_registered: clients.trainer_id — владелец партиции. У
-- self-service клиента (create_own_client, standalone_client_card.sql) он
-- равен собственному auth_user_id/actor_id. У клиента, заведённого
-- тренером (create_quick_client), trainer_id — id тренера, отличный от
-- auth_user_id клиента даже после привязки инвайта. Явное
-- "is not null and ... = ..." вместо голого сравнения — чтобы клиент без
-- auth_user_id получил false, а не null в булевой колонке.
--
-- is_test_account: по email владельца партиции (trainer_id -> auth.users),
-- та же логика и тот же список тестовых email, что в trainer_overview —
-- работает единообразно для self-registered (владелец = он сам) и обычных
-- клиентов (владелец = реальный тренер).
--
-- Архивные клиенты не фильтруются — остаются строкой, как и тестовые
-- аккаунты: флаг, а не молчаливая потеря данных.

create materialized view analytics.client_overview as
select
  c.id as client_id,
  c.created_at as registered_at,
  (c.auth_user_id is not null and c.trainer_id = c.auth_user_id) as is_self_registered,
  lower(u.email) = any(array['test@test.com', 'knyaz187@mail.ru']) as is_test_account
from public.clients c
join auth.users u on u.id = c.trainer_id;

grant select on analytics.client_overview to datalens_reader;

select cron.schedule(
  'refresh-analytics-client-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.client_overview$$
);
