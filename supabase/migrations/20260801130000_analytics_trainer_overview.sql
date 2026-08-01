-- Расширение канала бизнес-метрик (см. 20260727000800): широкая матвью
-- analytics.trainer_overview, агрегированная по trainer_id, которую
-- наращиваем колонками итеративно. У matview нет ALTER ADD COLUMN и
-- CREATE OR REPLACE MATERIALIZED VIEW — каждая следующая итерация будет
-- делать drop + create заново под тем же именем, поэтому имя матвью и имя
-- cron-job остаются стабильными между итерациями.
--
-- clients и workouts агрегируются каждая в своём подзапросе (group by
-- trainer_id) ДО join к trainers — если джойнить их сырые строки напрямую
-- и группировать на верхнем уровне, count(*) даёт декартово произведение
-- (клиенты × тренировки на тренера) и завышенные числа. Этот паттерн
-- (агрегат-подзапрос -> left join по trainer_id) сохраняем для всех
-- будущих колонок из новых исходных таблиц.
--
-- Тестовый тренерский аккаунт test@test.com (см. память
-- project-prod-test-trainer-login — им создают тестовые данные на проде)
-- не исключается из выборки, а помечается is_test_account = true: пусть
-- DataLens сам решает, включать его в отчёт или фильтровать, а не терять
-- данные молча. Список тестовых email добавляем в массив по мере
-- появления новых аккаунтов.

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
  coalesce(exercises.exercises_unique_used, 0) as exercises_unique_used
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
