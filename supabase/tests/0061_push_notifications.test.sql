begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Трейнер + клиент со связанным auth-аккаунтом (иначе клиент не пользуется
-- приложением и push ему не нужен), таймзона фиксирована для предсказуемости.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-trainer@example.test', ''),
  ('61000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-client@example.test', '');
insert into public.profiles (id, account_role, timezone) values
  ('61000000-0000-4000-8000-000000000001', 'trainer', 'UTC'),
  ('61000000-0000-4000-8000-000000000002', 'client', 'UTC');
insert into public.trainers (profile_id) values ('61000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values ('61000000-0000-4000-8000-000000000010', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'Клиент Пуш', 'male', 30, 180);

-- Схема объектов
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select has_table('public', 'notification_preferences', 'notification_preferences exists');
select has_function('private', 'enqueue_workout_reminders', array[]::text[], 'producer function exists');
select has_function('private', 'dispatch_push_notifications', array[]::text[], 'dispatch function exists');
select has_function('private', 'finalize_push_notifications', array[]::text[], 'finalize function exists');
select is(
  (select schedule from cron.job where jobname = 'enqueue-workout-reminders'),
  '*/5 * * * *',
  'producer runs every 5 minutes'
);
select is(
  (select schedule from cron.job where jobname = 'sync-push-notifications'),
  '* * * * *',
  'dispatcher runs every minute'
);

-- RLS: клиент управляет только своей подпиской и настройками.
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
values ('61000000-0000-4000-8000-000000000002', 'https://push.example/ep1', 'p256dh-key', 'auth-key');
select throws_ok(
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values ('61000000-0000-4000-8000-000000000001', 'https://push.example/ep2', 'k', 'k')$$,
  '42501', null, 'cannot create a push subscription for another user'
);
reset role;

-- Клиент вне окна 9:00 (текущее время теста не гарантированно совпадает с
-- 9:00 UTC) не должен получить напоминание "в лоб" — проверяем логику окна
-- явно через прямую вставку тестовой тренировки и подмену условия отдельным
-- прогоном ниже; здесь проверяем сам факт отсутствия дублей при повторном
-- вызове producer (idempotency), которая не зависит от времени суток.
insert into public.workouts (id, trainer_id, client_id, workout_date, start_time, status)
values ('61000000-0000-4000-8000-000000000020', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000010', current_date, '09:00', 'planned');

-- Форсируем окно 9:00 руками — вставляем строку outbox напрямую с тем же
-- ключом дедупликации, которым воспользовался бы producer, и проверяем, что
-- повторный insert с тем же (kind, user_id, data) не создаёт дубль.
insert into private.push_notifications_outbox (kind, user_id, title, body, data)
values ('workout_reminder', '61000000-0000-4000-8000-000000000002', 'Тренировка сегодня', 'Запланирована на 09:00', jsonb_build_object('workout_id', '61000000-0000-4000-8000-000000000020'));
insert into private.push_notifications_outbox (kind, user_id, title, body, data)
values ('workout_reminder', '61000000-0000-4000-8000-000000000002', 'Тренировка сегодня', 'Запланирована на 09:00', jsonb_build_object('workout_id', '61000000-0000-4000-8000-000000000020'))
on conflict (kind, user_id, data) do nothing;
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000002'),
  1,
  'dedupe index prevents a duplicate reminder for the same workout'
);

-- Без сконфигурированных секретов dispatch — безопасный no-op.
delete from vault.secrets where name in ('push_function_url', 'push_dispatch_secret');
select private.dispatch_push_notifications();
select is(
  (select count(*)::int from private.push_notifications_outbox where dispatch_request_id is not null),
  0,
  'dispatch is a no-op when push secrets are not configured'
);

-- finalize: успешный batch-ответ Cloud Function (эмулирован прямой
-- вставкой в net._http_response — pg_net сюда пишет асинхронно после
-- реального запроса, но для проверки разбора ответа сеть не нужна).
update private.push_notifications_outbox
  set dispatch_request_id = 999201
  where user_id = '61000000-0000-4000-8000-000000000002';
insert into net._http_response (id, status_code, content)
values (999201, 200, jsonb_build_object(
  'results', jsonb_build_array(jsonb_build_object(
    'id', (select id from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000002'),
    'ok', true
  ))
)::text);
select private.finalize_push_notifications();
select ok(
  (select sent_at from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000002') is not null,
  'finalize marks the outbox row as sent on a successful response'
);
select is(
  (select dispatch_request_id from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000002'),
  null::bigint,
  'finalize clears the request id on a successful response'
);

-- finalize: неуспешный ответ с истёкшей подпиской (410 Gone) — попытка
-- засчитана, причина сохранена, мёртвая подписка удалена.
insert into private.push_notifications_outbox (id, kind, user_id, title, body, data, dispatch_request_id)
values ('61000000-0000-4000-8000-000000000030', 'workout_reminder', '61000000-0000-4000-8000-000000000002', 'Тест', 'Тест', jsonb_build_object('workout_id', 'other'), 999202);
insert into net._http_response (id, status_code, content)
values (999202, 200, jsonb_build_object(
  'results', jsonb_build_array(jsonb_build_object(
    'id', '61000000-0000-4000-8000-000000000030', 'ok', false, 'status', '410', 'error', 'subscription expired'
  ))
)::text);
select private.finalize_push_notifications();
select results_eq(
  $$select dispatch_request_id, attempts from private.push_notifications_outbox where id = '61000000-0000-4000-8000-000000000030'$$,
  $$values (null::bigint, 1::smallint)$$,
  'finalize clears the request id and counts the attempt on a failed response'
);
select ok(
  (select last_error from private.push_notifications_outbox where id = '61000000-0000-4000-8000-000000000030') like '%expired%',
  'finalize stores the failure reason for later triage'
);
select is(
  (select count(*)::int from public.push_subscriptions where user_id = '61000000-0000-4000-8000-000000000002'),
  0,
  'finalize removes the subscription on 410 Gone so future dispatch does not retry a dead endpoint'
);

-- producer: клиент без пуш-подписки не получает напоминание, даже если
-- окно времени и статус тренировки совпадают. Пересобираем окружение под
-- реальный вызов producer с управляемым временем — таймзона клиента
-- смещена так, чтобы текущий момент теста точно попал в окно 09:00-09:05.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('61000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-client-2@example.test', '');
-- Таймзона вычисляется так, чтобы локальное время клиента прямо сейчас
-- попадало в середину окна 09:00-09:05 независимо от того, когда реально
-- запускаются тесты (POSIX offset-текст для `AT TIME ZONE` вычитает
-- значение из UTC, поэтому знак инвертирован относительно желаемого сдвига).
insert into public.profiles (id, account_role, timezone)
select '61000000-0000-4000-8000-000000000003', 'client', zone.tz
from (
  select case when extract(epoch from -wrapped.off) >= 0 then '+' else '-' end
    || to_char(abs(extract(hour from -wrapped.off)), 'FM00') || ':' || to_char(abs(extract(minute from -wrapped.off)), 'FM00') as tz
  from (
    select case
      when raw.off < interval '-12 hours' then raw.off + interval '24 hours'
      when raw.off > interval '12 hours' then raw.off - interval '24 hours'
      else raw.off
    end as off
    from (select (time '09:02:00' - (now() at time zone 'UTC')::time) as off) raw
  ) wrapped
) zone;
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values ('61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'Клиент Без Пуша', 'female', 28, 165);
insert into public.workouts (id, trainer_id, client_id, workout_date, start_time, status)
select '61000000-0000-4000-8000-000000000021', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011',
  (current_timestamp at time zone p.timezone)::date, '09:00', 'planned'
from public.profiles p where p.id = '61000000-0000-4000-8000-000000000003';
select private.enqueue_workout_reminders();
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000003'),
  0,
  'producer skips a client without an active push subscription'
);

-- producer: с подпиской и в пределах окна 9:00 клиент получает напоминание.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
values ('61000000-0000-4000-8000-000000000003', 'https://push.example/ep3', 'p256dh-key-3', 'auth-key-3');
select private.enqueue_workout_reminders();
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000003' and kind = 'workout_reminder'),
  1,
  'producer enqueues a reminder for a subscribed client whose local time is in the 09:00 window'
);
select is(
  (select (data ->> 'workout_id')::uuid from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000003'),
  '61000000-0000-4000-8000-000000000021'::uuid,
  'the enqueued reminder references the correct workout'
);

-- producer: повторный вызов не создаёт дубль (та же тренировка).
select private.enqueue_workout_reminders();
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000003'),
  1,
  'producer is idempotent across repeated runs for the same workout'
);

-- producer: клиент, явно выключивший этот вид уведомлений, не получает push.
insert into public.notification_preferences (user_id, kind, enabled)
values ('61000000-0000-4000-8000-000000000002', 'workout_reminder', false);
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
values ('61000000-0000-4000-8000-000000000002', 'https://push.example/ep4', 'p256dh-key-4', 'auth-key-4');
insert into public.workouts (id, trainer_id, client_id, workout_date, start_time, status)
values ('61000000-0000-4000-8000-000000000022', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000010', current_date, '09:00', 'planned');
update public.profiles set timezone = (select timezone from public.profiles where id = '61000000-0000-4000-8000-000000000003')
  where id = '61000000-0000-4000-8000-000000000002';
select private.enqueue_workout_reminders();
select is(
  (select count(*)::int from private.push_notifications_outbox where user_id = '61000000-0000-4000-8000-000000000002' and data ->> 'workout_id' = '61000000-0000-4000-8000-000000000022'),
  0,
  'producer respects an explicit opt-out in notification_preferences'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select * from private.push_notifications_outbox$$,
  '42501', null, 'authenticated users cannot read the private outbox table'
);
reset role;

select * from finish();
rollback;
