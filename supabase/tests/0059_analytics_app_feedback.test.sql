begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'app_feedback'),
  'analytics.app_feedback matview exists'
);
select ok(
  has_table_privilege('datalens_reader', 'analytics.app_feedback', 'SELECT'),
  'datalens_reader has select on analytics.app_feedback'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.app_feedback', 'SELECT'),
  'authenticated role has no select on analytics.app_feedback'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('59000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'app-feedback-trainer@example.test', ''),
  ('59000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Test@Test.com', '');
insert into public.profiles (id, account_role, first_name, last_name) values
  ('59000000-0000-4000-8000-000000000001', 'trainer', 'Аналитика', 'Дашборд'),
  ('59000000-0000-4000-8000-000000000002', 'trainer', 'Тестовый', 'Аккаунт');

set local role authenticated;
select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000001', true);
create temp table real_feedback as
select public.submit_app_feedback('problem', 'Не открывается прогресс клиента', '/progress/1', '0.1.0', 'browser', 'Test') as id;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000002', true);
create temp table test_account_feedback as
select public.submit_app_feedback('suggestion', 'Добавьте тёмную тему', '/profile', '0.1.0', 'standalone', 'Test') as id;
reset role;

refresh materialized view analytics.app_feedback;

select results_eq(
  $$select account_role, kind, message, screen_path, first_name, last_name, is_test_account from analytics.app_feedback where id = (select id from real_feedback)$$,
  $$values ('trainer'::text, 'problem'::text, 'Не открывается прогресс клиента'::text, '/progress/1'::text, 'Аналитика'::text, 'Дашборд'::text, false)$$,
  'real feedback keeps context and author name for triage'
);
select is(
  (select email from analytics.app_feedback where id = (select id from real_feedback)),
  'app-feedback-trainer@example.test'::text,
  'email is normalized to lowercase'
);
select is(
  (select is_test_account from analytics.app_feedback where id = (select id from test_account_feedback)),
  true,
  'known test account email (case-insensitive) is flagged so the team can filter it out'
);
select is(
  (select jobname from cron.job where jobname = 'refresh-analytics-app-feedback'),
  'refresh-analytics-app-feedback'::text,
  'refresh is scheduled via pg_cron'
);

select * from finish();
rollback;
