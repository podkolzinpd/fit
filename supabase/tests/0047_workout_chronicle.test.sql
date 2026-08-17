begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('47000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chronicle-trainer@example.test', ''),
  ('47000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chronicle-client@example.test', ''),
  ('47000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chronicle-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('47000000-0000-4000-8000-000000000001', 'trainer', 'Trainer'),
  ('47000000-0000-4000-8000-000000000002', 'client', 'Client'),
  ('47000000-0000-4000-8000-000000000003', 'trainer', 'Outsider');
insert into public.trainers (profile_id) values
  ('47000000-0000-4000-8000-000000000001'),
  ('47000000-0000-4000-8000-000000000003');
insert into public.clients (
  id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm
) values (
  '47000000-0000-4000-8000-000000000004',
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000002',
  'Chronicle client', 'female', 30, 170
);

insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status,
  started_at, completed_at, session_rpe, wellbeing, discomfort, client_comment,
  trainer_reaction, trainer_review, trainer_review_author_id, trainer_reviewed_at
) values
  ('47000000-0000-4000-8000-000000000010', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', '47000000-0000-4000-8000-000000000001', '2026-01-01', 'done', '2026-01-01 09:00+00', '2026-01-01 10:00+00', null, null, null, null, null, null, null, null),
  ('47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', '47000000-0000-4000-8000-000000000001', '2026-01-02', 'done', '2026-01-02 09:00+00', '2026-01-02 10:00+00', null, null, null, null, null, null, null, null),
  ('47000000-0000-4000-8000-000000000012', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', '47000000-0000-4000-8000-000000000001', '2026-01-03', 'done', '2026-01-03 09:00+00', '2026-01-03 10:00+00', 8, 'hard', true, 'Тянет колено', 'fire', 'Снизим вес в следующий раз', '47000000-0000-4000-8000-000000000001', '2026-01-03 11:00+00');

insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, exercise_name, muscle_group, input_kind
) values
  ('47000000-0000-4000-8000-000000000020', '47000000-0000-4000-8000-000000000010', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 'system', 'squat', 'Присед', 'legs', 'strength'),
  ('47000000-0000-4000-8000-000000000021', '47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 'system', 'squat', 'Присед', 'legs', 'strength'),
  ('47000000-0000-4000-8000-000000000022', '47000000-0000-4000-8000-000000000012', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 'system', 'squat', 'Присед', 'legs', 'strength');

insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position,
  fact_weight_kg, fact_reps, confirmed_at
) values
  ('47000000-0000-4000-8000-000000000030', '47000000-0000-4000-8000-000000000020', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 40, 10, '2026-01-01 09:30+00'),
  ('47000000-0000-4000-8000-000000000031', '47000000-0000-4000-8000-000000000021', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 40, 12, '2026-01-02 09:30+00'),
  ('47000000-0000-4000-8000-000000000032', '47000000-0000-4000-8000-000000000022', '47000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000004', 0, 40, 10, '2026-01-03 09:30+00');

select has_function(
  'public', 'workout_has_personal_record', array['uuid'],
  'chronicle PR helper exists'
);
select has_function(
  'public', 'list_workout_personal_records', array['uuid'],
  'workout PR details RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select id, has_pr from public.list_workouts(
      null, null, '47000000-0000-4000-8000-000000000004', 2, 0
    )$$,
  $$values
    ('47000000-0000-4000-8000-000000000012'::uuid, false),
    ('47000000-0000-4000-8000-000000000011'::uuid, true)$$,
  'first page is newest-first and PR compares with earlier completed facts'
);
select results_eq(
  $$select id, has_pr from public.list_workouts(
      null, null, '47000000-0000-4000-8000-000000000004', 2, 2
    )$$,
  $$values ('47000000-0000-4000-8000-000000000010'::uuid, true)$$,
  'offset page loads the older chronicle without rereading the first page'
);
select results_eq(
  $$select session_rpe, wellbeing, discomfort, client_comment,
      trainer_reaction, trainer_review
    from public.list_workouts(
      null, null, '47000000-0000-4000-8000-000000000004', 2, 0
    ) where id = '47000000-0000-4000-8000-000000000012'$$,
  $$values (8::smallint, 'hard'::text, true, 'Тянет колено'::text,
    'fire'::text, 'Снизим вес в следующий раз'::text)$$,
  'trainer receives feedback and response in the paginated chronicle row'
);
select results_eq(
  $$select exercise_ref, exercise_name, input_kind, metric, primary_value,
      weight_kg, reps
    from public.list_workout_personal_records(
      '47000000-0000-4000-8000-000000000011'
    )$$,
  $$values ('squat'::text, 'Присед'::text, 'strength'::text,
    'weight_reps'::text, 480::numeric, 40::numeric, 12)$$,
  'trainer gets the exact exercise and achieved result behind a PR'
);

select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select session_rpe, wellbeing, discomfort, client_comment,
      trainer_reaction, trainer_review, has_pr
    from public.list_workouts(
      null, null, '47000000-0000-4000-8000-000000000004', 2, 0
    ) where id = '47000000-0000-4000-8000-000000000012'$$,
  $$values (8::smallint, 'hard'::text, true, 'Тянет колено'::text,
    'fire'::text, 'Снизим вес в следующий раз'::text, false)$$,
  'client receives the same permitted chronicle facts as trainer'
);
select is(
  (select count(*) from public.list_workouts(
    null, null, '47000000-0000-4000-8000-000000000004', 1, 0
  )), 1::bigint, 'requested page size remains bounded'
);
select results_eq(
  $$select exercise_ref, exercise_name, metric, weight_kg, reps
    from public.list_workout_personal_records(
      '47000000-0000-4000-8000-000000000011'
    )$$,
  $$values ('squat'::text, 'Присед'::text, 'weight_reps'::text,
    40::numeric, 12)$$,
  'client gets the same permitted PR details as trainer'
);

select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.list_workouts(
    null, null, '47000000-0000-4000-8000-000000000004', 50, 0
  )), 0::bigint, 'unrelated trainer cannot read chronicle rows'
);
select throws_ok(
  $$select public.workout_has_personal_record('47000000-0000-4000-8000-000000000012')$$,
  '42501', null, 'internal PR helper is not directly callable by authenticated users'
);
select throws_ok(
  $$select * from public.list_workout_personal_records(
    '47000000-0000-4000-8000-000000000011'
  )$$,
  'PT403', 'workout_access_denied',
  'unrelated trainer cannot read PR details'
);
select ok(
  not has_function_privilege(
    'anon', 'public.list_workout_personal_records(uuid)', 'EXECUTE'
  ),
  'anon has no execute grant for PR details'
);

select * from finish();
rollback;
