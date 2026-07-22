begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values ('40000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc@example.test', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000004', true);

select lives_ok(
  $$select public.initialize_trainer('RPC', 'Trainer', 'Europe/Moscow')$$,
  'initialize_trainer creates profile explicitly'
);
select is((select count(*) from public.profiles), 1::bigint, 'initialized trainer reads own profile');

select lives_ok(
  $$select public.create_client('{"fullName":"RPC Client","gender":"female","ageYears":28,"ageUpdatedAt":"2026-07-21","heightCm":168,"initialWeightKg":61,"initialWeightRecordedOn":"2026-07-21"}'::jsonb)$$,
  'create_client writes aggregate and initial weight'
);
select is((select count(*) from public.client_progress), 1::bigint, 'initial weight creates first progress');

select lives_ok(
  format(
    'select public.update_client(%L::jsonb, 1)',
    jsonb_build_object(
      'id', (select id from public.clients limit 1), 'fullName', 'RPC Client Updated',
      'gender', 'female', 'ageYears', 29, 'ageUpdatedAt', '2026-07-21',
      'heightCm', 168, 'goal', 'Stronger', 'note', 'Private'
    )
  ),
  'update_client updates public and private rows atomically'
);
select is((select version from public.clients limit 1), 2::bigint, 'client version increments');

select lives_ok(
  format(
    'select public.save_workout(%L::jsonb, null)',
    jsonb_build_object(
      'clientId', (select id from public.clients limit 1),
      'workoutDate', '2026-07-22',
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0, 'source', 'system', 'ref', 'barbell-squat', 'name', 'Присед',
        'muscleGroup', 'legs', 'inputKind', 'strength',
        'sets', jsonb_build_array(jsonb_build_object('position', 0, 'weightKg', 40, 'reps', 10))
      ))
    )
  ),
  'save_workout creates complete aggregate'
);
select is((select count(*) from public.workout_sets), 1::bigint, 'workout child set exists');

select throws_ok(
  format(
    'select public.save_workout(%L::jsonb, null)',
    jsonb_build_object(
      'clientId', (select id from public.clients limit 1), 'workoutDate', '2026-07-23',
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0, 'source', 'system', 'ref', 'bad', 'name', 'Bad',
        'muscleGroup', 'invalid', 'inputKind', 'strength', 'sets', '[]'::jsonb
      ))
    )
  ),
  '23514', null,
  'invalid child rolls back workout transaction'
);
select is((select count(*) from public.workouts), 1::bigint, 'failed aggregate left no root');

select lives_ok(
  format('select public.start_workout(%L::uuid, 1)', (select id from public.workouts limit 1)),
  'start_workout starts planned workout'
);
select throws_ok(
  format('select public.start_workout(%L::uuid, 1)', (select id from public.workouts limit 1)),
  '40001', 'workout_conflict', 'stale workout version is rejected'
);
select lives_ok(
  format('select public.save_live_set_draft(%L::uuid, %L::jsonb, 1)',
    (select id from public.workout_sets limit 1), '{"weightKg":42.5,"reps":9}'),
  'live draft saves fact without copying plan'
);
select lives_ok(
  format('select public.confirm_live_set(%L::uuid, 2)', (select id from public.workout_sets limit 1)),
  'confirm_live_set confirms saved fact'
);
select lives_ok(
  format('select public.append_live_set(%L::uuid, 2)', (select id from public.workout_exercises limit 1)),
  'append_live_set adds a set to an in-progress workout'
);
select is((select count(*) from public.workout_sets), 2::bigint, 'appended live set exists');
select lives_ok(
  format(
    'select public.append_live_exercise(%L::uuid, %L::jsonb, 3)',
    (select id from public.workouts limit 1),
    jsonb_build_object('source', 'system', 'ref', 'running', 'name', 'Бег', 'muscleGroup', 'cardio', 'inputKind', 'distance')
  ),
  'append_live_exercise adds an exercise and initial set'
);
select is((select count(*) from public.workout_sets), 3::bigint, 'appended live exercise has an initial set');
select lives_ok(
  format('select public.finish_workout(%L::uuid, 4)', (select id from public.workouts limit 1)),
  'finish_workout completes in-progress workout'
);

select lives_ok(
  format(
    'select public.save_progress(%L::jsonb, null)',
    jsonb_build_object('clientId', (select id from public.clients limit 1), 'recordedOn', '2026-07-22', 'weightKg', 60.5, 'customMetrics', '[]'::jsonb)
  ),
  'save_progress creates progress aggregate'
);
select throws_ok(
  format(
    'select public.save_progress(%L::jsonb, 0)',
    jsonb_build_object('id', (select id from public.client_progress where recorded_on = '2026-07-22'), 'clientId', (select id from public.clients limit 1), 'recordedOn', '2026-07-22', 'weightKg', 60, 'customMetrics', '[]'::jsonb)
  ),
  '40001', 'progress_conflict', 'stale progress version is rejected'
);

reset role;
select * from finish();
rollback;
