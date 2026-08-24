begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('56000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fact-trainer@example.test', ''),
  ('56000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fact-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name, timezone) values
  ('56000000-0000-4000-8000-000000000001', 'trainer', 'Trainer', 'UTC'),
  ('56000000-0000-4000-8000-000000000002', 'trainer', 'Outsider', 'UTC');
insert into public.trainers (profile_id) values
  ('56000000-0000-4000-8000-000000000001'),
  ('56000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('56000000-0000-4000-8000-000000000003', '56000000-0000-4000-8000-000000000001', 'Fact client', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, start_time, status, version) values
  ('56000000-0000-4000-8000-000000000010', '56000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000003', '56000000-0000-4000-8000-000000000001', current_date - 2, '10:00', 'planned', 1),
  ('56000000-0000-4000-8000-000000000011', '56000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000003', '56000000-0000-4000-8000-000000000001', current_date - 3, '11:00', 'planned', 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind
) values (
  '56000000-0000-4000-8000-000000000020', '56000000-0000-4000-8000-000000000010',
  '56000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000003',
  0, 'system', 'squat', 'Присед', 'legs', 'strength'
);
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps
) values (
  '56000000-0000-4000-8000-000000000030', '56000000-0000-4000-8000-000000000020',
  '56000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000003',
  0, 40, 10
);

select has_function('public', 'record_planned_workout_result', array['jsonb', 'bigint'], 'direct fact RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '56000000-0000-4000-8000-000000000001', true);
select is(
  public.record_planned_workout_result(
    jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000010',
      'clientId', '56000000-0000-4000-8000-000000000003',
      'workoutDate', (current_date - 2)::text,
      'startTime', '10:00',
      'exercises', jsonb_build_array(jsonb_build_object(
        'sourceExerciseId', '56000000-0000-4000-8000-000000000020',
        'source', 'system', 'ref', 'squat', 'name', 'Присед',
        'muscleGroup', 'legs', 'inputKind', 'strength', 'position', 0,
        'sets', jsonb_build_array(jsonb_build_object(
          'sourceSetId', '56000000-0000-4000-8000-000000000030',
          'position', 0, 'weightKg', 42.5, 'reps', 9
        ))
      ))
    ),
    1
  ),
  '56000000-0000-4000-8000-000000000010'::uuid,
  'existing plan is recorded in place'
);
select row_eq(
  $$select status, started_at, completed_at is not null from public.workouts where id = '56000000-0000-4000-8000-000000000010'$$,
  row('done'::text, null::timestamptz, true),
  'direct fact completes workout without starting Live'
);
select row_eq(
  $$select plan_weight_kg, plan_reps, fact_weight_kg, fact_reps, confirmed_at is not null from public.workout_sets where id = '56000000-0000-4000-8000-000000000030'$$,
  row(40::numeric, 10::integer, 42.5::numeric, 9::integer, true),
  'plan stays intact and entered values become confirmed fact'
);
select is(
  (select count(*) from public.workouts where id = '56000000-0000-4000-8000-000000000010'),
  1::bigint,
  'direct fact does not create a duplicate workout'
);
select throws_ok(
  $$select public.record_planned_workout_result(jsonb_build_object('id', '56000000-0000-4000-8000-000000000010', 'clientId', '56000000-0000-4000-8000-000000000003', 'workoutDate', current_date::text, 'exercises', '[]'::jsonb), 1)$$,
  'PT409', 'workout_conflict', 'repeated or stale conversion is rejected'
);

select set_config('request.jwt.claim.sub', '56000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.record_planned_workout_result(jsonb_build_object('id', '56000000-0000-4000-8000-000000000011', 'clientId', '56000000-0000-4000-8000-000000000003', 'workoutDate', current_date::text, 'exercises', '[]'::jsonb), 1)$$,
  'PT403', 'workout_access_denied', 'unrelated trainer cannot record the fact'
);
reset role;
select is(
  (select status from public.workouts where id = '56000000-0000-4000-8000-000000000011'),
  'planned',
  'failed authorization leaves the plan unchanged'
);

select set_config('request.jwt.claim.sub', '', true);
select ok(not has_function_privilege('anon', 'public.record_planned_workout_result(jsonb,bigint)', 'EXECUTE'), 'anon cannot record fact');
select ok(has_function_privilege('authenticated', 'public.record_planned_workout_result(jsonb,bigint)', 'EXECUTE'), 'authenticated role can call direct fact RPC');
select ok(not has_function_privilege('public', 'public.record_planned_workout_result(jsonb,bigint)', 'EXECUTE'), 'public cannot record fact');

select * from finish();
rollback;
