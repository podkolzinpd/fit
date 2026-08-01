begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-a@example.test', ''),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-b@example.test', ''),
  ('60000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@test.com', ''),
  ('60000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-client@example.test', '');
insert into public.profiles (id) values
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002'),
  ('60000000-0000-4000-8000-000000000003');
insert into public.trainers (profile_id, created_at) values
  ('60000000-0000-4000-8000-000000000001', '2026-07-01'),
  ('60000000-0000-4000-8000-000000000002', '2026-07-02'),
  ('60000000-0000-4000-8000-000000000003', '2026-07-03');

insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm, archived_at, created_at) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', 'Overview Active', 'female', 30, 170, null, '2026-07-10'),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', null, 'Overview Archived', 'male', 31, 180, '2026-07-11', '2026-07-11'),
  ('61000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', null, 'Overview Paper', 'female', 32, 165, null, '2026-07-12'),
  ('62000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', null, 'Test Trainer Client', 'female', 33, 160, null, '2026-07-13');

insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, completed_at) values
  ('63000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-15', 'planned', null, null),
  ('63000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-16', 'in_progress', '2026-07-16 10:00:00+00', null),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-07-17', 'done', '2026-07-17 10:00:00+00', '2026-07-17 11:00:00+00');

insert into public.workout_exercises (workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('63000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'lunge', 'Lunge', 'legs', 'reps'),
  ('63000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'deadlift', 'Deadlift', 'back', 'strength'),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'system', 'squat', 'Squat', 'legs', 'strength'),
  ('63000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, 'system', 'bench_press', 'Bench Press', 'chest', 'strength');

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
  3::bigint, 'workouts_total is 3, not 3x3=9 cartesian product with clients'
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
  2::bigint, 'exercises_unique_used only counts exercises from done workouts (squat, bench_press) not planned/in_progress'
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

select * from finish();
rollback;
