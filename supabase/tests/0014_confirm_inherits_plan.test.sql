begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live14@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000014');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000014');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000014', '50000000-0000-4000-8000-000000000014', 'Live 14', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-000000000014', '50000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000014', '2026-07-27', 'in_progress', now(), 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind
) values (
  'e0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000014',
  '50000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000014',
  0, 'system', 'barbell-squat', 'Присед', 'legs', 'strength'
);
-- План 100×5, факт пустой (тренер жмёт «Готово» без ввода — факт совпадает с планом).
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps, plan_rpe
) values (
  'a0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000014',
  '50000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000014', 0, 100, 5, 8.5
);
insert into public.workout_sets (id, workout_exercise_id, trainer_id, client_id, position) values
  ('a0000000-0000-4000-8000-000000000015', 'e0000000-0000-4000-8000-000000000014',
   '50000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000014', 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000014', true);

-- «Готово» без ввода факта: confirm наследует план в факт.
select is(public.confirm_live_set('a0000000-0000-4000-8000-000000000014', 1), 2::bigint, 'confirm бампит версию');
select is(
  (select fact_weight_kg from public.workout_sets where id = 'a0000000-0000-4000-8000-000000000014'),
  100::numeric, 'пустой факт веса наследует план при подтверждении'
);
select is(
  (select fact_reps from public.workout_sets where id = 'a0000000-0000-4000-8000-000000000014'),
  5, 'пустой факт повторов наследует план при подтверждении'
);
select is(
  (select fact_rpe from public.workout_sets where id = 'a0000000-0000-4000-8000-000000000014'),
  8.5::numeric, 'пустой факт RPE наследует план при подтверждении'
);
select throws_ok(
  $$select public.confirm_live_set('a0000000-0000-4000-8000-000000000015', 1)$$,
  'PT422', 'live_set_empty', 'совсем пустой подход нельзя подтвердить'
);

reset role;
select * from finish();
rollback;
