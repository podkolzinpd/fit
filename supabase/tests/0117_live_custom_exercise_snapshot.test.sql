begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-snapshot-trainer@example.test', ''),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-snapshot-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('c1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('c2000000-0000-4000-8000-000000000002', 'client', 'Клиент');
insert into public.trainers (profile_id)
values ('c1000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('c2200000-0000-4000-8000-000000000022', 'c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'Самостоятельный клиент');
insert into public.client_trainers (client_id, trainer_id) values
  ('c2200000-0000-4000-8000-000000000022', 'c1000000-0000-4000-8000-000000000001');
insert into public.custom_exercises (
  id, trainer_id, created_by, name, muscle_group, input_kind
) values (
  'c1300000-0000-4000-8000-000000000013',
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Halo',
  'shoulders',
  'reps'
);
insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status, started_at,
  version
) values (
  'c1400000-0000-4000-8000-000000000014',
  'c2000000-0000-4000-8000-000000000002',
  'c2200000-0000-4000-8000-000000000022',
  'c1000000-0000-4000-8000-000000000001',
  current_date,
  'in_progress',
  now(),
  1
);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind
) values (
  'c1500000-0000-4000-8000-000000000015',
  'c1400000-0000-4000-8000-000000000014',
  'c2000000-0000-4000-8000-000000000002',
  'c2200000-0000-4000-8000-000000000022',
  0,
  'system',
  'running',
  'Бег',
  'cardio',
  'distance'
);
insert into public.workout_sets (
  workout_exercise_id, trainer_id, client_id, position
) values (
  'c1500000-0000-4000-8000-000000000015',
  'c2000000-0000-4000-8000-000000000002',
  'c2200000-0000-4000-8000-000000000022',
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.append_live_exercise(
    'c1400000-0000-4000-8000-000000000014',
    '{"source":"custom","ref":"custom:c1300000-0000-4000-8000-000000000013","customExerciseId":"c1300000-0000-4000-8000-000000000013","name":"Подмена","muscleGroup":"other","inputKind":"duration"}',
    1
  )$$,
  'Live appends an accessible custom exercise from another partition'
);
reset role;

select is(
  (select version from public.workouts where id = 'c1400000-0000-4000-8000-000000000014'),
  2::bigint,
  'append bumps the workout version'
);
select is(
  (select exercise_source from public.workout_exercises
    where workout_id = 'c1400000-0000-4000-8000-000000000014' and position = 1),
  'system',
  'appended exercise becomes a snapshot'
);
select is(
  (select exercise_ref from public.workout_exercises
    where workout_id = 'c1400000-0000-4000-8000-000000000014' and position = 1),
  'snapshot:custom:c1300000-0000-4000-8000-000000000013',
  'appended snapshot keeps a stable source reference'
);
select ok(
  (select custom_exercise_id is null from public.workout_exercises
    where workout_id = 'c1400000-0000-4000-8000-000000000014' and position = 1),
  'appended snapshot has no cross-partition foreign key'
);
select is(
  (select exercise_name from public.workout_exercises
    where workout_id = 'c1400000-0000-4000-8000-000000000014' and position = 1),
  'Halo',
  'append uses the catalog name'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.replace_live_exercise(
    'c1400000-0000-4000-8000-000000000014',
    'c1500000-0000-4000-8000-000000000015',
    '{"source":"custom","ref":"c1300000-0000-4000-8000-000000000013","customExerciseId":"c1300000-0000-4000-8000-000000000013","name":"Подмена","muscleGroup":"other","inputKind":"duration"}',
    2
  )$$,
  'Live replaces with an accessible custom exercise from another partition'
);
reset role;

select is(
  (select version from public.workouts where id = 'c1400000-0000-4000-8000-000000000014'),
  3::bigint,
  'replace bumps the workout version'
);
select is(
  (select exercise_source from public.workout_exercises where id = 'c1500000-0000-4000-8000-000000000015'),
  'system',
  'replacement becomes a snapshot'
);
select is(
  (select exercise_ref from public.workout_exercises where id = 'c1500000-0000-4000-8000-000000000015'),
  'snapshot:custom:c1300000-0000-4000-8000-000000000013',
  'replacement keeps a stable source reference'
);
select is(
  (select row(exercise_name, muscle_group, input_kind)::text from public.workout_exercises
    where id = 'c1500000-0000-4000-8000-000000000015'),
  '(Halo,shoulders,reps)',
  'replacement uses authoritative catalog metadata'
);

select * from finish();
rollback;
