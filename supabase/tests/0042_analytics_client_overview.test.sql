begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'client_overview'),
  'analytics.client_overview matview exists'
);
select ok(
  has_table_privilege('datalens_reader', 'analytics.client_overview', 'SELECT'),
  'datalens_reader has select on analytics.client_overview'
);

-- Тренер 1 (реальный) — заводит клиента A (не привязан) и клиента B
-- (привязал свой отдельный аккаунт, но не self-registered — владелец
-- партиции остался тренер). Клиент C — self-registered (сам себе владелец).
-- Тренер D — тестовый аккаунт (test@test.com), его клиент помечается
-- is_test_account. Клиент E — self-registered с собственным тестовым
-- email в смешанном регистре (case-insensitive проверка).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-trainer-1@example.test', ''),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-linked-client-b@example.test', ''),
  ('70000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-self-client-c@example.test', ''),
  ('70000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@test.com', ''),
  ('70000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Knyaz187@mail.ru', '');
insert into public.profiles (id) values
  ('70000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000003'),
  ('70000000-0000-4000-8000-000000000004'),
  ('70000000-0000-4000-8000-000000000005');
insert into public.trainers (profile_id, created_at) values
  ('70000000-0000-4000-8000-000000000001', '2026-07-01'),
  ('70000000-0000-4000-8000-000000000004', '2026-07-02');

insert into public.clients (id, trainer_id, auth_user_id, full_name, created_at) values
  -- Клиент A: заведён тренером 1, не привязан
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', null, 'Overview Client A', '2026-08-01'),
  -- Клиент B: заведён тренером 1, привязал СВОЙ отдельный аккаунт (app-linked, но не self-registered)
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Overview Client B', '2026-08-02'),
  -- Клиент C: self-registered — владелец партиции = он сам
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'Overview Client C', '2026-08-03'),
  -- Клиент D: заведён тестовым тренером (test@test.com)
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', null, 'Overview Client D', '2026-08-04'),
  -- Клиент E: self-registered со своим тестовым email (смешанный регистр)
  ('71000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', 'Overview Client E', '2026-08-05');

