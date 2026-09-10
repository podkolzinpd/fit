begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'trainer_overview'),
  'analytics.trainer_overview matview exists'
);
select ok(
  has_table_privilege('datalens_reader', 'analytics.trainer_overview', 'SELECT'),
  'datalens_reader has select on analytics.trainer_overview'
);
select is(
  (select schedule from cron.job where jobname = 'refresh-analytics-trainer-overview'),
  '0 2,7,12,17,21 * * *',
  'refresh job runs 5x/day at 05:00/10:00/15:00/20:00/00:00 MSK (02/07/12/17/21 UTC)'
);

-- Тренер 1: 3 клиента (1 архивный, 1 app-linked) и 3 тренировки на одном
-- клиенте — planned/in_progress/done, чтобы проверить все агрегаты сразу.
-- Тренер 4 — недавняя активность (updated_at = now() - 2 дня), проверяет
-- trainer_status = 'active'. Тренер 5 — второй тестовый аккаунт
-- (Knyaz187@mail.ru, смешанный регистр) для is_test_account/lower().
insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-a@example.test', ''),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-b@example.test', ''),
  ('60000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@test.com', ''),
  ('60000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-d@example.test', ''),
  ('60000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Knyaz187@mail.ru', ''),
  ('60000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-client@example.test', ''),
  ('60000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-client2@example.test', '');
insert into public.profiles (id) values
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002'),
  ('60000000-0000-4000-8000-000000000003'),
  ('60000000-0000-4000-8000-000000000004'),
  ('60000000-0000-4000-8000-000000000005');
insert into public.trainers (profile_id, created_at) values
  ('60000000-0000-4000-8000-000000000001', '2026-07-01'),
  ('60000000-0000-4000-8000-000000000002', '2026-07-02'),
  ('60000000-0000-4000-8000-000000000003', '2026-07-03'),
  ('60000000-0000-4000-8000-000000000004', '2026-07-20'),
  ('60000000-0000-4000-8000-000000000005', '2026-07-21');
-- Профиль клиента 0009 нужен отдельно (не только auth.users) — он играет
-- роль self-service актора в регрессионных фикстурах ниже (client_progress.
-- updated_by/custom_exercises.created_by ссылаются на public.profiles).
insert into public.profiles (id) values ('60000000-0000-4000-8000-000000000009');

insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm, created_at) values
  ('61000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004', 'Overview Recent', 'female', 29, 168, '2026-07-20');
insert into public.workouts (id, trainer_id, client_id, workout_date, status, updated_at) values
  ('63000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000004', '2026-07-20', 'planned', now() - interval '2 days');

insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm, archived_at, created_at) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', 'Overview Active', 'female', 30, 170, null, '2026-07-10'),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', null, 'Overview Archived', 'male', 31, 180, '2026-07-11', '2026-07-11'),
  ('61000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', null, 'Overview Paper', 'female', 32, 165, null, '2026-07-12'),
  ('62000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', null, 'Test Trainer Client', 'female', 33, 160, null, '2026-07-13');

-- Клиент "Overview Connected": корневой тренер 4, но сам подключился ещё и к
-- тренеру 1 (member-строка в client_trainers, без смены root) — та же схема,
-- по которой клиенты видят "Подключённый тренер" в своём профиле. Должен
-- попасть в clients_total обоих тренеров. Заодно у существующего клиента
-- 61...0001 добавляется избыточная client_trainers-строка на его же root
-- (60...001) — проверяет, что UNION схлопывает дубликат и не считает клиента
-- дважды на одного тренера.
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm, created_at) values
  ('61000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000010', 'Overview Connected', 'female', 27, 165, '2026-07-21');
insert into public.client_trainers (client_id, trainer_id) values
  ('61000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001');

