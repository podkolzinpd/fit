begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reorder-a@example.test', ''),
  ('60000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reorder-b@example.test', '');
insert into public.profiles (id) values
  ('50000000-0000-4000-8000-000000000009'),
  ('60000000-0000-4000-8000-00000000000a');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-000000000009'),
  ('60000000-0000-4000-8000-00000000000a');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'Reorder A', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', '2026-07-24', 'in_progress', now(), 1);

-- Три одиночных блока: A(pos 0), B(pos 1), C(pos 2). У B подтверждён подход,
-- чтобы проверить, что двигать завершённый блок можно (нет guard).
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds
) values
  ('a0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', 0, 'system', 'squat', 'A', 'legs', 'strength', 'b1000000-0000-4000-8000-000000000009', 'single', 1),
  ('b0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', 1, 'system', 'bench', 'B', 'chest', 'strength', 'b2000000-0000-4000-8000-000000000009', 'single', 1),
  ('c1000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', 2, 'system', 'row', 'C', 'back', 'strength', 'b3000000-0000-4000-8000-000000000009', 'single', 1);
insert into public.workout_sets (workout_exercise_id, trainer_id, client_id, position, confirmed_at) values
  ('b0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', 0, now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000009', true);

-- Двигаем блок B (завершённый) вверх: порядок должен стать B, A, C.
select lives_ok(
  $$select public.reorder_live_block('d0000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-000000000009', (-1)::smallint, 1)$$,
  'reorder confirmed block up succeeds (no guard)'
);
select is(
  (select exercise_name from public.workout_exercises where workout_id = 'd0000000-0000-4000-8000-000000000009' order by position limit 1),
  'B', 'B moved to first position'
);
select is(
  (select string_agg(exercise_name, ',' order by position) from public.workout_exercises where workout_id = 'd0000000-0000-4000-8000-000000000009'),
  'B,A,C', 'order is B,A,C after moving B up'
);
select is(
  (select version from public.workouts where id = 'd0000000-0000-4000-8000-000000000009'),
  2::bigint, 'version bumped to 2'
);

-- Граница: двигать B вверх, когда он уже первый — тихий no-op, версия растёт.
select lives_ok(
  $$select public.reorder_live_block('d0000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-000000000009', (-1)::smallint, 2)$$,
  'reorder at top boundary is a no-op (succeeds)'
);
select is(
  (select string_agg(exercise_name, ',' order by position) from public.workout_exercises where workout_id = 'd0000000-0000-4000-8000-000000000009'),
  'B,A,C', 'boundary no-op leaves order unchanged'
);

reset role;

-- Чужой тренер не может переставлять блоки: конфликт версии/владельца.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-00000000000a', true);
select throws_ok(
  $$select public.reorder_live_block('d0000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-000000000009', (1)::smallint, 3)$$,
  'PT409', 'workout_conflict', 'foreign trainer cannot reorder blocks'
);
reset role;

select * from finish();
rollback;