-- Активность самого клиента: только записи, которые клиент САМ последний
-- раз редактировал (updated_by = clients.auth_user_id), независимо от
-- того, кто их создал. У клиента A нет auth_user_id — собственной
-- активности быть не может, даже если тренер что-то заводит.
-- У клиента B — ровно наоборот тому, что было бы по created_by: запись,
-- которую он создал сам, но последним отредактировал тренер (НЕ
-- засчитывается), и запись, которую завёл тренер, но последним
-- отредактировал сам клиент (засчитывается, с более поздним updated_at) —
-- проверяет, что именно updated_by, а не created_by, решает. У клиента C —
-- своя тренировка и свой замер, greatest() берёт более позднюю из двух дат.
insert into public.workouts (id, trainer_id, client_id, created_by, updated_by, workout_date, status, updated_at) values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '2026-08-06', 'planned', '2026-08-06 09:00:00+00'),
  ('72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '2026-08-07', 'planned', '2026-08-07 10:00:00+00'),
  ('72000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '2026-08-08', 'planned', '2026-08-08 12:00:00+00'),
  ('72000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '2026-08-05', 'planned', '2026-08-05 09:00:00+00');

insert into public.client_progress (id, trainer_id, client_id, created_by, updated_by, recorded_on, updated_at) values
  ('73000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '2026-08-09', '2026-08-09 09:00:00+00');

-- Счётчики тренировок клиента (workouts_total/planned/in_progress/done):
-- клиент A получает по одной тренировке каждого статуса плюс 'cancelled',
-- чтобы отдельно проверить, что workouts_total считает ВСЕ статусы, а не
-- только сумму трёх явных колонок. Клиент D остаётся без единой
-- тренировки — проверяет coalesce(..., 0) вместо null.
insert into public.workouts (id, trainer_id, client_id, created_by, updated_by, workout_date, status, started_at, completed_at, updated_at) values
  ('72000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '2026-08-10', 'in_progress', '2026-08-10 09:00:00+00', null, '2026-08-10 09:00:00+00'),
  ('72000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '2026-08-11', 'done', '2026-08-11 08:00:00+00', '2026-08-11 09:00:00+00', '2026-08-11 09:00:00+00'),
  ('72000000-0000-4000-8000-000000000007', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '2026-08-12', 'cancelled', null, null, '2026-08-12 09:00:00+00');

-- Клиент F: self-registered, с СОБСТВЕННОЙ активностью 2 дня назад (relative
-- to now(), а не фиксированная дата) — чтобы client_status = 'active' не
-- зависел от того, в какой день реально прогоняются тесты.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('70000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-active-client-f@example.test', '');
insert into public.profiles (id) values ('70000000-0000-4000-8000-000000000006');
insert into public.clients (id, trainer_id, auth_user_id, full_name, created_at) values
  ('71000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', 'Overview Client F', '2026-08-06');
insert into public.workouts (id, trainer_id, client_id, created_by, updated_by, workout_date, status, updated_at) values
  ('72000000-0000-4000-8000-000000000008', '70000000-0000-4000-8000-000000000006', '71000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', (now() - interval '2 days')::date, 'planned', now() - interval '2 days');

-- YAFIT-507: новые категории собственной активности, по одной фикстуре
-- на клиента C (self-registered, trainer_id = auth_user_id = 70...0003),
-- каждая с датой позже предыдущего максимума (2026-08-09, прогресс) —
-- проверяет, что каждая категория корректно участвует в greatest() и
-- последняя по времени (подключение к тренеру) в итоге побеждает.
insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind, updated_at) values
  ('74000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'Client C Exercise', 'legs', 'reps', '2026-08-10 08:00:00+00');
insert into public.client_goals (id, client_id, trainer_id, created_by, title, updated_at) values
  ('75000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'Client C Goal', '2026-08-11 08:00:00+00');
insert into public.workouts (id, trainer_id, client_id, created_by, updated_by, workout_date, status, client_question, client_question_asked_at, updated_at) values
  ('72000000-0000-4000-8000-000000000009', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '2026-08-12', 'planned', 'Сколько отдыхать между подходами?', '2026-08-12 08:00:00+00', '2026-08-12 08:00:00+00');
insert into public.client_trainer_relationships (client_id, trainer_id, connected_by, connected_at, status) values
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '2026-08-13 08:00:00+00', 'active');
update auth.users set last_sign_in_at = '2026-08-14 08:00:00+00' where id = '70000000-0000-4000-8000-000000000003';

-- Клиент B: регрессия на partition vs actor для custom_exercises (та же
-- проблема, что и в trainer_overview YAFIT-500) — обе строки лежат в
-- партиции тренера 1 (trainer_id), но только created_by = сам клиент B
-- должен засчитаться. Дата старше уже проверенного last_client_activity_at
-- клиента B (2026-08-08 12:00), чтобы не задеть тот ассерт.
insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind, updated_at) values
  ('74000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Trainer Exercise In Client B Partition', 'legs', 'reps', '2026-08-06 08:00:00+00'),
  ('74000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Client B Own Exercise', 'legs', 'reps', '2026-08-07 09:00:00+00');

refresh materialized view analytics.client_overview;

select is(
  (select count(*)::bigint from analytics.client_overview),
  (select count(*)::bigint from public.clients),
  'row count matches live count(*) from public.clients'
);

select is(
  (select registered_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  (select created_at from public.clients where id = '71000000-0000-4000-8000-000000000001'),
  'registered_at matches clients.created_at'
);

select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  false, 'client added by trainer, not app-linked at all: is_self_registered = false'
);
select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  false, 'app-linked client (different auth_user_id than partition owner) is NOT self-registered'
);
select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  true, 'client is own partition owner (trainer_id = auth_user_id): is_self_registered = true'
);

select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  false, 'regular trainer-owned client is not flagged as test account'
);
select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  true, 'client owned by test@test.com trainer is flagged as test account'
);
select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000005'),
  true, 'self-registered client with own email Knyaz187@mail.ru is flagged as test account (case-insensitive)'
);

select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  null, 'client without auth_user_id has no self-edited records: last_client_activity_at is null even though a trainer-authored workout exists'
);
select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  '2026-08-08 12:00:00+00'::timestamptz,
  'last_client_activity_at follows updated_by: the trainer-created workout the client last edited counts, the client-created one the trainer edited later does not'
);
select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-13 08:00:00+00'::timestamptz,
  'last_client_activity_at is greatest() across all activity categories; the later trainer-connection fixture (added below) wins over the self-edited workout and progress entry'
);

