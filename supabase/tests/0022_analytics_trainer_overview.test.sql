begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'trainer_overview'),
  'analytics.trainer_overview matview exists'
);
select ok(
  has_table_privilege('datalens_reader', 'analytics.trainer_overview', 'SELECT'),
  'datalens_reader has select on analytics.trainer_overview'
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
  ('60000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-client@example.test', '');
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

insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm, created_at) values
  ('61000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004', 'Overview Recent', 'female', 29, 168, '2026-07-20');
insert into public.workouts (id, trainer_id, client_id, workout_date, status, updated_at) values
  ('63000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000004', '2026-07-20', 'planned', now() - interval '2 days');

insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm, archived_at, created_at) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', 'Overview Active', 'female', 30, 170, null, '2026-07-10'),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', null, 'Overview Archived', 'male', 31, 180, '2026-07-11', '2026-07-11'),
  ('61000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', null, 'Overview Paper', 'female', 32, 165, null, '2026-07-12'),
  ('62000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', null, 'Test Trainer Client', 'female', 33, 160, null, '2026-07-13');

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
  3::bigint, 'clients_total includes archived clients'
);
select is(
  (select clients_archived from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'clients_archived counts archived_at is not null'
);
select is(
  (select clients_app_linked from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  1::bigint, 'clients_app_linked counts auth_user_id is not null'
);

select is(
  (select workouts_total from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  3::bigint, 'workouts_total ignores the deleted workout and avoids a cartesian product with clients'
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
  1::bigint, 'workouts_done'
);
select ok(
  (select workouts_planned + workouts_in_progress + workouts_done = workouts_total
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  'status breakdown sums to workouts_total'
);

select is(
  (select exercises_unique_used from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  2::bigint, 'exercises_unique_used only counts active done workouts (squat, bench_press)'
);

select is(
  (select row(clients_total, clients_archived, clients_app_linked, workouts_total, workouts_planned, workouts_in_progress, workouts_done, exercises_unique_used)
   from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000002'),
  row(0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint),
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
  (select floor(extract(epoch from (now() - '2026-07-16 09:00:00+00'::timestamptz)) / 86400)::bigint),
  'days_since_last_activity is the whole-day difference between refreshed_at and last_workout_at'
);
select is(
  (select trainer_status from analytics.trainer_overview where trainer_id = '60000000-0000-4000-8000-000000000001'),
  'not_active', 'trainer with last activity from 2026-07-16 is not_active (well over 7 days ago)'
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

select * from finish();
rollback;
