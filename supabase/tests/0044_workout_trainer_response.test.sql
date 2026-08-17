begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('44000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'response-root@example.test', ''),
  ('44000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'response-member@example.test', ''),
  ('44000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'response-client@example.test', ''),
  ('44000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'response-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('44000000-0000-4000-8000-000000000001', 'trainer', 'Root'),
  ('44000000-0000-4000-8000-000000000002', 'trainer', 'Member'),
  ('44000000-0000-4000-8000-000000000003', 'client', 'Client'),
  ('44000000-0000-4000-8000-000000000004', 'trainer', 'Outsider');
insert into public.trainers (profile_id) values
  ('44000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-000000000002'),
  ('44000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000003', 'Response client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000002');
insert into public.workouts (
  id, trainer_id, client_id, created_by, workout_date, status,
  started_at, completed_at, version, session_rpe, wellbeing, discomfort
) values
  ('44000000-0000-4000-8000-000000000006', '44000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000001', current_date, 'done', now() - interval '1 hour', now(), 1, null, null, null),
  ('44000000-0000-4000-8000-000000000007', '44000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000002', current_date - 1, 'done', now() - interval '2 hours', now() - interval '1 hour', 1, null, null, null),
  ('44000000-0000-4000-8000-000000000008', '44000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000003', current_date - 2, 'done', now() - interval '3 hours', now() - interval '2 hours', 1, 6, 'normal', false),
  ('44000000-0000-4000-8000-000000000009', '44000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000001', current_date + 1, 'planned', null, null, 1, null, null, null);

select has_column('public', 'workouts', 'trainer_reaction', 'trainer reaction is stored on workout');
select has_column('public', 'workouts', 'trainer_review_author_id', 'response author is stored');
select has_column('public', 'workouts', 'trainer_reviewed_at', 'response time is stored');
select has_function('public', 'set_workout_review', array['uuid', 'text', 'text', 'bigint'], 'trainer response RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
select is(
  public.set_workout_review('44000000-0000-4000-8000-000000000006', 'fire', '  Отличный темп  ', 1),
  2::bigint,
  'workout author saves a reaction and short reply'
);
select is((select trainer_reaction from public.workouts where id = '44000000-0000-4000-8000-000000000006'), 'fire', 'reaction is stored');
select is((select trainer_review from public.workouts where id = '44000000-0000-4000-8000-000000000006'), 'Отличный темп', 'reply is trimmed');
select is((select trainer_review_author_id from public.workouts where id = '44000000-0000-4000-8000-000000000006'), '44000000-0000-4000-8000-000000000001'::uuid, 'reply author is stored');
select ok((select trainer_reviewed_at is not null from public.workouts where id = '44000000-0000-4000-8000-000000000006'), 'reply time is stored');
select is(
  public.set_workout_review('44000000-0000-4000-8000-000000000006', 'fire', 'Отличный темп', 1),
  2::bigint,
  'exact retry after a lost response is idempotent'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000006', 'strong', 'Добавь вес', 1)$$,
  'PT409', 'workout_conflict', 'changed stale response conflicts'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000009', 'thumbs_up', 'Рано', 1)$$,
  'PT422', 'workout_not_completed', 'planned workout cannot receive a response'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000007', 'thumbs_up', 'Подмена ответа участника', 1)$$,
  'PT403', 'workout_access_denied', 'root trainer cannot answer another trainer assignment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', true);
select is(
  public.set_workout_review('44000000-0000-4000-8000-000000000007', 'strong', 'Продолжаем', 1),
  2::bigint,
  'member trainer answers own assignment'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000008', 'fire', 'Не ответственный', 1)$$,
  'PT403', 'workout_access_denied', 'additional trainer cannot answer a client-authored workout'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
select is(
  public.set_workout_review('44000000-0000-4000-8000-000000000008', 'thumbs_up', 'Спасибо за самостоятельную работу', 1),
  2::bigint,
  'root trainer answers a completed client-authored workout'
);
select results_eq(
  $$select session_rpe, wellbeing, discomfort, client_comment from public.workouts where id = '44000000-0000-4000-8000-000000000008'$$,
  $$values (6::smallint, 'normal'::text, false, null::text)$$,
  'trainer response does not mix with client feedback'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000003', true);
select is((select trainer_reaction from public.list_workouts(null, null, '44000000-0000-4000-8000-000000000005', 50, 0) where id = '44000000-0000-4000-8000-000000000008'), 'thumbs_up', 'client reads the reaction');
select is((select trainer_review from public.list_workouts(null, null, '44000000-0000-4000-8000-000000000005', 50, 0) where id = '44000000-0000-4000-8000-000000000008'), 'Спасибо за самостоятельную работу', 'client reads the reply');
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000008', 'fire', 'Подмена клиента', 2)$$,
  'PT403', 'workout_access_denied', 'client cannot write a trainer response'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.workouts where id = '44000000-0000-4000-8000-000000000008'), 0::bigint, 'unrelated trainer cannot read the response row');
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000008', 'fire', 'Чужой ответ', 2)$$,
  'PT403', 'workout_access_denied', 'unrelated trainer cannot write a response'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000006', 'heart', 'Неверная реакция', 2)$$,
  'PT422', 'invalid_trainer_response', 'reaction is limited to the public choices'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000006', 'fire', '   ', 2)$$,
  'PT422', 'invalid_trainer_response', 'short reply is required with a reaction'
);
select throws_ok(
  $$select public.set_workout_review('44000000-0000-4000-8000-000000000006', 'fire', repeat('x', 501), 2)$$,
  'PT422', 'trainer_response_too_long', 'reply is limited to 500 characters'
);
reset role;

select * from finish();
rollback;