select is(
  (select workouts_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  4::bigint,
  'workouts_total counts all non-deleted workouts of any status (planned + in_progress + done + cancelled)'
);
select is(
  (select workouts_planned from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_planned counts only status = planned'
);
select is(
  (select workouts_in_progress from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_in_progress counts only status = in_progress'
);
select is(
  (select workouts_done from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  1::bigint, 'workouts_done counts only status = done'
);

select is(
  (select workouts_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  0::bigint, 'client with zero workouts gets workouts_total = 0, not null'
);
select is(
  (select workouts_planned from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  0::bigint, 'client with zero workouts gets workouts_planned = 0, not null'
);
select is(
  (select workouts_in_progress from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  0::bigint, 'client with zero workouts gets workouts_in_progress = 0, not null'
);
select is(
  (select workouts_done from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  0::bigint, 'client with zero workouts gets workouts_done = 0, not null'
);

select is(
  (select days_since_last_activity from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  (select floor(extract(epoch from (now() - '2026-08-13 08:00:00+00'::timestamptz)) / 86400)::bigint),
  'days_since_last_activity is the whole-day difference between refreshed_at and last_client_activity_at (the trainer-connection event is the latest touch here, not the progress entry)'
);
select is(
  (select client_status from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  'not_active', 'client with last activity from 2026-08-13 is not_active (well over 7 days ago)'
);

select ok(
  (select last_client_activity_at is null and days_since_last_activity is null
   from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  'client with no self-authored activity gets null last_client_activity_at/days_since_last_activity, not a fabricated zero'
);
select is(
  (select client_status from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  'new', 'client with no activity ever gets client_status = new, not not_active'
);

select is(
  (select client_status from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000006'),
  'active', 'client with self-authored activity 2 days ago is active (within the 7-day threshold)'
);

select ok(
  (select refreshed_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001')
    between now() - interval '1 minute' and now() + interval '1 minute',
  'refreshed_at is set to the moment of the last REFRESH MATERIALIZED VIEW'
);
select is(
  (select count(distinct refreshed_at) from analytics.client_overview),
  1::bigint,
  'refreshed_at is the same snapshot moment across every row'
);

-- YAFIT-507: детальный breakdown для клиента C и итоговый greatest().
select is(
  (select custom_exercises_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  1::bigint, 'custom_exercises_total counts the client-authored exercise'
);
select is(
  (select last_custom_exercise_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-10 08:00:00+00'::timestamptz, 'last_custom_exercise_at matches the exercise updated_at'
);
select is(
  (select goals_created_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  1::bigint, 'goals_created_total counts the client-authored goal'
);
select is(
  (select last_goal_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-11 08:00:00+00'::timestamptz, 'last_goal_activity_at matches the goal updated_at'
);
select is(
  (select questions_asked_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  1::bigint, 'questions_asked_total counts the workout with a client question'
);
select is(
  (select last_question_asked_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-12 08:00:00+00'::timestamptz, 'last_question_asked_at matches client_question_asked_at'
);
select is(
  (select connection_changes_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  1::bigint, 'connection_changes_total counts the client-initiated connect event'
);
select is(
  (select last_connection_change_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-13 08:00:00+00'::timestamptz, 'last_connection_change_at matches connected_at'
);
select is(
  (select last_sign_in_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-14 08:00:00+00'::timestamptz, 'last_sign_in_at passes through auth.users.last_sign_in_at, independent of last_client_activity_at'
);
select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-13 08:00:00+00'::timestamptz,
  'last_client_activity_at is the greatest() across all 6 activity categories (the connection event wins here), excluding last_sign_in_at'
);

-- Клиент B: partition (trainer_id) не равно актор (created_by) — регрессия
-- на ту же ошибку, что чинили в trainer_overview (YAFIT-500).
select is(
  (select custom_exercises_total from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  1::bigint, 'custom_exercises_total excludes the trainer-authored exercise in the same trainer_id partition'
);
select is(
  (select last_custom_exercise_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  '2026-08-07 09:00:00+00'::timestamptz, 'last_custom_exercise_at ignores the trainer-authored exercise'
);

-- Клиент D: без auth_user_id новые категории тоже дают ноль/null через
-- coalesce, не фейково падают в ошибку.
select is(
  (select row(custom_exercises_total, goals_created_total, questions_asked_total, connection_changes_total)
   from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  row(0::bigint, 0::bigint, 0::bigint, 0::bigint),
  'client without auth_user_id gets all-zero new-category aggregates via coalesce, not null'
);

select * from finish();
rollback;
