begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-owner@example.test', ''),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-linked@example.test', ''),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-neighbour@example.test', ''),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-trainer@example.test', ''),
  ('a5000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('a1000000-0000-4000-8000-000000000001', 'client', 'Самостоятельный'),
  ('a2000000-0000-4000-8000-000000000002', 'client', 'Связанный'),
  ('a3000000-0000-4000-8000-000000000003', 'client', 'Соседний'),
  ('a4000000-0000-4000-8000-000000000004', 'trainer', 'Тренер'),
  ('a5000000-0000-4000-8000-000000000005', 'trainer', 'Посторонний');
insert into public.trainers (profile_id) values
  ('a4000000-0000-4000-8000-000000000004'),
  ('a5000000-0000-4000-8000-000000000005');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('a1100000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Самостоятельный клиент'),
  ('a2200000-0000-4000-8000-000000000022', 'a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'Клиент с тренером'),
  ('a3300000-0000-4000-8000-000000000033', 'a4000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000003', 'Другой клиент тренера');
insert into public.client_trainers (client_id, trainer_id) values
  ('a2200000-0000-4000-8000-000000000022', 'a4000000-0000-4000-8000-000000000004'),
  ('a3300000-0000-4000-8000-000000000033', 'a4000000-0000-4000-8000-000000000004');

-- Существующий тренерский каталог сохраняет ID и автора.
insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind) values
  ('a4100000-0000-4000-8000-000000000041', 'a4000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 'Тренерская тяга', 'back', 'strength');
select is(
  (select created_by from public.custom_exercises where id = 'a4100000-0000-4000-8000-000000000041'),
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'existing trainer exercise keeps its id and author'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into public.custom_exercises (id, trainer_id, name, muscle_group, input_kind)
    values ('a1200000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000001', 'Моя самостоятельная тяга', 'legs', 'strength')$$,
  'standalone client creates a custom exercise'
);
select is(
  (select created_by from public.custom_exercises where id = 'a1200000-0000-4000-8000-000000000012'),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'standalone client remains the exercise author'
);
select lives_ok(
  $$select public.save_workout(jsonb_build_object(
    'requestId', 'a1300000-0000-4000-8000-000000000013',
    'clientId', 'a1100000-0000-4000-8000-000000000011',
    'workoutDate', current_date::text,
    'exercises', jsonb_build_array(jsonb_build_object(
      'position', 0, 'source', 'custom', 'ref', 'a1200000-0000-4000-8000-000000000012',
      'customExerciseId', 'a1200000-0000-4000-8000-000000000012',
      'name', 'Моя самостоятельная тяга', 'muscleGroup', 'legs', 'inputKind', 'strength',
      'sets', jsonb_build_array(jsonb_build_object('position', 0, 'weightKg', 20, 'reps', 10))
    ))
  ))$$,
  'standalone client saves the custom exercise in a workout'
);
reset role;
select is(
  (select custom_exercise_id from public.workout_exercises where client_id = 'a1100000-0000-4000-8000-000000000011'),
  'a1200000-0000-4000-8000-000000000012'::uuid,
  'standalone workout keeps the custom exercise reference'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into public.custom_exercises (id, trainer_id, name, muscle_group, input_kind)
    values ('a2300000-0000-4000-8000-000000000023', 'a4000000-0000-4000-8000-000000000004', 'Румынская тяга гантели', 'legs', 'strength')$$,
  'linked client creates a custom exercise in the workout partition'
);
select is(
  (select created_by from public.custom_exercises where id = 'a2300000-0000-4000-8000-000000000023'),
  'a2000000-0000-4000-8000-000000000002'::uuid,
  'linked client remains the exercise author'
);
select is(
  (select trainer_id from public.custom_exercises where id = 'a2300000-0000-4000-8000-000000000023'),
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'linked exercise stays in the trainer workout partition'
);
select lives_ok(
  $$select public.save_workout(jsonb_build_object(
    'requestId', 'a2400000-0000-4000-8000-000000000024',
    'clientId', 'a2200000-0000-4000-8000-000000000022',
    'workoutDate', current_date::text,
    'exercises', jsonb_build_array(jsonb_build_object(
      'position', 0, 'source', 'custom', 'ref', 'a2300000-0000-4000-8000-000000000023',
      'customExerciseId', 'a2300000-0000-4000-8000-000000000023',
      'name', 'Румынская тяга гантели', 'muscleGroup', 'legs', 'inputKind', 'strength',
      'sets', jsonb_build_array(jsonb_build_object('position', 0, 'weightKg', 12, 'reps', 15))
    ))
  ))$$,
  'linked client saves the custom exercise in a workout'
);
select throws_ok(
  $$insert into public.custom_exercises (trainer_id, name, muscle_group, input_kind)
    values ('a5000000-0000-4000-8000-000000000005', 'Чужой раздел', 'other', 'strength')$$,
  '42501', null, 'client cannot create an exercise in an unrelated partition'
);
select throws_ok(
  $$update public.custom_exercises
    set trainer_id = 'a5000000-0000-4000-8000-000000000005'
    where id = 'a2300000-0000-4000-8000-000000000023'$$,
  '42501', 'custom_exercise_ownership_immutable',
  'client cannot move an existing exercise to another partition'
);
select throws_ok(
  $$update public.custom_exercises
    set created_by = 'a3000000-0000-4000-8000-000000000003'
    where id = 'a2300000-0000-4000-8000-000000000023'$$,
  '42501', 'custom_exercise_ownership_immutable',
  'client cannot transfer authorship of an existing exercise'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000003', true);
insert into public.custom_exercises (id, trainer_id, name, muscle_group, input_kind) values
  ('a3400000-0000-4000-8000-000000000034', 'a4000000-0000-4000-8000-000000000004', 'Упражнение соседнего клиента', 'other', 'strength');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.custom_exercises where id = 'a2300000-0000-4000-8000-000000000023'),
  1::bigint, 'client sees their own exercise'
);
select is(
  (select count(*) from public.custom_exercises where id = 'a4100000-0000-4000-8000-000000000041'),
  1::bigint, 'client sees trainer-authored exercise in the same partition'
);
select is(
  (select count(*) from public.custom_exercises where id = 'a3400000-0000-4000-8000-000000000034'),
  0::bigint, 'client cannot see another client exercise'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*) from public.custom_exercises where id in (
    'a2300000-0000-4000-8000-000000000023',
    'a3400000-0000-4000-8000-000000000034'
  )),
  2::bigint, 'trainer sees custom exercises of accessible clients'
);
select lives_ok(
  $$update public.custom_exercises set archived_at = now(), version = version + 1
    where id = 'a2300000-0000-4000-8000-000000000023'$$,
  'trainer can archive a linked client exercise'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*) from public.custom_exercises where id in (
    'a1200000-0000-4000-8000-000000000012',
    'a2300000-0000-4000-8000-000000000023',
    'a3400000-0000-4000-8000-000000000034'
  )),
  0::bigint, 'unrelated trainer cannot see client exercises'
);
select throws_ok(
  $$insert into public.custom_exercises (trainer_id, name, muscle_group, input_kind)
    values ('a1000000-0000-4000-8000-000000000001', 'Чужое упражнение', 'other', 'strength')$$,
  '42501', null, 'unrelated trainer cannot create in a client partition'
);
reset role;

select * from finish();
rollback;
