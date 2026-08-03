-- analytics.trainer_overview: удержание/активность тренера.
--
-- last_workout_at — последнее касание любой (не удалённой) тренировки любого
-- статуса, момент реальной активности тренера в продукте.
--
-- days_since_last_activity — целое число дней между моментом снапшота
-- (refreshed_at) и last_workout_at. null, если тренировок не было вообще.
--
-- trainer_status — согласованная бизнес-логика:
--   'new'        — тренировок не было вообще (last_workout_at is null)
--   'active'     — последняя активность не более 7 дней назад
--   'not_active' — активность была, но больше 7 дней назад
-- Порог (7 дней) и статус сознательно зашиты в SQL, а не оставлены на откуп
-- DataLens (в отличие от счётчиков вроде clients_total/clients_archived) —
-- явное решение ради простой фильтрации без calculated field. Изменить
-- порог в будущем можно только новой итерацией (drop + create), не правкой
-- дашборда.
--
-- Заодно: второй тестовый аккаунт (Knyaz187@mail.ru) добавлен в
-- is_test_account, сравнение переведено на lower(email) — защита от
-- несовпадения регистра между тем, что передано здесь, и тем, что реально
-- хранится в auth.users.
--
-- Matview пересоздаётся, поскольку PostgreSQL не поддерживает ALTER для неё
-- (см. 20260801130000). Materialized view не поддерживает CHECK-constraint'ы
-- — допустимые значения trainer_status фиксируются только этим комментарием
-- и тестом, не constraint'ом.

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
  from public.clients
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
  '10 2 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
