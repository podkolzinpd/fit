begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-a@example.test', ''),
  ('60000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-b@example.test', '');
insert into public.profiles (id) values
  ('50000000-0000-4000-8000-000000000005'),
  ('60000000-0000-4000-8000-000000000006');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-000000000005'),
  ('60000000-0000-4000-8000-000000000006');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'Live A', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at) values
  ('d0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', '2026-07-22', 'in_progress', now());
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind
) values (
  'e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005',
  '50000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005',
  0, 'system', 'barbell-squat', 'Присед', 'legs', 'strength'
);
insert into public.workout_sets (workout_exercise_id, trainer_id, client_id, position) values (
  'e0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005',
  'c0000000-0000-4000-8000-000000000005', 0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.append_live_set('e0000000-0000-4000-8000-000000000005', 1)$$,
  'P0002', 'exercise_not_found', 'trainer B cannot append a set to trainer A workout'
);
select throws_ok(
  $$select public.append_live_exercise(
    'd0000000-0000-4000-8000-000000000005',
    '{"source":"system","ref":"running","name":"Бег","muscleGroup":"cardio","inputKind":"distance"}',
    1
  )$$,
  'PT409', 'workout_conflict', 'trainer B cannot append an exercise to trainer A workout'
);
reset role;

select is((select count(*) from public.workout_exercises), 1::bigint, 'cross-tenant append leaves exercises unchanged');
select is((select count(*) from public.workout_sets), 1::bigint, 'cross-tenant append leaves sets unchanged');

select * from finish();
rollback;
