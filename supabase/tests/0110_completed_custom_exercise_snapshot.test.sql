begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'snapshot-trainer@example.test', ''),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'snapshot-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('b1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('b2000000-0000-4000-8000-000000000002', 'client', 'Клиент');
insert into public.trainers (profile_id)
values ('b1000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('b1100000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000001', null, 'Клиент тренера'),
  ('b2200000-0000-4000-8000-000000000022', 'b2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Самостоятельный клиент');
insert into public.client_trainers (client_id, trainer_id) values
  ('b1100000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000001'),
  ('b2200000-0000-4000-8000-000000000022', 'b1000000-0000-4000-8000-000000000001');
insert into public.custom_exercises (
  id, trainer_id, created_by, name, muscle_group, input_kind
) values (
  'b1300000-0000-4000-8000-000000000013',
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Вертикальная тяга в хаммере',
  'back',
  'strength'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$create temporary table same_partition_result as
    select public.save_completed_workout(jsonb_build_object(
      'requestId', 'b1400000-0000-4000-8000-000000000014',
      'clientId', 'b1100000-0000-4000-8000-000000000011',
      'workoutDate', current_date::text,
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0,
        'source', 'custom',
        'ref', 'b1300000-0000-4000-8000-000000000013',
        'customExerciseId', 'b1300000-0000-4000-8000-000000000013',
        'name', 'Подменённое название',
        'muscleGroup', 'other',
        'inputKind', 'reps',
        'sets', jsonb_build_array(jsonb_build_object(
          'position', 0, 'weightKg', 20, 'reps', 10
        ))
      ))
    )) as workout_id$$,
  'completed workout keeps an accessible custom exercise in its own partition'
);
reset role;

select is(
  (select exercise_source from public.workout_exercises
    where workout_id = (select workout_id from same_partition_result)),
  'custom',
  'same-partition exercise keeps its custom source'
);
select is(
  (select custom_exercise_id from public.workout_exercises
    where workout_id = (select workout_id from same_partition_result)),
  'b1300000-0000-4000-8000-000000000013'::uuid,
  'same-partition exercise keeps its catalog reference'
);
select is(
  (select exercise_name from public.workout_exercises
    where workout_id = (select workout_id from same_partition_result)),
  'Вертикальная тяга в хаммере',
  'same-partition exercise uses authoritative catalog metadata'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$create temporary table cross_partition_result as
    select public.save_completed_workout(jsonb_build_object(
      'requestId', 'b1500000-0000-4000-8000-000000000015',
      'clientId', 'b2200000-0000-4000-8000-000000000022',
      'workoutDate', current_date::text,
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0,
        'source', 'custom',
        'ref', 'b1300000-0000-4000-8000-000000000013',
        'customExerciseId', 'b1300000-0000-4000-8000-000000000013',
        'name', 'Подменённое название',
        'muscleGroup', 'other',
        'inputKind', 'reps',
        'sets', jsonb_build_array(jsonb_build_object(
          'position', 0, 'weightKg', 25, 'reps', 8
        ))
      ))
    )) as workout_id$$,
  'completed workout snapshots an accessible exercise from another partition'
);
reset role;

select is(
  (select exercise_source from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'system',
  'cross-partition exercise becomes a self-contained snapshot'
);
select is(
  (select exercise_ref from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'snapshot:custom:b1300000-0000-4000-8000-000000000013',
  'snapshot keeps a stable source reference'
);
select ok(
  (select custom_exercise_id is null from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'snapshot has no cross-partition foreign key'
);
select is(
  (select exercise_name from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'Вертикальная тяга в хаммере',
  'snapshot uses the catalog name'
);
select is(
  (select muscle_group from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'back',
  'snapshot uses the catalog muscle group'
);
select is(
  (select input_kind from public.workout_exercises
    where workout_id = (select workout_id from cross_partition_result)),
  'strength',
  'snapshot uses the catalog input kind'
);
select is(
  (select status from public.workouts
    where id = (select workout_id from cross_partition_result)),
  'done',
  'snapshot workout is saved as completed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select is(
  public.save_completed_workout(jsonb_build_object(
    'requestId', 'b1500000-0000-4000-8000-000000000015',
    'clientId', 'b2200000-0000-4000-8000-000000000022',
    'workoutDate', current_date::text,
    'exercises', '[]'::jsonb
  )),
  (select workout_id from cross_partition_result),
  'retry with the same request id returns the original workout'
);
reset role;
select is(
  (select count(*) from public.workouts
    where client_id = 'b2200000-0000-4000-8000-000000000022'),
  1::bigint,
  'idempotent retry does not duplicate the completed workout'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.save_completed_workout(jsonb_build_object(
    'requestId', 'b1600000-0000-4000-8000-000000000016',
    'clientId', 'b2200000-0000-4000-8000-000000000022',
    'workoutDate', current_date::text,
    'exercises', jsonb_build_array(jsonb_build_object(
      'position', 0,
      'source', 'custom',
      'ref', 'b9900000-0000-4000-8000-000000000099',
      'customExerciseId', 'b9900000-0000-4000-8000-000000000099',
      'name', 'Несуществующее упражнение',
      'muscleGroup', 'other',
      'inputKind', 'strength',
      'sets', '[]'::jsonb
    ))
  ))$$,
  'PT404',
  'exercise_not_found',
  'missing custom exercise returns an explicit domain error'
);
reset role;
select is(
  (select count(*) from public.workouts
    where client_id = 'b2200000-0000-4000-8000-000000000022'),
  1::bigint,
  'missing exercise leaves no partial workout'
);

select * from finish();
rollback;
