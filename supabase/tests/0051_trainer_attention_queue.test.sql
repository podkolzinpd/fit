begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('51000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attention-trainer@example.test', ''),
  ('51000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attention-client@example.test', ''),
  ('51000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attention-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('51000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('51000000-0000-4000-8000-000000000002', 'client', 'Клиент'),
  ('51000000-0000-4000-8000-000000000003', 'trainer', 'Чужой');
insert into public.trainers (profile_id) values
  ('51000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000003');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'Клиент очереди', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id, alias) values
  ('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', 'Анна');
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at, version) values
  ('51000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', current_date, 'done', now() - interval '1 hour', now(), 1),
  ('51000000-0000-4000-8000-000000000006', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000002', current_date - 1, 'done', now() - interval '1 day 1 hour', now() - interval '1 day', 1);

select has_column('public', 'workouts', 'client_question', 'question is stored on workout');
select has_column('public', 'client_trainers', 'attention_snoozed_until', 'planning snooze is per trainer and client');
select has_function('public', 'ask_workout_question', array['uuid', 'text', 'bigint'], 'question RPC exists');
select has_function('public', 'answer_workout_question', array['uuid', 'text', 'text', 'bigint'], 'primary trainer answer RPC exists');
select has_function('public', 'resolve_workout_question', array['uuid', 'bigint'], 'resolve RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
select is(public.ask_workout_question('51000000-0000-4000-8000-000000000005', '  Как поставить стопы?  ', 1), 2::bigint, 'client asks the one responsible trainer');
select results_eq(
  $$select client_question, client_question_resolved_at from public.workouts where id = '51000000-0000-4000-8000-000000000005'$$,
  $$values ('Как поставить стопы?'::text, null::timestamptz)$$,
  'question is normalized and starts unresolved'
);
select is(public.ask_workout_question('51000000-0000-4000-8000-000000000005', 'Как поставить стопы?', 1), 2::bigint, 'identical retry is idempotent');
select throws_ok(
  $$select public.ask_workout_question('51000000-0000-4000-8000-000000000005', 'Другой вопрос', 1)$$,
  'PT409', 'workout_conflict', 'changed stale question conflicts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_trainer_attention_workouts()), 1::bigint, 'question appears once in trainer queue');
select is(public.answer_workout_question('51000000-0000-4000-8000-000000000005', 'thumbs_up', 'Стопы чуть шире плеч', 2), 3::bigint, 'primary trainer answers the explicit question');
select ok((select client_question_resolved_at is not null from public.workouts where id = '51000000-0000-4000-8000-000000000005'), 'trainer response resolves question');
select is((select count(*) from public.list_trainer_attention_workouts()), 0::bigint, 'answered question leaves queue');
select ok(public.snooze_client_attention('51000000-0000-4000-8000-000000000004') > now() + interval '13 days', 'planning reminder is snoozed for two weeks');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
select is(public.submit_workout_feedback('51000000-0000-4000-8000-000000000006', 8::smallint, 'hard', true, 'Тянет колено', 1), 2::bigint, 'client reports discomfort');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select client_name, discomfort, client_comment from public.list_trainer_attention_workouts()$$,
  $$values ('Анна'::text, true, 'Тянет колено'::text)$$,
  'unanswered discomfort appears with trainer alias'
);
select is(public.resolve_workout_question('51000000-0000-4000-8000-000000000005', 3), 3::bigint, 'resolving an already answered question is idempotent');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_trainer_attention_workouts()), 0::bigint, 'unrelated trainer sees no queue');
select throws_ok(
  $$select public.snooze_client_attention('51000000-0000-4000-8000-000000000004')$$,
  'PT403', 'client_access_denied', 'unrelated trainer cannot snooze client'
);
reset role;

delete from public.client_trainers
where client_id = '51000000-0000-4000-8000-000000000004'
  and trainer_id = '51000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_trainer_attention_workouts()), 1::bigint, 'legacy root trainer sees attention without membership row');
select ok(public.snooze_client_attention('51000000-0000-4000-8000-000000000004') > now() + interval '13 days', 'snooze restores a missing root membership safely');
reset role;

select ok(not has_function_privilege('anon', 'public.ask_workout_question(uuid,text,bigint)', 'EXECUTE'), 'anon cannot ask questions');
select ok(not has_function_privilege('anon', 'public.answer_workout_question(uuid,text,text,bigint)', 'EXECUTE'), 'anon cannot answer questions');
select ok(not has_function_privilege('anon', 'public.list_trainer_attention_workouts()', 'EXECUTE'), 'anon cannot read trainer queue');
select ok(has_function_privilege('authenticated', 'public.list_trainer_attention_workouts()', 'EXECUTE'), 'authenticated role can call protected queue');

select * from finish();
rollback;
