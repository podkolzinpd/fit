begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'replace-a@example.test', ''),
  ('60000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'replace-b@example.test', '');
insert into public.profiles (id) values
  ('50000000-0000-4000-8000-00000000000b'),
  ('60000000-0000-4000-8000-00000000000c');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-00000000000b'),
  ('60000000-0000-4000-8000-00000000000c');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'Replace A', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', '2026-07-24', 'in_progress', now(), 1);

-- Два упражнения: A — не начато (силовое, есть план), B — с подтверждённым подходом.
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds
) values
  ('a0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 0, 'system', 'squat', 'Присед', 'legs', 'strength', 'b1000000-0000-4000-8000-00000000000b', 'single', 1),
  ('b0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 1, 'system', 'bench', 'Жим', 'chest', 'strength', 'b2000000-0000-4000-8000-00000000000b', 'single', 1);
insert into public.workout_sets (workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps, confirmed_at) values
  ('a0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 0, 50, 10, null),
  ('b0000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 0, 40, 8, now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-00000000000b', true);

-- Замена не начатого упражнения на другого ТИПА: очищаем значения подходов.
select lives_ok(
  $$select public.replace_live_exercise('d0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000b', '{"source":"system","ref":"running","name":"Бег","muscleGroup":"cardio","inputKind":"distance"}', 1)$$,
  'replace not-started exercise succeeds'
);
select is(
  (select exercise_ref from public.workout_exercises where id = 'a0000000-0000-4000-8000-00000000000b'),
  'running', 'identity swapped to running'
);
select is(
  (select input_kind from public.workout_exercises where id = 'a0000000-0000-4000-8000-00000000000b'),
  'distance', 'input_kind changed to distance'
);
select is(
  (select plan_weight_kg from public.workout_sets where workout_exercise_id = 'a0000000-0000-4000-8000-00000000000b'),
  null::numeric, 'set values cleared on type change'
);
select is(
  (select count(*) from public.workout_sets where workout_exercise_id = 'a0000000-0000-4000-8000-00000000000b'),
  1::bigint, 'set count preserved'
);
select is(
  (select version from public.workouts where id = 'd0000000-0000-4000-8000-00000000000b'),
  2::bigint, 'version bumped'
);

-- Начатое упражнение (B): выполненный факт остаётся отдельной записью,
-- а замена получает новый пустой подход.
select lives_ok(
  $$select public.replace_live_exercise('d0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', '{"source":"system","ref":"row","name":"Тяга","muscleGroup":"back","inputKind":"strength"}', 2)$$,
  'started exercise replacement succeeds'
);
select is(
  (select exercise_ref from public.workout_exercises where id = 'b0000000-0000-4000-8000-00000000000b'),
  'row', 'unfinished exercise receives replacement identity'
);
select is(
  (select count(*) from public.workout_exercises where workout_id = 'd0000000-0000-4000-8000-00000000000b' and exercise_ref = 'bench'),
  1::bigint, 'old exercise remains once in history'
);
select is(
  (select count(*) from public.workout_sets workout_set join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    where exercise.workout_id = 'd0000000-0000-4000-8000-00000000000b' and exercise.exercise_ref = 'bench' and workout_set.confirmed_at is not null),
  1::bigint, 'confirmed set remains attached to old exercise'
);
select is(
  (select count(*) from public.workout_sets where workout_exercise_id = 'b0000000-0000-4000-8000-00000000000b' and confirmed_at is null),
  1::bigint, 'replacement starts with one unfinished set when no remainder exists'
);
select is(
  (select version from public.workouts where id = 'd0000000-0000-4000-8000-00000000000b'),
  3::bigint, 'started replacement bumps version once'
);
reset role;

-- Чужой тренер не может заменять.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-00000000000c', true);
select throws_ok(
  $$select public.replace_live_exercise('d0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000b', '{"source":"system","ref":"row","name":"Тяга","muscleGroup":"back","inputKind":"strength"}', 3)$$,
  'PT403', 'workout_access_denied', 'foreign trainer cannot replace'
);
reset role;

select * from finish();
rollback;
