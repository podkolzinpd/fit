-- Web Push для пользователей приложения (не для команды — команда уже
-- получает уведомления через Telegram/DataLens, см. 20260826180000).
--
-- Первый сценарий: напоминание клиенту в 9:00 по его локальному времени
-- (`profiles.timezone`) о запланированной на сегодня тренировке.
-- Архитектура рассчитана на новые сценарии без переделки инфраструктуры:
--   producer (своя SQL-функция на сценарий, кладёт строки в outbox) →
--   dispatcher (общий, шлёт пачку в Cloud Function) →
--   sender (Cloud Function `fit-send-push-notifications`, шифрует и
--   реально отправляет через Web Push API).
--
-- Шифрование Web Push (ECDH + VAPID JWT) — не задача для чистого SQL,
-- поэтому dispatcher не бьёт Push-сервисы напрямую (в отличие от
-- Tracker/Telegram, это простой bearer-POST), а идёт в отдельную Cloud
-- Function по тому же принципу, что и `fit-summarize-client-training`.
--
-- MVP-ограничение: одна активная push-подписка на пользователя
-- (`push_subscriptions.user_id` — primary key). Мульти-device — будущее
-- расширение, сознательно не в первой итерации.

create table public.push_subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_not_blank check (btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank check (btrim(p256dh) <> ''),
  constraint push_subscriptions_auth_key_not_blank check (btrim(auth_key) <> '')
);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

create policy "push_subscriptions_manage_own" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Реестр видов уведомлений живёт неявно как значения `kind` (первое —
-- 'workout_reminder'); флаг по умолчанию включён, строка появляется только
-- когда пользователь явно выключает конкретный вид в настройках.
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

create policy "notification_preferences_manage_own" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Outbox — не выставлен через Data API (схема `private` без USAGE для
-- anon/authenticated, см. 20260727000801), доступ только через
-- security definer функции ниже.
create table private.push_notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dispatch_request_id bigint,
  sent_at timestamptz,
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  constraint push_notifications_outbox_title_not_blank check (btrim(title) <> ''),
  constraint push_notifications_outbox_body_not_blank check (btrim(body) <> '')
);

create unique index push_notifications_outbox_dedupe_idx
  on private.push_notifications_outbox (kind, user_id, data);

create index push_notifications_outbox_unsynced_idx
  on private.push_notifications_outbox (created_at)
  where sent_at is null and dispatch_request_id is null;

create or replace function private.enqueue_workout_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.push_notifications_outbox (kind, user_id, title, body, data)
  select
    'workout_reminder',
    c.auth_user_id,
    'Тренировка сегодня',
    case when w.start_time is not null
      then format('Запланирована на %s', to_char(w.start_time, 'HH24:MI'))
      else 'Загляните в расписание на сегодня'
    end,
    jsonb_build_object('workout_id', w.id)
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles p on p.id = c.auth_user_id
  where w.status = 'planned'
    and w.deleted_at is null
    and c.auth_user_id is not null
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = c.auth_user_id)
    and coalesce(
      (select np.enabled from public.notification_preferences np
        where np.user_id = c.auth_user_id and np.kind = 'workout_reminder'),
      true
    )
    and (current_timestamp at time zone p.timezone)::date = w.workout_date
    and (current_timestamp at time zone p.timezone)::time >= time '09:00'
    and (current_timestamp at time zone p.timezone)::time < time '09:05'
  on conflict (kind, user_id, data) do nothing;
end;
$$;

create or replace function private.finalize_push_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch record;
  response record;
  results jsonb;
  item jsonb;
  outbox_id uuid;
begin
  for batch in
    select distinct dispatch_request_id
    from private.push_notifications_outbox
    where dispatch_request_id is not null and sent_at is null
  loop
    select status_code, content
      into response
      from net._http_response
      where id = batch.dispatch_request_id;

    -- Ответ ещё не пришёл — оставляем на следующий тик.
    if not found then
      continue;
    end if;

    if response.status_code between 200 and 299 then
      results := coalesce(response.content::jsonb -> 'results', '[]'::jsonb);
      for item in select * from jsonb_array_elements(results)
      loop
        outbox_id := (item ->> 'id')::uuid;
        if (item ->> 'ok')::boolean then
          update private.push_notifications_outbox
            set sent_at = now(), dispatch_request_id = null
            where id = outbox_id;
        else
          update private.push_notifications_outbox
            set dispatch_request_id = null,
                attempts = attempts + 1,
                last_error = left(coalesce(item ->> 'error', 'unknown'), 500)
            where id = outbox_id;
          -- Подписка протухла (браузер отписался/сбросил хранилище) —
          -- убираем её, чтобы не долбить один и тот же мёртвый endpoint.
          if (item ->> 'status') in ('404', '410') then
            delete from public.push_subscriptions
              where user_id = (
                select user_id from private.push_notifications_outbox where id = outbox_id
              );
          end if;
        end if;
      end loop;
    else
      -- Транспортная ошибка на уровне всей пачки (функция недоступна и
      -- т.п.) — освобождаем для повторной отправки следующим тиком.
      update private.push_notifications_outbox
        set dispatch_request_id = null,
            attempts = attempts + 1,
            last_error = left('http_status_' || response.status_code, 500)
        where dispatch_request_id = batch.dispatch_request_id;
    end if;
  end loop;
end;
$$;

create or replace function private.dispatch_push_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  secret text;
  batch jsonb;
  request_id bigint;
begin
  select decrypted_secret into function_url
    from vault.decrypted_secrets where name = 'push_function_url' limit 1;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;

  if function_url is null or secret is null then
    return;
  end if;

  -- 10 попыток — тот же предел, что у tracker/telegram sync: после лимита
  -- запись остаётся с last_error, но не отправляется снова без ручного
  -- вмешательства (например, если подписка мертва, а finalize её ещё не
  -- успел убрать).
  select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'subscription', jsonb_build_object(
        'endpoint', s.endpoint,
        'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth_key)
      ),
      'title', o.title,
      'body', o.body,
      'data', o.data
    ))
    into batch
    from private.push_notifications_outbox o
    join public.push_subscriptions s on s.user_id = o.user_id
    where o.sent_at is null
      and o.dispatch_request_id is null
      and o.attempts < 10
    order by o.created_at
    limit 20;

  if batch is null then
    return;
  end if;

  select net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('notifications', batch),
    timeout_milliseconds := 8000
  )
  into request_id;

  update private.push_notifications_outbox
    set dispatch_request_id = request_id
    where id in (select (item ->> 'id')::uuid from jsonb_array_elements(batch) item);
end;
$$;

create or replace function private.sync_push_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.finalize_push_notifications();
  perform private.dispatch_push_notifications();
end;
$$;

select cron.schedule(
  'enqueue-workout-reminders',
  '*/5 * * * *',
  $$select private.enqueue_workout_reminders()$$
);

select cron.schedule(
  'sync-push-notifications',
  '* * * * *',
  $$select private.sync_push_notifications()$$
);
