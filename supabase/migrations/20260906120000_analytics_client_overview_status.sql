-- YAFIT-273-подобная итерация 5: удержание/активность клиента.
--
-- Точный перенос уже проверенного паттерна analytics.trainer_overview (см.
-- 20260803100000_analytics_trainer_overview_status.sql) на client_overview:
-- тот же порог (7 дней), та же трёхзначная классификация, тот же
-- refreshed_at-снапшот.
--
-- days_since_last_activity — целое число дней между моментом снапшота
-- (refreshed_at) и last_client_activity_at. null, если у клиента нет
-- собственной активности вообще (нет auth_user_id или он ни разу ничего
-- сам не редактировал — см. last_client_activity_at, добавлено в
-- 20260810040000 / уточнено в 20260817020000).
--
-- client_status — согласованная с trainer_status бизнес-логика:
--   'new'        — собственной активности не было вообще (last_client_activity_at is null)
--   'active'     — последняя активность не более 7 дней назад
--   'not_active' — активность была, но больше 7 дней назад
-- Порог и статус сознательно зашиты в SQL, а не оставлены на откуп
-- DataLens — как и в trainer_overview, изменить можно только новой
-- итерацией (drop + create), не правкой дашборда.
--
-- Matview пересоздаётся, PostgreSQL не поддерживает ALTER для неё (см.
-- 20260810030000). Materialized view не поддерживает CHECK-constraint'ы —
-- допустимые значения client_status фиксируются только этим комментарием
-- и тестом, не constraint'ом (см. также 20260803100000).

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
  coalesce(wc.workouts_done, 0) as workouts_done,
  floor(extract(epoch from (
    now() - greatest(cw.last_client_workout_at, cp.last_client_progress_at)
  )) / 86400)::bigint as days_since_last_activity,
  case
    when greatest(cw.last_client_workout_at, cp.last_client_progress_at) is null then 'new'
    when now() - greatest(cw.last_client_workout_at, cp.last_client_progress_at) <= interval '7 days' then 'active'
    else 'not_active'
  end as client_status,
  now() as refreshed_at
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
