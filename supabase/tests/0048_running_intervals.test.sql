begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('48000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'running-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('48000000-0000-4000-8000-000000000001', 'trainer');
insert into public.trainers (profile_id) values
  ('48000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('48000000-0000-4000-8000-000000000002', '48000000-0000-4000-8000-000000000001', 'Runner', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status) values
  ('48000000-0000-4000-8000-000000000003', '48000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000002', '2026-08-17', 'planned');

select lives_ok($$
  insert into public.workout_exercises (
    id, workout_id, trainer_id, client_id, position, exercise_source,
    exercise_ref, exercise_name, muscle_group, input_kind, block_id,
    block_type, block_preset, block_rounds
  ) values (
    '48000000-0000-4000-8000-000000000004', '48000000-0000-4000-8000-000000000003',
    '48000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000002',
    0, 'system', 'running', 'Бег — быстрый отрезок', 'cardio', 'distance',
    '48000000-0000-4000-8000-000000000005', 'group', 'interval', 6
  )
$$, 'interval is an allowed workout block preset');

select is(
  (select block_preset from public.workout_exercises where id = '48000000-0000-4000-8000-000000000004'),
  'interval', 'interval preset is stored without changing the running ref'
);

select throws_ok($$
  update public.workout_exercises
  set block_preset = 'unknown'
  where id = '48000000-0000-4000-8000-000000000004'
$$, '23514', null, 'unknown block preset is rejected');

select * from finish();
rollback;
