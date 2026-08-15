begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('46000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-progress-root@example.test', ''),
  ('46000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-progress-member@example.test', ''),
  ('46000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-progress-client@example.test', ''),
  ('46000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-progress-outsider@example.test', ''),
  ('46000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exercise-progress-standalone@example.test', '');
insert into public.profiles (id, account_role, first_name, timezone) values
  ('46000000-0000-4000-8000-000000000001', 'trainer', 'Root', 'Europe/Moscow'),
  ('46000000-0000-4000-8000-000000000002', 'trainer', 'Member', 'Europe/Moscow'),
  ('46000000-0000-4000-8000-000000000003', 'client', 'Client', 'Europe/Moscow'),
  ('46000000-0000-4000-8000-000000000004', 'trainer', 'Outsider', 'Europe/Moscow'),
  ('46000000-0000-4000-8000-000000000006', 'client', 'Standalone', 'Europe/Moscow');
insert into public.trainers (profile_id) values
  ('46000000-0000-4000-8000-000000000001'),
  ('46000000-0000-4000-8000-000000000002'),
  ('46000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000003', 'Exercise progress client', 'female', 30, 170),
  ('46000000-0000-4000-8000-000000000007', '46000000-0000-4000-8000-000000000006', '46000000-0000-4000-8000-000000000006', 'Standalone progress client', 'male', 31, 180);
insert into public.client_trainers (client_id, trainer_id) values
  ('46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000002');

insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status,
  started_at, completed_at, deleted_at
) values
  ('46000000-0000-4000-8000-000000000010', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-01', 'done', '2026-01-01 09:00+00', '2026-01-01 10:00+00', null),
  ('46000000-0000-4000-8000-000000000011', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-02', 'done', '2026-01-02 09:00+00', '2026-01-02 10:00+00', null),
  ('46000000-0000-4000-8000-000000000012', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-03', 'done', '2026-01-03 09:00+00', '2026-01-03 10:00+00', null),
  ('46000000-0000-4000-8000-000000000013', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-04', 'planned', null, null, null),
  ('46000000-0000-4000-8000-000000000014', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-04', 'done', '2026-01-04 09:00+00', '2026-01-04 10:00+00', '2026-01-04 11:00+00'),
  ('46000000-0000-4000-8000-000000000015', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-01', 'done', '2026-01-01 11:00+00', '2026-01-01 12:00+00', null),
  ('46000000-0000-4000-8000-000000000016', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-01', 'done', '2026-01-01 13:00+00', '2026-01-01 14:00+00', null),
  ('46000000-0000-4000-8000-000000000017', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000001', '2026-01-01', 'done', '2026-01-01 15:00+00', '2026-01-01 16:00+00', null),
  ('46000000-0000-4000-8000-000000000018', '46000000-0000-4000-8000-000000000006', '46000000-0000-4000-8000-000000000007', '46000000-0000-4000-8000-000000000006', '2026-01-01', 'done', '2026-01-01 17:00+00', '2026-01-01 18:00+00', null);

insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind, trainer_comment
) values
  ('46000000-0000-4000-8000-000000000020', '46000000-0000-4000-8000-000000000010', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Присед', 'legs', 'strength', 'Первый результат'),
  ('46000000-0000-4000-8000-000000000021', '46000000-0000-4000-8000-000000000011', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Присед', 'legs', 'strength', null),
  ('46000000-0000-4000-8000-000000000022', '46000000-0000-4000-8000-000000000012', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Присед', 'legs', 'strength', null),
  ('46000000-0000-4000-8000-000000000023', '46000000-0000-4000-8000-000000000013', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Присед', 'legs', 'strength', null),
  ('46000000-0000-4000-8000-000000000024', '46000000-0000-4000-8000-000000000014', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'squat', 'Присед', 'legs', 'strength', null),
  ('46000000-0000-4000-8000-000000000025', '46000000-0000-4000-8000-000000000015', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'push-up', 'Отжимания', 'chest', 'reps', null),
  ('46000000-0000-4000-8000-000000000026', '46000000-0000-4000-8000-000000000016', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'plank', 'Планка', 'core', 'duration', null),
  ('46000000-0000-4000-8000-000000000027', '46000000-0000-4000-8000-000000000017', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 'system', 'run', 'Бег', 'cardio', 'distance', null),
  ('46000000-0000-4000-8000-000000000028', '46000000-0000-4000-8000-000000000018', '46000000-0000-4000-8000-000000000006', '46000000-0000-4000-8000-000000000007', 0, 'system', 'run', 'Бег', 'cardio', 'distance', null);

insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position,
  plan_weight_kg, plan_reps, fact_weight_kg, fact_reps,
  fact_duration_sec, fact_distance_km, confirmed_at
) values
  ('46000000-0000-4000-8000-000000000030', '46000000-0000-4000-8000-000000000020', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 50, 10, 50, 10, null, null, '2026-01-01 09:30+00'),
  ('46000000-0000-4000-8000-000000000031', '46000000-0000-4000-8000-000000000020', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 1, 45, 8, 45, 8, null, null, '2026-01-01 09:40+00'),
  ('46000000-0000-4000-8000-000000000032', '46000000-0000-4000-8000-000000000021', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 55, 8, 55, 8, null, null, '2026-01-02 09:30+00'),
  ('46000000-0000-4000-8000-000000000033', '46000000-0000-4000-8000-000000000021', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 1, 100, 1, 100, 1, null, null, null),
  ('46000000-0000-4000-8000-000000000034', '46000000-0000-4000-8000-000000000022', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 55, 10, 55, 10, null, null, '2026-01-03 09:30+00'),
  ('46000000-0000-4000-8000-000000000035', '46000000-0000-4000-8000-000000000023', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 200, 1, null, null, null, null, null),
  ('46000000-0000-4000-8000-000000000036', '46000000-0000-4000-8000-000000000024', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, 200, 1, 200, 1, null, null, '2026-01-04 09:30+00'),
  ('46000000-0000-4000-8000-000000000037', '46000000-0000-4000-8000-000000000025', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, null, 25, null, 25, null, null, '2026-01-01 11:30+00'),
  ('46000000-0000-4000-8000-000000000038', '46000000-0000-4000-8000-000000000026', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, null, null, null, null, 90, null, '2026-01-01 13:30+00'),
  ('46000000-0000-4000-8000-000000000039', '46000000-0000-4000-8000-000000000027', '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', 0, null, null, null, null, null, 5.25, '2026-01-01 15:30+00'),
  ('46000000-0000-4000-8000-000000000040', '46000000-0000-4000-8000-000000000028', '46000000-0000-4000-8000-000000000006', '46000000-0000-4000-8000-000000000007', 0, null, null, null, null, null, 3.5, '2026-01-01 17:30+00');

select has_function(
  'public', 'list_exercise_progress',
  array['uuid', 'text', 'integer', 'timestamp with time zone', 'uuid'],
  'paginated exercise progress RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);

select results_eq(
  $$select workout_id, workout_date, confirmed_set_count, primary_value,
      previous_primary_value, primary_change, best_weight_kg, reps_at_best_weight,
      best_weight_reps, all_time_primary_value, all_time_best_weight_kg,
      all_time_best_weight_reps, is_primary_pr, is_weight_pr, is_weight_reps_pr, total_count
    from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    )$$,
  $$values
    ('46000000-0000-4000-8000-000000000012'::uuid, '2026-01-03'::date, 1, 55::numeric, 55::numeric, 0::numeric, 55::numeric, 10, 550::numeric, 55::numeric, 55::numeric, 550::numeric, false, false, true, 3::bigint),
    ('46000000-0000-4000-8000-000000000011'::uuid, '2026-01-02'::date, 1, 55::numeric, 50::numeric, 5::numeric, 55::numeric, 8, 440::numeric, 55::numeric, 55::numeric, 550::numeric, true, true, false, 3::bigint),
    ('46000000-0000-4000-8000-000000000010'::uuid, '2026-01-01'::date, 2, 50::numeric, null::numeric, null::numeric, 50::numeric, 10, 500::numeric, 55::numeric, 55::numeric, 550::numeric, true, true, true, 3::bigint)$$,
  'strength progress uses confirmed fact and compares PR only with earlier workouts'
);

select results_eq(
  $$select workout_id from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 2, null, null
    )$$,
  $$values
    ('46000000-0000-4000-8000-000000000012'::uuid),
    ('46000000-0000-4000-8000-000000000011'::uuid)$$,
  'first page is bounded and stable'
);

select results_eq(
  $$select workout_id from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 2,
      '2026-01-02 10:00+00', '46000000-0000-4000-8000-000000000011'
    )$$,
  $$values ('46000000-0000-4000-8000-000000000010'::uuid)$$,
  'cursor loads only older results'
);

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select workout_id, primary_value, is_weight_pr, is_weight_reps_pr
    from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    )$$,
  $$values
    ('46000000-0000-4000-8000-000000000012'::uuid, 55::numeric, false, true),
    ('46000000-0000-4000-8000-000000000011'::uuid, 55::numeric, true, false),
    ('46000000-0000-4000-8000-000000000010'::uuid, 50::numeric, true, true)$$,
  'client receives the same result as trainer'
);

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::bigint from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    )$$,
  $$values (3::bigint)$$,
  'connected trainer reads the shared progress'
);

select results_eq(
  $$select input_kind, primary_value from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'push-up', 20, null, null
    )$$,
  $$values ('reps'::text, 25::numeric)$$,
  'reps exercise uses repetitions as the transparent primary metric'
);
select results_eq(
  $$select input_kind, primary_value from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'plank', 20, null, null
    )$$,
  $$values ('duration'::text, 90::numeric)$$,
  'duration exercise uses seconds as the transparent primary metric'
);
select results_eq(
  $$select input_kind, primary_value from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'run', 20, null, null
    )$$,
  $$values ('distance'::text, 5.25::numeric)$$,
  'distance exercise uses kilometres as the transparent primary metric'
);

reset role;
update public.workout_sets
set fact_weight_kg = 60
where id = '46000000-0000-4000-8000-000000000030';
set local role authenticated;
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select workout_id, is_weight_pr from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    ) order by completed_at$$,
  $$values
    ('46000000-0000-4000-8000-000000000010'::uuid, true),
    ('46000000-0000-4000-8000-000000000011'::uuid, false),
    ('46000000-0000-4000-8000-000000000012'::uuid, false)$$,
  'corrected fact deterministically recalculates later PR flags'
);

