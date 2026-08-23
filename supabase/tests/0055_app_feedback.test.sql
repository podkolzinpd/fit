begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('55000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-client@example.test', ''),
  ('55000000-0000-4000-8000-000000000002', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'feedback-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('55000000-0000-4000-8000-000000000001', 'client'),
  ('55000000-0000-4000-8000-000000000002', 'trainer');

select has_table('public', 'app_feedback', 'feedback table exists');
select has_function('public', 'submit_app_feedback', array['text', 'text', 'text', 'text', 'text', 'text'], 'feedback RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000001', true);

create temp table client_feedback as
select public.submit_app_feedback('suggestion', '  Добавьте календарь  ', '/me/profile', '0.1.0', 'browser', 'Test client') as id;

reset role;
select results_eq(
  $$select account_role, kind, message, screen_path, app_version, display_mode from public.app_feedback where id = (select id from client_feedback)$$,
  $$values ('client'::text, 'suggestion'::text, 'Добавьте календарь'::text, '/me/profile'::text, '0.1.0'::text, 'browser'::text)$$,
  'client feedback keeps normalized context'
);
select is(
  (select user_id from public.app_feedback where id = (select id from client_feedback)),
  '55000000-0000-4000-8000-000000000001'::uuid,
  'author comes from auth context'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000002', true);
create temp table trainer_feedback as
select public.submit_app_feedback('problem', 'Не открывается тренировка', '/profile?from=home', '0.1.0', 'standalone', 'Test trainer') as id;
reset role;

select is(
  (select account_role from public.app_feedback where id = (select id from trainer_feedback)),
  'trainer'::text,
  'trainer role is derived on the server'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.submit_app_feedback('other', 'Достаточно длинно', '/', '0.1.0', 'browser', 'Test')$$,
  '23514', null, 'unknown feedback kind is rejected'
);
select throws_ok(
  $$select public.submit_app_feedback('problem', '  ', '/', '0.1.0', 'browser', 'Test')$$,
  '23514', null, 'empty feedback is rejected'
);
select throws_ok(
  $$select public.submit_app_feedback('problem', 'Проблема', '/', '0.1.0', 'native', 'Test')$$,
  '23514', null, 'unknown display mode is rejected'
);
select throws_ok(
  $$select * from public.app_feedback$$,
  '42501', null, 'authenticated users cannot read feedback rows'
);
select throws_ok(
  $$insert into public.app_feedback (user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent) values ('55000000-0000-4000-8000-000000000001', 'client', 'problem', 'Direct insert', '/', '0.1.0', 'browser', 'Test')$$,
  '42501', null, 'authenticated users cannot insert directly'
);

reset role;
select * from finish();
rollback;
