begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('52000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'question-root@example.test', ''),
  ('52000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'question-responsible@example.test', ''),
  ('52000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'question-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('52000000-0000-4000-8000-000000000001', 'trainer', 'Основной'),
  ('52000000-0000-4000-8000-000000000002', 'trainer', 'Ответственный'),
  ('52000000-0000-4000-8000-000000000003', 'client', 'Клиент');
insert into public.trainers (profile_id) values
  ('52000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('52000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000003', 'Клиент вопроса', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('52000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000002');
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at, version) values
  ('52000000-0000-4000-8000-000000000005', '52000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000002', current_date, 'done', now() - interval '1 hour', now(), 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000003', true);
select is(public.ask_workout_question('52000000-0000-4000-8000-000000000005', 'Как оценишь?', 1), 2::bigint, 'client asks about a workout assigned to its responsible trainer');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select is(public.answer_workout_question('52000000-0000-4000-8000-000000000005', 'thumbs_up', 'Всё хорошо', 2), 3::bigint, 'workout author can answer even when not the client root trainer');
select results_eq(
  $$select trainer_review, client_question_resolved_at is not null from public.workouts where id = '52000000-0000-4000-8000-000000000005'$$,
  $$values ('Всё хорошо'::text, true)$$,
  'answer is stored and resolves the question'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.answer_workout_question('52000000-0000-4000-8000-000000000005', 'fire', 'Чужой ответ', 3)$$,
  'PT403', 'workout_access_denied', 'client root trainer cannot overwrite another assigned trainer response'
);
reset role;

select * from finish();
rollback;
