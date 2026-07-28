begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ws-trainer@example.test', ''),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ws-other@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('b1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('b2000000-0000-4000-8000-000000000002', 'trainer', 'Чужой');
insert into public.trainers (profile_id) values
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент', 'gender', 'male', 'ageYears', 30, 'ageUpdatedAt', current_date, 'heightCm', 180
)) as client_id \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'title', 'Цель', 'targetDate', (current_date + 60)::text
)) as goal_id \gset
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'goal_id', 'title', 'Набор', 'startsOn', current_date::text, 'endsOn', (current_date + 30)::text
)) as stage_id \gset

-- Тренировка с привязкой к этапу.
select public.save_workout(jsonb_build_object(
  'clientId', :'client_id', 'workoutDate', current_date::text, 'stageId', :'stage_id', 'exercises', '[]'::jsonb
)) as workout_id \gset
select is(
  (select stage_id from public.workouts where id = :'workout_id'),
  :'stage_id'::uuid, 'workout is bound to the stage'
);

-- list_workouts возвращает название этапа.
select is(
  (select stage_title from public.list_workouts(null, null, :'client_id', 50, 0) where id = :'workout_id'),
  'Набор', 'list_workouts returns the stage title'
);

-- Чужой этап не привязывается (пишется null), но тренировка создаётся.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент2', 'gender', 'male', 'ageYears', 30, 'ageUpdatedAt', current_date, 'heightCm', 180
)) as client2_id \gset
select public.save_workout(jsonb_build_object(
  'clientId', :'client2_id', 'workoutDate', current_date::text, 'stageId', :'stage_id', 'exercises', '[]'::jsonb
)) as workout2_id \gset
select is(
  (select stage_id from public.workouts where id = :'workout2_id'),
  null::uuid, 'foreign stage is ignored (null), workout still created'
);
select isnt(:'workout2_id'::uuid, null::uuid, 'workout with foreign stage is still created');
reset role;

-- Удаление этапа обнуляет привязку (on delete set null), тренировка жива.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.delete_goal_stage(:'stage_id');
select is(
  (select stage_id from public.workouts where id = :'workout_id'),
  null::uuid, 'deleting a stage nulls the workout binding'
);
select is(
  (select count(*) from public.workouts where id = :'workout_id'),
  1::bigint, 'workout survives stage deletion'
);
reset role;

select * from finish();
rollback;
