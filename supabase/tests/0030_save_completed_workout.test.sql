begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completed30@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000030');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000030');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000030', 'Дневник 30', 'male', 30, 180);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000030', true);

create temp table completed_workout as
select public.save_completed_workout(
  '{
    "clientId": "c0000000-0000-4000-8000-000000000030",
    "workoutDate": "2026-07-30",
    "exercises": [{
      "source": "system", "ref": "squat", "name": "Присед", "muscleGroup": "legs", "inputKind": "strength", "position": 0,
      "sets": [{"position": 0, "weightKg": 70, "reps": 8, "rpe": 8.5}]
    }]
  }'::jsonb
) as id;

select is((select status from public.workouts where id = (select id from completed_workout)), 'done', 'ручная запись сразу завершена');
select ok((select completed_at is not null from public.workouts where id = (select id from completed_workout)), 'у завершённой записи есть время завершения');
select row_eq(
  $$select fact_weight_kg, fact_reps, fact_rpe, confirmed_at is not null from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout))$$,
  row(70::numeric, 8, 8.5::numeric, true),
  'значения сохранены как подтверждённый факт'
);
select is((select plan_weight_kg from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout))), 70::numeric, 'план сохранён для последующих подсказок');

reset role;
select * from finish();
rollback;
