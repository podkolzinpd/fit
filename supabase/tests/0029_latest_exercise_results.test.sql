begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000029', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'previous29@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000029');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000029');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000029', '50000000-0000-4000-8000-000000000029', 'История 29', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, completed_at) values
  ('d0000000-0000-4000-8000-000000000291', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', '2026-07-20', 'done', now() - interval '10 days'),
  ('d0000000-0000-4000-8000-000000000292', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', '2026-07-28', 'done', now() - interval '2 days');
insert into public.workouts (id, trainer_id, client_id, workout_date, status, completed_at) values
  ('d0000000-0000-4000-8000-000000000294', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', '2026-07-29', 'done', now() - interval '1 day');
insert into public.workout_exercises (id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('e0000000-0000-4000-8000-000000000291', 'd0000000-0000-4000-8000-000000000291', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 'system', 'squat', 'Присед', 'legs', 'strength'),
  ('e0000000-0000-4000-8000-000000000292', 'd0000000-0000-4000-8000-000000000292', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 'system', 'squat', 'Присед', 'legs', 'strength'),
  ('e0000000-0000-4000-8000-000000000293', 'd0000000-0000-4000-8000-000000000292', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 1, 'system', 'plank', 'Планка', 'core', 'duration');
insert into public.workout_exercises (id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('e0000000-0000-4000-8000-000000000294', 'd0000000-0000-4000-8000-000000000294', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 'system', 'squat', 'Присед', 'legs', 'strength');
insert into public.workout_sets (id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps, fact_weight_kg, fact_reps, plan_duration_min, fact_duration_sec, fact_rpe) values
  ('a0000000-0000-4000-8000-000000000291', 'e0000000-0000-4000-8000-000000000291', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 60, 10, 62.5, 9, null, null, null),
  ('a0000000-0000-4000-8000-000000000292', 'e0000000-0000-4000-8000-000000000292', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 65, 8, 70, 7, null, null, 8),
  ('a0000000-0000-4000-8000-000000000293', 'e0000000-0000-4000-8000-000000000293', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, null, null, null, null, 1.5, 100, 8.5),
  ('a0000000-0000-4000-8000-000000000294', 'e0000000-0000-4000-8000-000000000294', '50000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000029', 0, 80, 6, 80, 6, null, null, 9);
update public.workout_sets set confirmed_at = now() where id in ('a0000000-0000-4000-8000-000000000291', 'a0000000-0000-4000-8000-000000000292', 'a0000000-0000-4000-8000-000000000293');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000029', true);

select is((select count(*) from public.list_latest_exercise_results('c0000000-0000-4000-8000-000000000029', array['squat', 'plank', 'missing'])), 2::bigint, 'возвращаются только найденные упражнения');
select is((select workout_date from public.list_latest_exercise_results('c0000000-0000-4000-8000-000000000029', array['squat']) limit 1), '2026-07-28'::date, 'выбирается последнее завершённое выполнение');
select is((select sets->0->>'weightKg' from public.list_latest_exercise_results('c0000000-0000-4000-8000-000000000029', array['squat']) limit 1), '70.00', 'вес берётся из факта последней тренировки');
select is((select sets->0->>'durationSec' from public.list_latest_exercise_results('c0000000-0000-4000-8000-000000000029', array['plank']) limit 1), '100', 'исторические минуты совместимы с точными секундами');
select is((select workout_date from public.list_latest_exercise_results('c0000000-0000-4000-8000-000000000029', array['squat']) limit 1), '2026-07-28'::date, 'неподтверждённый факт не вытесняет последний результат');

reset role;
select * from finish();
rollback;
