begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completed30@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000030');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000030');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000030', 'Дневник 30', 'male', 30, 180);
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000031', '50000000-0000-4000-8000-000000000030', 'Дневник 31', 'male', 31, 181);

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
select is((select created_by from public.workouts where id = (select id from completed_workout)), '50000000-0000-4000-8000-000000000030'::uuid, 'автор завершённой записи сохранён');
select ok((select completed_at is not null from public.workouts where id = (select id from completed_workout)), 'у завершённой записи есть время завершения');
select row_eq(
  $$select fact_weight_kg, fact_reps, fact_rpe, confirmed_at is not null from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout) and exercise_ref = 'squat')$$,
  row(70::numeric, 8, 8.5::numeric, true),
  'значения сохранены как подтверждённый факт'
);
select is((select plan_weight_kg from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout))), 70::numeric, 'план сохранён для последующих подсказок');

create temp table edited_completed_workout as
select public.save_completed_workout(
  jsonb_build_object(
    'id', (select id from completed_workout),
    'clientId', 'c0000000-0000-4000-8000-000000000030',
    'workoutDate', '2026-07-29',
    'exercises', jsonb_build_array(jsonb_build_object(
      'sourceExerciseId', (select id from public.workout_exercises where workout_id = (select id from completed_workout)),
      'source', 'system', 'ref', 'squat', 'name', 'Присед', 'muscleGroup', 'legs', 'inputKind', 'strength', 'position', 0,
      'sets', jsonb_build_array(jsonb_build_object('sourceSetId', (select id from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout))), 'position', 0, 'weightKg', 72.5, 'reps', 9, 'rpe', 9)
    )), jsonb_build_object(
      'source', 'system', 'ref', 'plank', 'name', 'Планка', 'muscleGroup', 'core', 'inputKind', 'duration', 'position', 1,
      'sets', jsonb_build_array(jsonb_build_object('position', 0, 'durationSec', 45, 'rpe', 7))
    ))
  ),
  (select version from public.workouts where id = (select id from completed_workout))
) as id;

select is((select id from edited_completed_workout), (select id from completed_workout), 'правка сохраняет ту же тренировку');
select is((select status from public.workouts where id = (select id from completed_workout)), 'done', 'после правки тренировка остаётся завершённой');
select is((select workout_date from public.workouts where id = (select id from completed_workout)), '2026-07-29'::date, 'правится дата завершённой тренировки');
select row_eq(
  $$select fact_weight_kg, fact_reps, fact_rpe, confirmed_at is not null from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout) and exercise_ref = 'squat')$$,
  row(72.5::numeric, 9, 9::numeric, true),
  'правка обновляет подтверждённый факт'
);
select is((select plan_weight_kg from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout) and exercise_ref = 'squat')), 70::numeric, 'правка факта не перезаписывает исходный план');
select row_eq(
  $$select plan_duration_sec, fact_duration_sec, fact_rpe, confirmed_at is not null from public.workout_sets where workout_exercise_id = (select id from public.workout_exercises where workout_id = (select id from completed_workout) and exercise_ref = 'plank')$$,
  row(null::integer, 45, 7::numeric, true),
  'добавленное после тренировки упражнение хранится как факт без плана'
);
select throws_ok(
  $$select public.save_completed_workout(jsonb_build_object('id', (select id from completed_workout), 'clientId', 'c0000000-0000-4000-8000-000000000031', 'workoutDate', '2026-07-29', 'exercises', '[]'::jsonb), (select version from public.workouts where id = (select id from completed_workout)))$$,
  'PT409', 'workout_conflict', 'нельзя подменить клиента завершённой тренировки'
);

reset role;
select * from finish();
rollback;
