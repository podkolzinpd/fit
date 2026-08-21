begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('53000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'optional-reaction-trainer@example.test', ''),
  ('53000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'optional-reaction-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('53000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('53000000-0000-4000-8000-000000000002', 'client', 'Клиент');
insert into public.trainers (profile_id) values ('53000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('53000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000002', 'Клиент вопроса', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('53000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000001');
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at, client_question, client_question_asked_at, version) values
  ('53000000-0000-4000-8000-000000000004', '53000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000002', current_date, 'done', now() - interval '1 hour', now(), 'Как оценишь?', now(), 1),
  ('53000000-0000-4000-8000-000000000005', '53000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000002', current_date, 'done', now() - interval '1 hour', now(), 'Можно ли прибавить вес?', now(), 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);

select is(
  public.answer_workout_question('53000000-0000-4000-8000-000000000004', null, '  Шикарно провёл!  ', 1),
  2::bigint,
  'text answer works without an optional reaction'
);
select results_eq(
  $$select trainer_reaction, trainer_review, client_question_resolved_at is not null from public.workouts where id = '53000000-0000-4000-8000-000000000004'$$,
  $$values (null::text, 'Шикарно провёл!'::text, true)$$,
  'answer is normalized, stored and resolves the question'
);
select is(
  public.answer_workout_question('53000000-0000-4000-8000-000000000004', null, 'Шикарно провёл!', 2),
  2::bigint,
  'exact retry without reaction is idempotent'
);
select throws_ok(
  $$select public.answer_workout_question('53000000-0000-4000-8000-000000000005', 'unknown', 'Ответ', 1)$$,
  'PT422', 'invalid_trainer_response', 'unknown reaction is rejected'
);
select throws_ok(
  $$select public.answer_workout_question('53000000-0000-4000-8000-000000000005', null, '   ', 1)$$,
  'PT422', 'invalid_trainer_response', 'empty answer remains invalid'
);

reset role;
select * from finish();
rollback;
