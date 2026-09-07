begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-test-owner@example.test', ''),
  ('63000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-test-other@example.test', '');
insert into public.profiles (id, account_role, timezone) values
  ('63000000-0000-4000-8000-000000000001', 'client', 'UTC'),
  ('63000000-0000-4000-8000-000000000002', 'client', 'UTC');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth_key) values
  ('63000000-0000-4000-8000-000000000010', '63000000-0000-4000-8000-000000000001', 'https://push.example/test-owner', 'p256dh', 'auth'),
  ('63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000002', 'https://push.example/test-other', 'p256dh', 'auth');

select has_function('public', 'send_test_push_notification', array['text']::text[], 'RPC exists');

-- Без vault-секретов dispatch внутри RPC — безопасный no-op (тот же путь,
-- что уже покрыт в 0061), так что вызов не падает даже без сконфигурированной
-- Cloud Function.
delete from vault.secrets where name in ('push_function_url', 'push_dispatch_secret');

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.send_test_push_notification('https://push.example/test-owner')$$,
  'owner can request a test push for their own device'
);
reset role;

select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'test' and user_id = '63000000-0000-4000-8000-000000000001'),
  1,
  'exactly one test notification is enqueued'
);
select is(
  (select subscription_id from private.push_notifications_outbox
    where kind = 'test' and user_id = '63000000-0000-4000-8000-000000000001'),
  '63000000-0000-4000-8000-000000000010'::uuid,
  'the enqueued row targets the caller''s own subscription'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.send_test_push_notification('https://push.example/test-other')$$,
  'PT404', 'subscription_not_found',
  'cannot request a test push for another user''s endpoint'
);
reset role;

select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '63000000-0000-4000-8000-000000000002'),
  0,
  'the other user''s outbox stays untouched by the rejected request'
);

select * from finish();
rollback;
