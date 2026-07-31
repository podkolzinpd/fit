begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000028', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'set28@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000028');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000028');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000028', '50000000-0000-4000-8000-000000000028', 'Секунды 28', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-000000000028', '50000000-0000-4000-8000-000000000028', 'c0000000-0000-4000-8000-000000000028', '2026-07-31', 'in_progress', now(), 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind
) values (
  'e0000000-0000-4000-8000-000000000028', 'd0000000-0000-4000-8000-000000000028',
  '50000000-0000-4000-8000-000000000028', 'c0000000-0000-4000-8000-000000000028',
  0, 'system', 'plank', 'Планка', 'core', 'duration'
);
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, plan_duration_sec, plan_rpe
) values (
  'a0000000-0000-4000-8000-000000000028', 'e0000000-0000-4000-8000-000000000028',
  '50000000-0000-4000-8000-000000000028', 'c0000000-0000-4000-8000-000000000028', 0, 45, 8.5
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000028', true);

select is(
  public.save_live_set_draft('a0000000-0000-4000-8000-000000000028', '{"durationSec":60,"rpe":9}'::jsonb, 1),
  2::bigint, 'черновик сохраняет секунды и фактический RPE'
);
select is((select fact_duration_sec from public.workout_sets where id = 'a0000000-0000-4000-8000-000000000028'), 60, 'факт времени хранится в секундах');
select is((select fact_rpe from public.workout_sets where id = 'a0000000-0000-4000-8000-000000000028'), 9::numeric, 'фактический RPE хранится отдельно от планового');
select is(public.confirm_live_set('a0000000-0000-4000-8000-000000000028', 2), 3::bigint, 'подтверждение работает с новыми полями');
select is(public.append_live_set('e0000000-0000-4000-8000-000000000028', 1), 2::bigint, 'новый подход добавляется после секундного подхода');
select row_eq(
  $$select plan_duration_sec, plan_rpe from public.workout_sets where workout_exercise_id = 'e0000000-0000-4000-8000-000000000028' and position = 1$$,
  row(60, 9::numeric), 'новый подход наследует фактические секунды и RPE'
);

reset role;
select * from finish();
rollback;
