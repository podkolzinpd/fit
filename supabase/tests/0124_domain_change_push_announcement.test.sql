begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function(
  'private',
  'enqueue_domain_change_announcement',
  array['boolean'],
  'domain-change push producer exists'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'domain-push-1@example.test', ''),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'domain-push-2@example.test', ''),
  ('d0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'domain-push-3@example.test', '');
insert into public.profiles (id, account_role) values
  ('d0000000-0000-4000-8000-000000000001', 'client'),
  ('d0000000-0000-4000-8000-000000000002', 'client'),
  ('d0000000-0000-4000-8000-000000000003', 'trainer');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth_key) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'https://push.example/domain-1a', 'key', 'auth'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'https://push.example/domain-1b', 'key', 'auth'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 'https://push.example/domain-2', 'key', 'auth'),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000003', 'https://push.example/domain-3', 'key', 'auth');
insert into public.notification_preferences (user_id, kind, enabled) values
  ('d0000000-0000-4000-8000-000000000001', 'workout_reminder', true),
  ('d0000000-0000-4000-8000-000000000002', 'workout_reminder', false),
  ('d0000000-0000-4000-8000-000000000002', 'workout_scheduled', false),
  ('d0000000-0000-4000-8000-000000000002', 'chat_message', false);

select results_eq(
  $$select eligible_users, eligible_subscriptions, already_queued, inserted
      from private.enqueue_domain_change_announcement(false)$$,
  $$values (2::bigint, 3::bigint, 0::bigint, 0::bigint)$$,
  'inspect reports only aggregate eligible counts and does not enqueue'
);
select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'service_domain_changed_2026_09'),
  0,
  'inspect leaves the outbox unchanged'
);
select results_eq(
  $$select eligible_users, eligible_subscriptions, already_queued, inserted
      from private.enqueue_domain_change_announcement(true)$$,
  $$values (2::bigint, 3::bigint, 0::bigint, 3::bigint)$$,
  'apply fans out once to every eligible subscription'
);
select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'service_domain_changed_2026_09'
      and user_id = 'd0000000-0000-4000-8000-000000000001'),
  2,
  'multi-device user receives one outbox row per device'
);
select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'service_domain_changed_2026_09'
      and user_id = 'd0000000-0000-4000-8000-000000000002'),
  0,
  'user who disabled every notification category is excluded'
);
select results_eq(
  $$select distinct title, body, data ->> 'url'
      from private.push_notifications_outbox
      where kind = 'service_domain_changed_2026_09'$$,
  $$values (
      'FIT теперь на новом адресе - fit-training.ru'::text,
      'Работа по старой ссылке скоро будет прекращена.'::text,
      '/'::text
    )$$,
  'announcement carries the reviewed copy and redirect-safe root URL'
);
select results_eq(
  $$select eligible_users, eligible_subscriptions, already_queued, inserted
      from private.enqueue_domain_change_announcement(true)$$,
  $$values (2::bigint, 3::bigint, 3::bigint, 0::bigint)$$,
  'repeated apply is idempotent'
);
select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'service_domain_changed_2026_09'),
  3,
  'repeated apply creates no duplicates'
);

select * from finish();
rollback;
