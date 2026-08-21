begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resolution-trainer@example.test', ''),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resolution-client@example.test', ''),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resolution-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name, timezone) values
  ('50000000-0000-4000-8000-000000000001', 'trainer', 'Trainer', 'UTC'),
  ('50000000-0000-4000-8000-000000000002', 'client', 'Client', 'UTC'),
  ('50000000-0000-4000-8000-000000000003', 'trainer', 'Outsider', 'UTC');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'Resolution client', 'female', 30, 170);

insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, start_time, status, version) values
  ('50000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', current_date - 2, '10:00', 'planned', 1),
  ('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', current_date - 3, null, 'planned', 1),
  ('50000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', current_date - 4, null, 'planned', 1),
  ('50000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', current_date + 2, null, 'planned', 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind
) values (
  '50000000-0000-4000-8000-000000000020', '50000000-0000-4000-8000-000000000010',
  '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
  0, 'system', 'squat', 'Squat', 'legs', 'strength'
);
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps
) values (
  '50000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000020',
  '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
  0, 40, 10
);

select has_function('public', 'cancel_planned_workout', array['uuid', 'bigint'], 'cancel RPC exists');
select has_function('public', 'reschedule_workout', array['uuid', 'date', 'time without time zone', 'bigint'], 'reschedule RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select is(
  public.cancel_planned_workout('50000000-0000-4000-8000-000000000010', 1),
  2::bigint,
  'trainer resolves their past plan'
);
select results_eq(
  $$select status, started_at, completed_at, version from public.workouts where id = '50000000-0000-4000-8000-000000000010'$$,
  $$values ('cancelled'::text, null::timestamptz, null::timestamptz, 2::bigint)$$,
  'not occurred is a terminal non-fact state'
);
select is(
  (select count(*) from public.workout_sets where workout_exercise_id = '50000000-0000-4000-8000-000000000020'),
  1::bigint,
  'resolving keeps the prescribed plan'
);

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select is(
  public.reschedule_workout('50000000-0000-4000-8000-000000000010', current_date + 1, '12:30', 2),
  3::bigint,
  'client can restore an assigned plan by changing only its schedule'
);
select results_eq(
  $$select status, workout_date, start_time, version from public.workouts where id = '50000000-0000-4000-8000-000000000010'$$,
  $$values ('planned'::text, current_date + 1, '12:30'::time, 3::bigint)$$,
  'restored workout returns to upcoming plans'
);
select results_eq(
  $$select plan_weight_kg, plan_reps from public.workout_sets where id = '50000000-0000-4000-8000-000000000030'$$,
  $$values (40::numeric, 10::integer)$$,
  'client reschedule cannot edit trainer plan contents'
);
select is(
  public.cancel_planned_workout('50000000-0000-4000-8000-000000000011', 1),
  2::bigint,
  'client can resolve an assigned past plan'
);
select is(
  (select skipped_count from public.get_workout_regularity('50000000-0000-4000-8000-000000000004', now()) where period = 'month'),
  2::integer,
  'cancelled and unresolved trainer plans stay outside completed attendance'
);
select throws_ok(
  $$select public.cancel_planned_workout('50000000-0000-4000-8000-000000000013', 1)$$,
  'PT422', 'workout_not_resolvable', 'future plan cannot be marked not occurred'
);
select throws_ok(
  $$select public.cancel_planned_workout('50000000-0000-4000-8000-000000000012', 99)$$,
  'PT409', 'workout_conflict', 'stale write is rejected'
);

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.cancel_planned_workout('50000000-0000-4000-8000-000000000012', 1)$$,
  'PT403', 'workout_access_denied', 'unrelated trainer cannot resolve a plan'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select ok(not has_function_privilege('anon', 'public.cancel_planned_workout(uuid,bigint)', 'EXECUTE'), 'anon cannot cancel plans');
select ok(not has_function_privilege('anon', 'public.reschedule_workout(uuid,date,time,bigint)', 'EXECUTE'), 'anon cannot reschedule plans');
select ok(has_function_privilege('authenticated', 'public.cancel_planned_workout(uuid,bigint)', 'EXECUTE'), 'authenticated role can call cancel RPC');
select ok(has_function_privilege('authenticated', 'public.reschedule_workout(uuid,date,time,bigint)', 'EXECUTE'), 'authenticated role can call reschedule RPC');

select * from finish();
rollback;
