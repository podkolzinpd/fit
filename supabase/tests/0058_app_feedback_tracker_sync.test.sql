begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('58000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-sync@example.test', '');
insert into public.profiles (id, account_role) values
  ('58000000-0000-4000-8000-000000000001', 'trainer');

select has_column('public', 'app_feedback', 'tracker_issue_key', 'tracker_issue_key column exists');
select has_column('public', 'app_feedback', 'tracker_request_id', 'tracker_request_id column exists');
select has_column('public', 'app_feedback', 'tracker_sync_attempts', 'tracker_sync_attempts column exists');
select has_column('public', 'app_feedback', 'tracker_last_error', 'tracker_last_error column exists');
select has_function('private', 'dispatch_app_feedback_tracker_issues', array[]::text[], 'dispatch function exists');
select has_function('private', 'finalize_app_feedback_tracker_issues', array[]::text[], 'finalize function exists');
select has_function('private', 'sync_app_feedback_tracker', array[]::text[], 'combined sync function exists');

select is(
  (select schedule from cron.job where jobname = 'sync-app-feedback-tracker'),
  '* * * * *',
  'sync runs every minute'
);

-- Без сконфигурированного секрета dispatch — безопасный no-op: реальный
-- сетевой вызов к Tracker в тестах не делаем (не хотим бить внешний API из
-- CI). Полный round-trip с pg_net уже проверен вручную отдельно.
insert into public.app_feedback (user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent)
values ('58000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Без токена не должно уйти', '/today', '0.1.0', 'browser', 'Test');
delete from vault.secrets where name = 'tracker_api_token';
select private.dispatch_app_feedback_tracker_issues();
select is(
  (select count(*)::int from public.app_feedback where message = 'Без токена не должно уйти' and tracker_request_id is not null),
  0,
  'dispatch is a no-op when no tracker token is configured'
);

-- Предел попыток исключает запись из выборки dispatch, не трогая сеть.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, tracker_sync_attempts)
values ('58000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Достигнут лимит попыток', '/today', '0.1.0', 'browser', 'Test', 10);
select is(
  (select count(*)::int from public.app_feedback where tracker_issue_key is null and tracker_request_id is null and tracker_sync_attempts < 10 and id = '58000000-0000-4000-8000-000000000002'),
  0,
  'row past the retry cap is excluded from dispatch candidates'
);

-- finalize: успешный ответ Tracker (эмулирован прямой вставкой в
-- net._http_response — pg_net сюда пишет асинхронно после реального
-- запроса, но для проверки разбора ответа сеть не нужна).
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, tracker_request_id)
values ('58000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'trainer', 'suggestion', 'Успешная синхронизация', '/today', '0.1.0', 'browser', 'Test', 999001);
insert into net._http_response (id, status_code, content) values (999001, 201, '{"key":"YAFIT-999"}');
select private.finalize_app_feedback_tracker_issues();
select results_eq(
  $$select tracker_issue_key, tracker_request_id from public.app_feedback where id = '58000000-0000-4000-8000-000000000003'$$,
  $$values ('YAFIT-999'::text, null::bigint)$$,
  'finalize records the issue key from a successful response and clears the request id'
);

-- finalize: неуспешный ответ Tracker — попытка засчитана, request id снят
-- (retry на следующем цикле), причина сохранена.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, tracker_request_id, tracker_sync_attempts)
values ('58000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Неуспешная синхронизация', '/today', '0.1.0', 'browser', 'Test', 999002, 2);
insert into net._http_response (id, status_code, content) values (999002, 401, '{"errorMessages":["expired_token"]}');
select private.finalize_app_feedback_tracker_issues();
select results_eq(
  $$select tracker_issue_key, tracker_request_id, tracker_sync_attempts from public.app_feedback where id = '58000000-0000-4000-8000-000000000004'$$,
  $$values (null::text, null::bigint, 3::smallint)$$,
  'finalize clears the request id and counts the attempt on a failed response'
);
select ok(
  (select tracker_last_error from public.app_feedback where id = '58000000-0000-4000-8000-000000000004') like '%expired_token%',
  'finalize stores the failure reason for later triage'
);

-- finalize: ответ ещё не пришёл — запись остаётся ждать без изменений.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, tracker_request_id)
values ('58000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Ответ ещё не пришёл', '/today', '0.1.0', 'browser', 'Test', 999003);
select private.finalize_app_feedback_tracker_issues();
select is(
  (select tracker_request_id from public.app_feedback where id = '58000000-0000-4000-8000-000000000005'),
  999003::bigint,
  'finalize leaves a still-pending request untouched'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.app_feedback$$,
  '42501', null, 'authenticated users still cannot read feedback rows after the sync columns were added'
);
reset role;

select * from finish();
rollback;