reset role;
update public.workouts
set deleted_at = '2026-01-05 10:00+00'
where id = '46000000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select workout_id, is_weight_pr, is_weight_reps_pr from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    ) order by completed_at$$,
  $$values
    ('46000000-0000-4000-8000-000000000011'::uuid, true, true),
    ('46000000-0000-4000-8000-000000000012'::uuid, false, true)$$,
  'deleted fact disappears and remaining PR flags are recalculated'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000006', true);
select results_eq(
  $$select count(*)::bigint from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000007', 'run', 20, null, null
    )$$,
  $$values (1::bigint)$$,
  'standalone client keeps access to their own confirmed progress'
);

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    )$$,
  'PT403', 'client_access_denied', 'unrelated trainer cannot read exercise progress'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.list_exercise_progress(
      '46000000-0000-4000-8000-000000000005', 'squat', 20, null, null
    )$$,
  '28000', 'authentication_required', 'anonymous caller is rejected'
);
select ok(
  not has_function_privilege('anon', 'public.list_exercise_progress(uuid,text,integer,timestamptz,uuid)', 'EXECUTE'),
  'anon has no execute grant'
);
select ok(
  has_function_privilege('authenticated', 'public.list_exercise_progress(uuid,text,integer,timestamptz,uuid)', 'EXECUTE'),
  'authenticated role can execute exercise progress'
);

select * from finish();
rollback;
