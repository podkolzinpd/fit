begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('62000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-scheduled-trainer@example.test', ''),
  ('62000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-scheduled-client@example.test', ''),
  ('62000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-scheduled-client-no-sub@example.test', ''),
  ('62000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-scheduled-self-client@example.test', '');
insert into public.profiles (id, account_role, first_name, last_name, timezone) values
  ('62000000-0000-4000-8000-000000000001', 'trainer', 'Анна', 'Тренер', 'UTC'),
  ('62000000-0000-4000-8000-000000000002', 'client', null, null, 'UTC'),
  ('62000000-0000-4000-8000-000000000003', 'client', null, null, 'UTC'),
  ('62000000-0000-4000-8000-000000000004', 'client', null, null, 'UTC');
insert into public.trainers (profile_id) values ('62000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002', 'Клиент С Подпиской', 'male', 30, 180),
  ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000003', 'Клиент Без Подписки', 'female', 25, 165),
  ('62000000-0000-4000-8000-000000000012', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000004', 'Самостоятельный Клиент', 'male', 40, 178);
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values
  ('62000000-0000-4000-8000-000000000002', 'https://push.example/scheduled-1', 'p256dh', 'auth'),
  ('62000000-0000-4000-8000-000000000004', 'https://push.example/scheduled-4', 'p256dh', 'auth');

select has_function('private', 'enqueue_workout_scheduled_notification', array['uuid','uuid']::text[], 'producer function exists');

-- Тренер создаёт запланированную тренировку подписанному клиенту — уведомление уходит в outbox.
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    'select public.save_workout(%L::jsonb, null)',
    jsonb_build_object(
      'clientId', '62000000-0000-4000-8000-000000000010',
      'workoutDate', '2026-09-01',
      'startTime', '18:30',
      'exercises', '[]'::jsonb
    )
  ),
  'trainer creates a planned workout for the subscribed client'
);
reset role;

select is(
  (select count(*)::int from private.push_notifications_outbox
    where kind = 'workout_scheduled' and user_id = '62000000-0000-4000-8000-000000000002'),
  1,
  'creating a planned workout for a subscribed client enqueues exactly one notification'
);
select is(
  (select title from private.push_notifications_outbox
    where kind = 'workout_scheduled' and user_id = '62000000-0000-4000-8000-000000000002'),
  'Новая тренировка',
  'the notification uses the expected title'
);
select ok(
  (select body from private.push_notifications_outbox
    where kind = 'workout_scheduled' and user_id = '62000000-0000-4000-8000-000000000002')
    like 'Тренер Анна Тренер запланировал вам тренировку на 01.09.2026 в 18:30%',
  'the notification body names the trainer and the scheduled date/time'
);

-- Тренер создаёт тренировку клиенту без push-подписки — outbox не пополняется.
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    'select public.save_workout(%L::jsonb, null)',
    jsonb_build_object('clientId', '62000000-0000-4000-8000-000000000011', 'workoutDate', '2026-09-01', 'exercises', '[]'::jsonb)
  ),
  'trainer creates a planned workout for a client without a push subscription'
);
reset role;
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '62000000-0000-4000-8000-000000000003'),
  0,
  'no notification is enqueued for a client without an active push subscription'
);

-- Клиент сам создаёт себе тренировку (self-service) — уведомлять себя не нужно.
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000004', true);
select lives_ok(
  format(
    'select public.save_workout(%L::jsonb, null)',
    jsonb_build_object('clientId', '62000000-0000-4000-8000-000000000012', 'workoutDate', '2026-09-01', 'exercises', '[]'::jsonb)
  ),
  'client creates their own planned workout (self-service)'
);
reset role;
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '62000000-0000-4000-8000-000000000004'),
  0,
  'self-service workout creation does not notify the client about themselves'
);

select * from finish();
rollback;
