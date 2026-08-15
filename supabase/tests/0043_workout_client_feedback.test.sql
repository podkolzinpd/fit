begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('41000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-trainer@example.test', ''),
  ('41000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-client@example.test', ''),
  ('41000000-0000-4000-8000-000000000003', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'feedback-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('41000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('41000000-0000-4000-8000-000000000002', 'client', 'Клиент'),
  ('41000000-0000-4000-8000-000000000003', 'client', 'Чужой');
insert into public.trainers (profile_id) values ('41000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'Клиент feedback', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at, version) values
  ('41000000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', current_date, 'done', now() - interval '1 hour', now(), 1),
  ('41000000-0000-4000-8000-000000000006', '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000002', current_date - 1, 'done', now() - interval '1 day 1 hour', now() - interval '1 day', 1),
  ('41000000-0000-4000-8000-000000000007', '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', current_date + 1, 'planned', null, null, 1);

select has_function(
  'public', 'submit_workout_feedback',
  array['uuid', 'smallint', 'text', 'boolean', 'text', 'bigint'],
  'client feedback RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
select is(
  public.submit_workout_feedback('41000000-0000-4000-8000-000000000005', 8::smallint, 'normal', true, '  Тянет колено  ', 1),
  2::bigint,
  'client submits feedback for an assigned completed workout'
);
select results_eq(
  $$select session_rpe, wellbeing, discomfort, client_comment, status from public.workouts where id = '41000000-0000-4000-8000-000000000005'$$,
  $$values (8::smallint, 'normal'::text, true, 'Тянет колено'::text, 'done'::text)$$,
  'feedback is normalized without changing the completed fact'
);
select is(
  public.submit_workout_feedback('41000000-0000-4000-8000-000000000005', 8::smallint, 'normal', true, 'Тянет колено', 1),
  2::bigint,
  'identical retry with stale version is idempotent'
);
select is(
  (select version from public.workouts where id = '41000000-0000-4000-8000-000000000005'),
  2::bigint,
  'idempotent retry does not bump version'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000005', 7::smallint, 'good', false, '', 1)$$,
  'PT409', 'workout_conflict', 'changed feedback rejects a stale version'
);
select is(
  public.submit_workout_feedback('41000000-0000-4000-8000-000000000005', 7::smallint, 'good', false, 'не сохранять', 2),
  3::bigint,
  'client can update feedback with the current version'
);
select is(
  (select client_comment from public.workouts where id = '41000000-0000-4000-8000-000000000005'),
  null::text,
  'comment is cleared when discomfort is no'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000007', 5::smallint, 'normal', false, '', 1)$$,
  'PT422', 'workout_not_completed', 'feedback cannot be submitted before completion'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 11::smallint, 'normal', false, '', 1)$$,
  'PT422', 'invalid_workout_feedback', 'session RPE is limited to 1 through 10'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 6::smallint, 'unknown', false, '', 1)$$,
  'PT422', 'invalid_workout_feedback', 'wellbeing accepts only the public contract values'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 6::smallint, 'hard', true, '   ', 1)$$,
  'PT422', 'discomfort_comment_required', 'discomfort yes requires a short explanation'
);
select is(
  public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 6::smallint, 'hard', true, 'Болит плечо', 1),
  2::bigint,
  'client-authored completed workout accepts feedback'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select session_rpe, wellbeing, discomfort, client_comment from public.workouts where id = '41000000-0000-4000-8000-000000000006'$$,
  $$values (6::smallint, 'hard'::text, true, 'Болит плечо'::text)$$,
  'connected trainer sees client feedback'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 5::smallint, 'normal', false, '', 2)$$,
  'PT403', 'workout_access_denied', 'trainer cannot submit client feedback'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.workouts where id = '41000000-0000-4000-8000-000000000006'),
  0::bigint,
  'unrelated account cannot read the workout feedback row'
);
select throws_ok(
  $$select public.submit_workout_feedback('41000000-0000-4000-8000-000000000006', 5::smallint, 'normal', false, '', 2)$$,
  'PT403', 'workout_access_denied', 'unrelated account cannot submit feedback'
);
reset role;

select throws_ok(
  $$insert into public.workouts (trainer_id, client_id, workout_date, session_rpe, wellbeing, discomfort) values ('41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', current_date, 4, null, false)$$,
  '23514', null, 'feedback columns cannot be partially populated'
);

select * from finish();
rollback;
