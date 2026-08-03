begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'serial32@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000032');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000032');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000032', 'Сериализация 32', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at) values
  ('d0000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000032', '2026-08-03', 'in_progress', now());
insert into public.workout_exercises (id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('e0000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000032', 0, 'system', 'squat', 'Присед', 'legs', 'strength');
insert into public.workout_sets (id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps) values
  ('a0000000-0000-4000-8000-000000000032', 'e0000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000032', 0, 80, 8);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000032', true);

select ok(
  pg_get_functiondef('public.confirm_live_set(uuid,bigint)'::regprocedure) like '%for update of workout%',
  'подтверждение блокирует родительскую тренировку'
);
select is(public.confirm_live_set('a0000000-0000-4000-8000-000000000032', 1), 2::bigint, 'подтверждение проходит до завершения');
select is(public.finish_workout('d0000000-0000-4000-8000-000000000032', 1), 2::bigint, 'завершение после подтверждения проходит без потери факта');
select throws_ok(
  $$select public.confirm_live_set('a0000000-0000-4000-8000-000000000032', 2)$$,
  'PT409', 'live_set_conflict', 'подтверждение после завершения получает безопасный конфликт'
);

reset role;
select * from finish();
rollback;
