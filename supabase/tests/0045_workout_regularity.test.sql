begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('45000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regularity-root@example.test', ''),
  ('45000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regularity-member@example.test', ''),
  ('45000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regularity-client@example.test', ''),
  ('45000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regularity-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name, timezone) values
  ('45000000-0000-4000-8000-000000000001', 'trainer', 'Root', 'America/Adak'),
  ('45000000-0000-4000-8000-000000000002', 'trainer', 'Member', 'Europe/Moscow'),
  ('45000000-0000-4000-8000-000000000003', 'client', 'Client', 'Pacific/Kiritimati'),
  ('45000000-0000-4000-8000-000000000004', 'trainer', 'Outsider', 'Europe/Moscow');
insert into public.trainers (profile_id) values
  ('45000000-0000-4000-8000-000000000001'),
  ('45000000-0000-4000-8000-000000000002'),
  ('45000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', 'Regularity client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000002');

-- At 2026-01-04 10:30 UTC the client is already on Monday, Jan 5, while the
-- root trainer is still on Sunday, Jan 4. Both roles must use the client day.
insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status,
  started_at, completed_at, deleted_at
) values
  ('45000000-0000-4000-8000-000000000010', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-05', 'done', '2026-01-05 08:00+00', '2026-01-05 09:00+00', null),
  ('45000000-0000-4000-8000-000000000011', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000003', '2026-01-05', 'done', '2026-01-05 10:00+00', '2026-01-05 11:00+00', null),
  ('45000000-0000-4000-8000-000000000012', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-06', 'done', '2026-01-06 08:00+00', '2026-01-06 09:00+00', null),
  ('45000000-0000-4000-8000-000000000013', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-05', 'planned', null, null, null),
  ('45000000-0000-4000-8000-000000000014', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-03', 'planned', null, null, null),
  ('45000000-0000-4000-8000-000000000015', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-02', 'planned', null, null, null),
  ('45000000-0000-4000-8000-000000000016', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-02', 'in_progress', '2026-01-02 08:00+00', null, null),
  ('45000000-0000-4000-8000-000000000017', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-07', 'done', '2026-01-07 08:00+00', '2026-01-07 09:00+00', null),
  ('45000000-0000-4000-8000-000000000018', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-000000000001', '2026-01-05', 'done', '2026-01-05 08:00+00', '2026-01-05 09:00+00', '2026-01-05 10:00+00');

insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind
) values
  ('45000000-0000-4000-8000-000000000020', '45000000-0000-4000-8000-000000000010', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Squat', 'legs', 'strength'),
  ('45000000-0000-4000-8000-000000000021', '45000000-0000-4000-8000-000000000011', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, 'system', 'run', 'Run', 'cardio', 'distance'),
  ('45000000-0000-4000-8000-000000000022', '45000000-0000-4000-8000-000000000012', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, 'system', 'bench', 'Bench', 'chest', 'strength'),
  ('45000000-0000-4000-8000-000000000023', '45000000-0000-4000-8000-000000000017', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, 'system', 'press', 'Press', 'shoulders', 'strength');
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, confirmed_at
) values
  ('45000000-0000-4000-8000-000000000030', '45000000-0000-4000-8000-000000000020', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, '2026-01-05 08:30+00'),
  ('45000000-0000-4000-8000-000000000031', '45000000-0000-4000-8000-000000000020', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 1, '2026-01-05 08:45+00'),
  ('45000000-0000-4000-8000-000000000032', '45000000-0000-4000-8000-000000000021', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, '2026-01-05 10:30+00'),
  ('45000000-0000-4000-8000-000000000033', '45000000-0000-4000-8000-000000000022', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, '2026-01-06 08:30+00'),
  ('45000000-0000-4000-8000-000000000034', '45000000-0000-4000-8000-000000000022', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 1, null),
  ('45000000-0000-4000-8000-000000000035', '45000000-0000-4000-8000-000000000023', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 0, null),
  ('45000000-0000-4000-8000-000000000036', '45000000-0000-4000-8000-000000000023', '45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', 1, null);

select has_function(
  'public', 'get_workout_regularity', array['uuid', 'timestamp with time zone'],
  'weekly/monthly regularity RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select * from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00') where period = 'week'$$,
  $$values ('week'::text, '2026-01-05'::date, '2026-01-11'::date, 4, 4, 3, 1, 0, 75)$$,
  'root trainer gets the client-timezone week and counts every done workout'
);
select results_eq(
  $$select * from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00') where period = 'month'$$,
  $$values ('month'::text, '2026-01-01'::date, '2026-01-31'::date, 7, 4, 3, 1, 2, 43)$$,
  'month counts attendance and keeps partial and skipped plan details separate'
);

select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select period, period_start, period_end, planned_count, completed_count, completion_percent from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00')$$,
  $$values
    ('week'::text, '2026-01-05'::date, '2026-01-11'::date, 4, 4, 75),
    ('month'::text, '2026-01-01'::date, '2026-01-31'::date, 7, 4, 43)$$,
  'client gets the same week and month numbers as the trainer'
);

select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select period, completed_planned_count, partial_count, skipped_count from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00')$$,
  $$values ('week'::text, 3, 1, 0), ('month'::text, 3, 1, 2)$$,
  'connected trainer reads the shared aggregate'
);

select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00')$$,
  'PT403', 'workout_access_denied', 'unrelated trainer cannot read regularity'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select * from public.get_workout_regularity('45000000-0000-4000-8000-000000000005', '2026-01-04 10:30+00')$$,
  '28000', 'authentication_required', 'anonymous caller is rejected'
);
select ok(
  not has_function_privilege('anon', 'public.get_workout_regularity(uuid,timestamptz)', 'EXECUTE'),
  'anon has no execute grant'
);
select ok(
  has_function_privilege('authenticated', 'public.get_workout_regularity(uuid,timestamptz)', 'EXECUTE'),
  'authenticated role can execute the aggregate'
);

select * from finish();
rollback;