-- updated_at задан явно (а не оставлен на default now()), чтобы
-- last_workout_at/days_since_last_activity/trainer_status были
-- детерминированы. Удалённая тренировка (63...0004) получает самый
-- поздний updated_at из всех — проверяет, что last_workout_at её
-- игнорирует (наравне с уже существующим фильтром deleted_at is null
-- для остальных агрегатов).
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, completed_at, updated_at) values
  ('63000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-15', 'planned', null, null, '2026-07-14 09:00:00+00'),
  ('63000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-16', 'in_progress', '2026-07-16 10:00:00+00', null, '2026-07-15 09:00:00+00'),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-17', 'done', '2026-07-17 10:00:00+00', '2026-07-17 11:00:00+00', '2026-07-16 09:00:00+00');

insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, completed_at, deleted_at, updated_at) values
  ('63000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-18', 'done', '2026-07-18 10:00:00+00', '2026-07-18 11:00:00+00', '2026-07-18 12:00:00+00', '2026-07-20 00:00:00+00');

insert into public.workout_exercises (workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('63000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'lunge', 'Lunge', 'legs', 'reps'),
  ('63000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'deadlift', 'Deadlift', 'back', 'strength'),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'squat', 'Squat', 'legs', 'strength'),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, 'system', 'bench_press', 'Bench Press', 'chest', 'strength'),
  ('63000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'deadlift', 'Deadlift', 'back', 'strength');

-- Активность тренера 1 вне тренировок — по одной фикстуре на каждую новую
-- категорию. Где у фичи есть self-service путь для клиента (замеры, свои
-- упражнения), добавляется вторая, более поздняя по времени строка с
-- актором-клиентом (0009) — она обязана НЕ попасть в total/last_*_at,
-- иначе фильтр по created_by/updated_by не отличает тренера от клиента.
insert into public.client_private_details (client_id, trainer_id, note, updated_at) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Trainer note', '2026-07-19 00:00:00+00'),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', null, '2026-07-20 00:00:00+00');

insert into public.client_progress (id, trainer_id, client_id, recorded_on, updated_by, updated_at) values
  ('64000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-18', '60000000-0000-4000-8000-000000000001', '2026-07-18 12:00:00+00'),
  ('64000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-25', '60000000-0000-4000-8000-000000000009', '2026-07-25 12:00:00+00');

insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind, updated_at) values
  ('65000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Trainer Exercise', 'legs', 'reps', '2026-07-18 08:00:00+00'),
  ('65000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', 'Client Exercise', 'legs', 'reps', '2026-07-26 08:00:00+00');

insert into public.client_goals (id, client_id, trainer_id, created_by, title, updated_at) values
  ('66000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Goal', '2026-07-19 09:00:00+00');

insert into public.client_training_summaries (
  id, trainer_id, client_id, period_start, period_end, summary, trainer_summary, client_summary, model_uri, prompt_version, input_fingerprint
) values (
  '67000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001',
  '2026-07-01', '2026-07-31', 'Progress summary', '{}', '{}', 'gpt://folder/yandexgpt-lite/latest', 'training-summary-v1', 'fingerprint'
);
insert into public.client_published_training_summaries (
  id, source_summary_id, trainer_id, client_id, period_start, period_end, summary, display_metrics, generated_at, published_at, published_by
) values (
  '67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001',
  '2026-07-01', '2026-07-31', '{}', '{}', '2026-07-19 10:00:00+00', '2026-07-19 10:00:00+00', '60000000-0000-4000-8000-000000000001'
);

insert into public.assistant_conversations (id, owner_id) values
  ('68000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001');
insert into public.assistant_messages (id, conversation_id, author, content, created_at) values
  ('69000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'user', 'Запиши тренировку', '2026-07-19 11:00:00+00'),
  ('69000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000001', 'assistant', 'Готово', '2026-07-19 12:00:00+00');

update auth.users set last_sign_in_at = '2026-07-21 08:00:00+00' where id = '60000000-0000-4000-8000-000000000001';

-- Тренер 5: ключевой регрессионный сценарий всей миграции — активность есть
-- ТОЛЬКО в одной не-тренировочной категории (ноль клиентов, ноль тренировок),
-- и это уже обязано поднимать trainer_status до 'active'.
insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind, updated_at) values
  ('65000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000005', 'Trainer5 Exercise', 'legs', 'reps', now() - interval '1 day');

-- YAFIT-506: недельные rolling-метрики. Новый клиент трейнера 1 (root,
-- created_at = now() - 5 дней) — тестирует clients_added_* через путь
-- "новый клиент завёл тренер". Второй путь — уже существующая
-- membership-строка 61...0005 (client_trainers, joined_at по умолчанию =
-- now() текущей транзакции) — тестирует путь "клиент подключился сам",
-- без новой фикстуры. Редундантная membership-строка на 61...0001 (root
-- created_at 2026-07-10, давно) обязана НЕ протечь в clients_added_* —
-- min(created_at, joined_at) должен взять более раннюю дату root-связи.
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm, created_at) values
  ('61000000-0000-4000-8000-000000000006', '60000000-0000-4000-8000-000000000001', 'Overview New', 'female', 26, 170, now() - interval '5 days');

-- Явно резолвнутый несостоявшийся план (не удалён, не притворяется
-- выполненным) — updated_at зафиксирован старой датой, чтобы не сдвинуть
-- last_workout_at/last_active_at/trainer_status, уже проверенные выше.
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, completed_at, updated_at) values
  ('63000000-0000-4000-8000-000000000006', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-13', 'cancelled', null, null, '2026-07-13 08:00:00+00');

-- Три тренировки "на этой неделе" (completed_at в пределах последних 7
-- дней от реального now() на момент прогона теста) — updated_at всё равно
-- зафиксирован старой датой по той же причине, что и выше.
-- 0007 — провёл тренер (created_by = trainer_id); 0008 — self-service
-- клиента (created_by = его собственный auth id, тот же клиент 61...0001,
-- чтобы проверить, что active_clients_7d считает клиента один раз, а не
-- дважды); 0009 — легаси-строка без актора (created_by is null) на другом
-- клиенте — должна засчитаться тренеру по умолчанию.
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, completed_at, created_by, updated_at) values
  ('63000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-12', 'done', now() - interval '1 day' - interval '1 hour', now() - interval '1 day', '60000000-0000-4000-8000-000000000001', '2026-07-12 08:00:00+00'),
  ('63000000-0000-4000-8000-000000000008', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-11', 'done', now() - interval '2 days' - interval '1 hour', now() - interval '2 days', '60000000-0000-4000-8000-000000000009', '2026-07-11 08:00:00+00'),
  ('63000000-0000-4000-8000-000000000009', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', '2026-07-10', 'done', now() - interval '3 days' - interval '1 hour', now() - interval '3 days', null, '2026-07-10 08:00:00+00');

refresh materialized view analytics.trainer_overview;

select is(
  (select count(*)::bigint from analytics.trainer_overview),
  (select count(*)::bigint from public.trainers),
  'row count matches live count(*) from public.trainers (test account included as a row)'
);

select is(
  (select registered_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  (select created_at from public.trainers where profile_id = '60000000-0000-4000-8000-000000000001'),
  'registered_at matches trainers.created_at'
);

select is(
  (select clients_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  5::bigint, 'clients_total includes archived clients, the client connected via client_trainers (root trainer is 4), and the newly created Overview New client; the redundant client_trainers row on the root client does not double-count'
);
select is(
  (select clients_archived from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'clients_archived counts archived_at is not null'
);
select is(
  (select clients_app_linked from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'clients_app_linked counts auth_user_id is not null, including the client connected via client_trainers'
);
select is(
  (select clients_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  2::bigint, 'clients_total for the root trainer of the shared client still counts it once (Overview Recent + Overview Connected)'
);
select is(
  (select clients_archived from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  0::bigint, 'clients_archived for trainer 4 unaffected by the shared client'
);
select is(
  (select clients_app_linked from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  1::bigint, 'clients_app_linked for trainer 4 counts only the shared client (its own root client has no auth_user_id)'
);
select is(
  (select workouts_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  1::bigint, 'workouts_total for trainer 4 is unaffected by the roster UNION (Overview Connected has no workouts)'
);

select is(
  (select workouts_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  7::bigint, 'workouts_total ignores the deleted workout, avoids a cartesian product with clients, and includes the cancelled workout plus the 3 this-week done workouts'
);
select is(
  (select workouts_planned from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_planned'
);
select is(
  (select workouts_in_progress from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_in_progress'
);
select is(
  (select workouts_done from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  4::bigint, 'workouts_done includes the original done workout plus the 3 new this-week done workouts'
);
select ok(
  (select workouts_planned + workouts_in_progress + workouts_done + workouts_cancelled_total = workouts_total
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  'status breakdown (including cancelled) sums to workouts_total'
);
select is(
  (select workouts_cancelled_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_cancelled_total counts the explicitly resolved-as-cancelled workout'
);

select is(
  (select exercises_unique_used from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'exercises_unique_used only counts active done workouts (squat, bench_press)'
);

select is(
  (select row(clients_total, clients_archived, clients_app_linked, workouts_total, workouts_planned, workouts_in_progress, workouts_done, exercises_unique_used, workouts_cancelled_total, active_clients_7d, workouts_done_7d_by_trainer, workouts_done_7d_by_client, clients_added_7d, clients_added_30d)
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000002'),
  row(0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint),
  'trainer with no clients/workouts gets all-zero aggregates via coalesce, not null'
);

select is(
  (select is_test_account from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  false, 'regular trainer is not flagged as test account'
);
select is(
  (select is_test_account from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000003'),
  true, 'trainer with email test@test.com is flagged as test account'
);
select is(
  (select is_test_account from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005'),
  true, 'trainer with email Knyaz187@mail.ru is flagged as test account (case-insensitive match)'
);

select is(
  (select last_workout_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-16 09:00:00+00'::timestamptz,
  'last_workout_at ignores the deleted workout (updated_at 2026-07-20) and picks the latest active one'
);
select is(
  (select days_since_last_activity from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  (select floor(extract(epoch from (now() - '2026-07-20 00:00:00+00'::timestamptz)) / 86400)::bigint),
  'days_since_last_activity is the whole-day difference between refreshed_at and last_active_at (client_private_details touch is later than last_workout_at here)'
);
select is(
  (select trainer_status from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  'not_active', 'trainer with last activity from 2026-07-20 (last_active_at, not just last_workout_at) is not_active (well over 7 days ago)'
);

select ok(
  (select last_workout_at is null and days_since_last_activity is null
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000002'),
  'trainer with no workouts gets null last_workout_at/days_since_last_activity, not a fabricated zero'
);
select is(
  (select trainer_status from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000002'),
  'new', 'trainer with no workouts ever gets trainer_status = new, not not_active'
);

select is(
  (select trainer_status from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  'active', 'trainer with activity 2 days ago is active (within the 7-day threshold)'
);

select ok(
  (select refreshed_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001')
    between now() - interval '1 minute' and now() + interval '1 minute',
  'refreshed_at is set to the moment of the last REFRESH MATERIALIZED VIEW'
);
select is(
  (select count(distinct refreshed_at) from analytics.trainer_overview),
  1::bigint,
  'refreshed_at is the same snapshot moment across every row'
);

-- Детальный breakdown по не-тренировочным категориям для тренера 1 — по
-- каждой: total считает только строки с актором-тренером (created_by/
-- updated_by), last_*_at игнорирует более позднюю self-service строку
-- клиента там, где она есть (progress, custom_exercises) и LLM-реплику
-- ассистента (author='assistant').
select is(
  (select clients_with_notes_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'clients_with_notes_total counts only rows with a non-null note'
);
select is(
  (select last_client_notes_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-20 00:00:00+00'::timestamptz,
  'last_client_notes_at is the latest touch on client_private_details regardless of note content'
);
select is(
  (select progress_entries_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'progress_entries_total excludes the client self-service entry (updated_by is the client, not the trainer)'
);
select is(
  (select last_progress_entry_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-18 12:00:00+00'::timestamptz,
  'last_progress_entry_at ignores the later client self-service entry'
);
select is(
  (select custom_exercises_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'custom_exercises_total excludes the client-authored exercise (created_by is the client, not the trainer)'
);
select is(
  (select last_custom_exercise_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-18 08:00:00+00'::timestamptz,
  'last_custom_exercise_at ignores the later client-authored exercise'
);
select is(
  (select goals_created_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'goals_created_total counts goals created by the trainer'
);
select is(
  (select last_goal_activity_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-19 09:00:00+00'::timestamptz,
  'last_goal_activity_at matches the goal update timestamp'
);
select is(
  (select summaries_published_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'summaries_published_total counts summaries published by the trainer'
);
select is(
  (select last_summary_published_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-19 10:00:00+00'::timestamptz,
  'last_summary_published_at matches published_at'
);
select is(
  (select assistant_messages_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'assistant_messages_total counts only author=user messages, not the assistant reply'
);
select is(
  (select last_assistant_message_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-19 11:00:00+00'::timestamptz,
  'last_assistant_message_at ignores the later assistant-authored reply'
);
select is(
  (select last_sign_in_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-21 08:00:00+00'::timestamptz,
  'last_sign_in_at passes through auth.users.last_sign_in_at'
);
select is(
  (select last_active_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  '2026-07-20 00:00:00+00'::timestamptz,
  'last_active_at is the greatest last-touch across all activity categories (client_private_details wins here), excluding last_sign_in_at'
);
select ok(
  (select last_active_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000002') is null,
  'trainer with zero activity in every category gets a null last_active_at, not a fabricated zero'
);

select is(
  (select custom_exercises_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005'),
  1::bigint, 'trainer 5 fixture: one trainer-authored custom exercise, zero clients/workouts'
);
select ok(
  (select last_custom_exercise_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005') is not null,
  'trainer 5 last_custom_exercise_at is set'
);
select is(
  (select last_active_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005'),
  (select last_custom_exercise_at from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005'),
  'trainer 5 last_active_at is driven purely by the non-workout category'
);
select is(
  (select trainer_status from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000005'),
  'active', 'trainer with zero clients and zero workouts is still active thanks to recent non-workout activity — the core behavior this migration adds'
);

-- YAFIT-506: недельные rolling-метрики для тренера 1. active_clients_7d
-- считает клиента 61...0001 один раз (у него две done-тренировки на этой
-- неделе — 0007 от тренера и 0008 self-service клиента), плюс клиента
-- 61...0003 (0009, без актора) — итого 2 разных клиента, не 3 тренировки.
select is(
  (select active_clients_7d from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'active_clients_7d counts distinct clients with a done workout this week, not workout rows'
);
select is(
  (select workouts_done_7d_by_trainer from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'workouts_done_7d_by_trainer counts created_by = trainer_id plus the legacy created_by is null row'
);
select is(
  (select workouts_done_7d_by_client from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_done_7d_by_client counts only the self-service workout (created_by is the client, not the trainer)'
);
select is(
  (select clients_added_7d from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'clients_added_7d counts the new root client plus the client connected via client_trainers this week; the redundant membership row on the old root client does not leak in'
);
select is(
  (select clients_added_30d from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'clients_added_30d matches clients_added_7d here since both new connections are within 7 days'
);

-- Тренер 4: единственная его тренировка в статусе 'planned' (не 'done'),
-- оба его клиента подключены давно — контроль, что недельные метрики
-- корректно дают ноль там, где реальной активности "на этой неделе" нет.
select is(
  (select row(active_clients_7d, workouts_done_7d_by_trainer, workouts_done_7d_by_client)
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  row(0::bigint, 0::bigint, 0::bigint),
  'trainer 4 has zero this-week metrics: its only recent workout is planned, not done'
);
select is(
  (select row(clients_added_7d, clients_added_30d)
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000004'),
  row(0::bigint, 0::bigint),
  'trainer 4 has zero client growth: both its clients connected long ago'
);

select * from finish();
rollback;
