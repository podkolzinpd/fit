begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live13@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000013');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000013');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000013', 'Live 13', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000013', '2026-07-27', 'in_progress', now(), 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind
) values (
  'e0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000013',
  '50000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000013',
  0, 'system', 'barbell-squat', 'Присед', 'legs', 'strength'
);
-- Первый подход: план 90×8, факт 92.5×8 (подтверждён).
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position,
  plan_weight_kg, plan_reps, fact_weight_kg, fact_reps, confirmed_at
) values (
  'a0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000013',
  '50000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000013', 0,
  90, 8, 92.5, 8, now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000013', true);

-- append_live_set наследует ФАКТ (92.5×8), а не план (90×8), в plan_* нового подхода.
select is(public.append_live_set('e0000000-0000-4000-8000-000000000013', 1), 2::bigint, 'append бампит версию');
select is(
  (select plan_weight_kg from public.workout_sets where workout_exercise_id = 'e0000000-0000-4000-8000-000000000013' and position = 1),
  92.5::numeric, 'новый подход наследует фактический вес предыдущего'
);
select is(
  (select plan_reps from public.workout_sets where workout_exercise_id = 'e0000000-0000-4000-8000-000000000013' and position = 1),
  8, 'новый подход наследует фактические повторы предыдущего'
);

-- remove_live_set удаляет второй подход и оставляет один, версия бампится снова.
select is(public.remove_live_set(
  (select id from public.workout_sets where workout_exercise_id = 'e0000000-0000-4000-8000-000000000013' and position = 1),
  2), 3::bigint, 'remove бампит версию');
select is(
  (select count(*) from public.workout_sets where workout_exercise_id = 'e0000000-0000-4000-8000-000000000013'),
  1::bigint, 'после удаления остаётся один подход'
);

-- Последний подход удалить нельзя.
select throws_ok(
  $$select public.remove_live_set('a0000000-0000-4000-8000-000000000013', 3)$$,
  'PT422', 'last_set_cannot_be_removed', 'нельзя удалить последний подход'
);

reset role;
select * from finish();
rollback;
