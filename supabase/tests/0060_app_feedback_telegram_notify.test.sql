begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-telegram@example.test', '');
insert into public.profiles (id, account_role) values
  ('60000000-0000-4000-8000-000000000001', 'trainer');

select has_column('public', 'app_feedback', 'telegram_request_id', 'telegram_request_id column exists');
select has_column('public', 'app_feedback', 'telegram_notified_at', 'telegram_notified_at column exists');
select has_column('public', 'app_feedback', 'telegram_sync_attempts', 'telegram_sync_attempts column exists');
select has_column('public', 'app_feedback', 'telegram_last_error', 'telegram_last_error column exists');
select has_function('private', 'dispatch_app_feedback_telegram_notifications', array[]::text[], 'dispatch function exists');
select has_function('private', 'finalize_app_feedback_telegram_notifications', array[]::text[], 'finalize function exists');
select has_function('private', 'sync_app_feedback_telegram', array[]::text[], 'combined sync function exists');

select is(
  (select schedule from cron.job where jobname = 'notify-app-feedback-telegram'),
  '* * * * *',
  'sync runs every minute'
);

-- Без сконфигурированных секретов dispatch — безопасный no-op: реальный
-- сетевой вызов к Telegram в тестах не делаем (не хотим бить внешний API из
-- CI). Полный round-trip с pg_net уже проверен вручную отдельно.
insert into public.app_feedback (user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent)
values ('60000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Без токена не должно уйти', '/today', '0.1.0', 'browser', 'Test');
delete from vault.secrets where name in ('telegram_bot_token', 'telegram_chat_id');
select private.dispatch_app_feedback_telegram_notifications();
select is(
  (select count(*)::int from public.app_feedback where message = 'Без токена не должно уйти' and telegram_request_id is not null),
  0,
  'dispatch is a no-op when telegram secrets are not configured'
);

-- Предел попыток исключает запись из выборки dispatch, не трогая сеть.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, telegram_sync_attempts)
values ('60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Достигнут лимит попыток', '/today', '0.1.0', 'browser', 'Test', 10);
select is(
  (select count(*)::int from public.app_feedback where telegram_notified_at is null and telegram_request_id is null and telegram_sync_attempts < 10 and id = '60000000-0000-4000-8000-000000000002'),
  0,
  'row past the retry cap is excluded from dispatch candidates'
);

-- finalize: успешный ответ Telegram (эмулирован прямой вставкой в
-- net._http_response — pg_net сюда пишет асинхронно после реального
-- запроса, но для проверки разбора ответа сеть не нужна).
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, telegram_request_id)
values ('60000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', 'trainer', 'suggestion', 'Успешная отправка', '/today', '0.1.0', 'browser', 'Test', 999101);
insert into net._http_response (id, status_code, content) values (999101, 200, '{"ok":true}');
select private.finalize_app_feedback_telegram_notifications();
select ok(
  (select telegram_notified_at from public.app_feedback where id = '60000000-0000-4000-8000-000000000003') is not null,
  'finalize records the notification timestamp on a successful response'
);
select is(
  (select telegram_request_id from public.app_feedback where id = '60000000-0000-4000-8000-000000000003'),
  null::bigint,
  'finalize clears the request id on a successful response'
);

-- finalize: неуспешный ответ Telegram — попытка засчитана, request id снят
-- (retry на следующем цикле), причина сохранена.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, telegram_request_id, telegram_sync_attempts)
values ('60000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Неуспешная отправка', '/today', '0.1.0', 'browser', 'Test', 999102, 2);
insert into net._http_response (id, status_code, content) values (999102, 403, '{"description":"bot was kicked from the chat"}');
select private.finalize_app_feedback_telegram_notifications();
select results_eq(
  $$select telegram_notified_at, telegram_request_id, telegram_sync_attempts from public.app_feedback where id = '60000000-0000-4000-8000-000000000004'$$,
  $$values (null::timestamptz, null::bigint, 3::smallint)$$,
  'finalize clears the request id and counts the attempt on a failed response'
);
select ok(
  (select telegram_last_error from public.app_feedback where id = '60000000-0000-4000-8000-000000000004') like '%kicked%',
  'finalize stores the failure reason for later triage'
);

-- finalize: ответ ещё не пришёл — запись остаётся ждать без изменений.
insert into public.app_feedback (id, user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, telegram_request_id)
values ('60000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000001', 'trainer', 'problem', 'Ответ ещё не пришёл', '/today', '0.1.0', 'browser', 'Test', 999103);
select private.finalize_app_feedback_telegram_notifications();
select is(
  (select telegram_request_id from public.app_feedback where id = '60000000-0000-4000-8000-000000000005'),
  999103::bigint,
  'finalize leaves a still-pending request untouched'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.app_feedback$$,
  '42501', null, 'authenticated users still cannot read feedback rows after the sync columns were added'
);
reset role;

select * from finish();
rollback;
