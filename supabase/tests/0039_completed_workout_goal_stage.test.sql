begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values ('a9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completed-stage@example.test', '');
insert into public.profiles (id, account_role, first_name)
values ('a9000000-0000-4000-8000-000000000001', 'trainer', 'Goal stage trainer');
insert into public.trainers (profile_id) values ('a9000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm)
values
  ('a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'First client', 'female', 30, 170),
  ('a9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000001', 'Second client', 'male', 31, 180);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);

select public.save_completed_workout(jsonb_build_object(
  'clientId', 'a9000000-0000-4000-8000-000000000002',
  'workoutDate', current_date::text,
  'exercises', '[]'::jsonb
)) as workout_id \gset

select public.save_client_goal(jsonb_build_object(
  'clientId', 'a9000000-0000-4000-8000-000000000002', 'title', 'First goal', 'targetDate', (current_date + 30)::text
)) as own_goal_id \gset
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'own_goal_id', 'title', 'Own stage', 'startsOn', current_date::text, 'endsOn', (current_date + 14)::text
)) as own_stage_id \gset

select public.save_client_goal(jsonb_build_object(
  'clientId', 'a9000000-0000-4000-8000-000000000003', 'title', 'Second goal', 'targetDate', (current_date + 30)::text
)) as foreign_goal_id \gset
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'foreign_goal_id', 'title', 'Foreign stage', 'startsOn', current_date::text, 'endsOn', (current_date + 14)::text
)) as foreign_stage_id \gset

select throws_ok(
  format($$select public.save_completed_workout(jsonb_build_object(
    'id', %L::uuid,
    'clientId', 'a9000000-0000-4000-8000-000000000002',
    'workoutDate', current_date::text,
    'stageId', %L::uuid,
    'exercises', '[]'::jsonb
  ), %s)$$, :'workout_id', :'foreign_stage_id', (select version from public.workouts where id = :'workout_id'::uuid)),
  'PT422', 'goal_stage_client_mismatch',
  'foreign client stage is rejected when editing a completed workout'
);
select is(
  (select stage_id from public.workouts where id = :'workout_id'::uuid),
  null::uuid,
  'rejected foreign stage leaves the completed workout unchanged'
);
select is(
  public.save_completed_workout(jsonb_build_object(
    'id', :'workout_id'::uuid,
    'clientId', 'a9000000-0000-4000-8000-000000000002',
    'workoutDate', current_date::text,
    'stageId', :'own_stage_id'::uuid,
    'exercises', '[]'::jsonb
  ), (select version from public.workouts where id = :'workout_id'::uuid)),
  :'workout_id'::uuid,
  'own client stage is saved on the completed workout'
);

reset role;
select * from finish();
rollback;
