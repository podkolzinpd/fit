begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('49000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'running-progress-root@example.test', ''),
  ('49000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'running-progress-member@example.test', ''),
  ('49000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'running-progress-client@example.test', ''),
  ('49000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'running-progress-outsider@example.test', '');
insert into public.profiles (id, account_role) values
  ('49000000-0000-4000-8000-000000000001', 'trainer'),
  ('49000000-0000-4000-8000-000000000002', 'trainer'),
  ('49000000-0000-4000-8000-000000000003', 'client'),
  ('49000000-0000-4000-8000-000000000004', 'trainer');
insert into public.trainers (profile_id) values
  ('49000000-0000-4000-8000-000000000001'),
  ('49000000-0000-4000-8000-000000000002'),
  ('49000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000003', 'Running progress client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000002');

insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status,
  started_at, completed_at, session_rpe, wellbeing, discomfort
) values
  ('49000000-0000-4000-8000-000000000010', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000001', '2026-08-01', 'done', '2026-08-01 07:00+00', '2026-08-01 08:00+00', null, null, null),
  ('49000000-0000-4000-8000-000000000011', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000001', '2026-08-08', 'done', '2026-08-08 07:00+00', '2026-08-08 08:00+00', null, null, null),
  ('49000000-0000-4000-8000-000000000012', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000001', '2026-08-15', 'done', '2026-08-15 07:00+00', '2026-08-15 08:00+00', 6, 'normal', false),
  ('49000000-0000-4000-8000-000000000013', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', '49000000-0000-4000-8000-000000000001', '2026-08-16', 'planned', null, null, null, null, null);

insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind, block_id,
  block_type, block_preset, block_rounds
) values
  ('49000000-0000-4000-8000-000000000020', '49000000-0000-4000-8000-000000000010', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 'system', 'running', 'Лёгкий бег', 'cardio', 'distance', '49000000-0000-4000-8000-000000000030', 'single', 'set', 1),
  ('49000000-0000-4000-8000-000000000021', '49000000-0000-4000-8000-000000000011', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 'system', 'running', 'Бег — быстрый отрезок', 'cardio', 'distance', '49000000-0000-4000-8000-000000000031', 'group', 'interval', 6),
  ('49000000-0000-4000-8000-000000000022', '49000000-0000-4000-8000-000000000011', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 1, 'system', 'running', 'Бег — восстановление', 'cardio', 'distance', '49000000-0000-4000-8000-000000000031', 'group', 'interval', 6),
  ('49000000-0000-4000-8000-000000000023', '49000000-0000-4000-8000-000000000012', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 'system', 'running', 'Длительный бег', 'cardio', 'distance', '49000000-0000-4000-8000-000000000032', 'single', 'set', 1),
  ('49000000-0000-4000-8000-000000000024', '49000000-0000-4000-8000-000000000013', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 'system', 'running', 'Свободный бег', 'cardio', 'distance', '49000000-0000-4000-8000-000000000033', 'single', 'set', 1);

insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position,
  plan_duration_sec, plan_distance_km, plan_rpe,
  fact_duration_sec, fact_distance_km, fact_rpe, confirmed_at
) values
  ('49000000-0000-4000-8000-000000000040', '49000000-0000-4000-8000-000000000020', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 1800, 5, 7, 1800, 5, 7, '2026-08-01 07:30+00'),
  ('49000000-0000-4000-8000-000000000041', '49000000-0000-4000-8000-000000000021', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 600, 2.4, 8, 600, 2.4, 8, '2026-08-08 07:30+00'),
  ('49000000-0000-4000-8000-000000000042', '49000000-0000-4000-8000-000000000022', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 540, null, 6, 540, null, 6, '2026-08-08 07:40+00'),
  ('49000000-0000-4000-8000-000000000043', '49000000-0000-4000-8000-000000000023', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 3600, 10, null, 3600, 10, null, '2026-08-15 07:30+00'),
  ('49000000-0000-4000-8000-000000000044', '49000000-0000-4000-8000-000000000024', '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 0, 1200, 3, 7, 1200, 3, 7, null);

select has_function(
  'public', 'list_running_progress', array['uuid', 'date', 'date'],
  'protected running progress RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select workout_date, running_format, distance_km, duration_sec, pace_sec_per_km, rpe
    from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-01', '2026-08-31'
    )$$,
  $$values
    ('2026-08-01'::date, 'easy'::text, 5::numeric, 1800, 360::numeric, 7::numeric),
    ('2026-08-08'::date, 'interval_active'::text, 2.4::numeric, 1140, 475::numeric, 7::numeric),
    ('2026-08-15'::date, 'long'::text, 10::numeric, 3600, 360::numeric, 6::numeric)$$,
  'confirmed sessions combine the running family and keep transparent metrics'
);
select results_eq(
  $$select count(*)::bigint from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-08', '2026-08-08'
    )$$,
  $$values (1::bigint)$$,
  'active interval exercises count as one run'
);
select results_eq(
  $$select count(*)::bigint from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-16', '2026-08-16'
    )$$,
  $$values (0::bigint)$$,
  'planned and unconfirmed running values do not enter progress'
);

select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select count(*)::bigint from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-01', '2026-08-31'
    )$$,
  $$values (3::bigint)$$,
  'linked client reads their running progress'
);
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::bigint from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-01', '2026-08-31'
    )$$,
  $$values (3::bigint)$$,
  'connected trainer reads shared running progress'
);

select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-01', '2026-08-31'
    )$$,
  'PT403', 'client_access_denied', 'unrelated trainer is rejected'
);
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-31', '2026-08-01'
    )$$,
  '22007', 'invalid_period', 'invalid period is rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.list_running_progress(
      '49000000-0000-4000-8000-000000000005', '2026-08-01', '2026-08-31'
    )$$,
  '28000', 'authentication_required', 'anonymous caller is rejected'
);
select ok(
  not has_function_privilege('anon', 'public.list_running_progress(uuid,date,date)', 'EXECUTE'),
  'anonymous role cannot execute running progress'
);
select ok(
  has_function_privilege('authenticated', 'public.list_running_progress(uuid,date,date)', 'EXECUTE'),
  'authenticated role can execute running progress'
);

select * from finish();
rollback;
