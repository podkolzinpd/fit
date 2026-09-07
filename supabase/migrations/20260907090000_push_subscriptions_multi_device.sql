-- Мульти-device push-подписки.
--
-- До сих пор `push_subscriptions.user_id` был самим PK (MVP-ограничение из
-- 20260826190000: «одна активная подписка на пользователя, мульти-device —
-- сознательно не в первой итерации»). На практике это означало, что вход с
-- нового телефона молча замещал подписку старого устройства, а отключение
-- уведомлений на одном телефоне (или протухший endpoint именно на нём)
-- удаляло запись по `user_id` и гасило push сразу на всех устройствах
-- пользователя. Это отдельное решение, которое AGENTS.md прямо требовал для
-- расширения MVP-ограничения — соответствующий раздел там обновлён этим же
-- PR.
--
-- Схема: `id` становится настоящим PK, `user_id` — обычная FK-колонка,
-- `unique (user_id, endpoint)` — естественная идентичность устройства.
-- `push_notifications_outbox` получает `subscription_id`, проставляемый
-- сразу в момент постановки в очередь (в producer'ах), а не при
-- диспетчеризации — так текущий механизм дедупликации через уникальный
-- индекс расширяется на одну колонку, а не заменяется новой схемой доставки.

alter table public.push_subscriptions
  add column id uuid not null default gen_random_uuid();
-- Volatile default -> Postgres переписывает таблицу и заполняет id у всех
-- существующих строк на месте, данные не теряются.

alter table public.push_subscriptions drop constraint push_subscriptions_pkey;
alter table public.push_subscriptions add constraint push_subscriptions_pkey primary key (id);
alter table public.push_subscriptions
  add constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
-- (индекс по user_id раньше был бесплатным побочным эффектом PK на этой
-- колонке; теперь нужен явно — RLS и producer'ы фильтруют именно по нему.)

alter table private.push_notifications_outbox
  add column subscription_id uuid references public.push_subscriptions (id) on delete set null;
-- `set null`, не `cascade`: finalize удаляет протухшую подписку в ТОЙ ЖЕ
-- строке outbox, что только что записала attempts/last_error по этой самой
-- попытке — cascade безвозвратно стёр бы эту диагностику вместе с
-- подпиской. `set null` рвёт связь, но оставляет историю попытки читаемой.

-- Бэкафилл ещё не отправленных строк, поставленных в очередь до этой
-- миграции. До неё у пользователя не могло быть больше одной подписки, так
-- что join ниже детерминирован. Строки без совпадения (пользователь уже
-- отписался до момента накатки миграции) остаются с null и просто не
-- участвуют в новой отправке — так же, как сегодня остаются инертными
-- строки с исчерпанными attempts.
update private.push_notifications_outbox o
  set subscription_id = s.id
  from public.push_subscriptions s
  where o.subscription_id is null
    and o.sent_at is null
    and s.user_id = o.user_id;

drop index private.push_notifications_outbox_dedupe_idx;
create unique index push_notifications_outbox_dedupe_idx
  on private.push_notifications_outbox (kind, user_id, data, subscription_id);

-- producer: напоминания о тренировке — теперь join на все активные подписки
-- клиента вместо exists-проверки, по одной строке outbox на подписку.
create or replace function private.enqueue_workout_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  select
    'workout_reminder',
    c.auth_user_id,
    'Тренировка сегодня',
    case when w.start_time is not null
      then format('Запланирована на %s', to_char(w.start_time, 'HH24:MI'))
      else 'Загляните в расписание на сегодня'
    end,
    jsonb_build_object('workout_id', w.id, 'url', '/workouts/' || w.id),
    s.id
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles p on p.id = c.auth_user_id
  join public.push_subscriptions s on s.user_id = c.auth_user_id
  where w.status = 'planned'
    and w.deleted_at is null
    and c.auth_user_id is not null
    and coalesce(
      (select np.enabled from public.notification_preferences np
        where np.user_id = c.auth_user_id and np.kind = 'workout_reminder'),
      true
    )
    and (current_timestamp at time zone p.timezone)::date = w.workout_date
    and (current_timestamp at time zone p.timezone)::time >= time '09:00'
    and (current_timestamp at time zone p.timezone)::time < time '09:05'
  on conflict (kind, user_id, data, subscription_id) do nothing;
end;
$$;

-- producer: новая тренировка от тренера — цикл по подпискам клиента, по
-- одной строке outbox на устройство. Явную exists-проверку убрали: цикл по
-- нулю подписок сам по себе ничего не вставляет, дополнительная проверка не
-- нужна.
create or replace function private.enqueue_workout_scheduled_notification(p_workout_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  subscription record;
  notification_body text;
begin
  select
    w.workout_date,
    w.start_time,
    w.status,
    c.auth_user_id as client_user_id,
    trainer.first_name as trainer_first_name,
    trainer.last_name as trainer_last_name
  into target
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles trainer on trainer.id = p_trainer_id
  where w.id = p_workout_id;

  if not found or target.status <> 'planned' or target.client_user_id is null then
    return;
  end if;
  if not coalesce(
    (select np.enabled from public.notification_preferences np
      where np.user_id = target.client_user_id and np.kind = 'workout_scheduled'),
    true
  ) then
    return;
  end if;

  notification_body := format(
    'Тренер %s запланировал вам тренировку на %s%s',
    nullif(btrim(coalesce(target.trainer_first_name, '') || ' ' || coalesce(target.trainer_last_name, '')), ''),
    to_char(target.workout_date, 'DD.MM.YYYY'),
    case when target.start_time is not null then ' в ' || to_char(target.start_time, 'HH24:MI') else '' end
  );

  for subscription in
    select id from public.push_subscriptions where user_id = target.client_user_id
  loop
    insert into private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
    values (
      'workout_scheduled',
      target.client_user_id,
      'Новая тренировка',
      notification_body,
      jsonb_build_object('workout_id', p_workout_id, 'url', '/workouts/' || p_workout_id),
      subscription.id
    )
    on conflict (kind, user_id, data, subscription_id) do nothing;
  end loop;
end;
$$;

-- dispatcher: адресуем строго по подписке, поставленной в outbox при
-- постановке в очередь, а не заново джойним по user_id (иначе на пачку
-- пользователя со старой одной подпиской попадали бы все его новые тоже).
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

  select jsonb_agg(jsonb_build_object(
      'id', due.id,
      'subscription', jsonb_build_object(
        'endpoint', due.endpoint,
        'keys', jsonb_build_object('p256dh', due.p256dh, 'auth', due.auth_key)
      ),
      'title', due.title,
      'body', due.body,
      'data', due.data
    ))
    into batch
    from (
      select o.id, o.title, o.body, o.data, s.endpoint, s.p256dh, s.auth_key
      from private.push_notifications_outbox o
      join public.push_subscriptions s on s.id = o.subscription_id
      where o.sent_at is null
        and o.dispatch_request_id is null
        and o.attempts < 10
      order by o.created_at
      limit 20
    ) due;

  if batch is null then
    return;
  end if;

  select net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Dispatch-Secret', secret
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

-- finalize: 404/410-удаление теперь целится в конкретную подписку строки
-- outbox, а не во все подписки пользователя — это и есть сама починка
-- требования «мёртвый endpoint одного телефона не гасит другой».
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
          if (item ->> 'status') in ('404', '410') then
            delete from public.push_subscriptions
              where id = (
                select subscription_id from private.push_notifications_outbox where id = outbox_id
              );
          end if;
        end if;
      end loop;
    else
      update private.push_notifications_outbox
        set dispatch_request_id = null,
            attempts = attempts + 1,
            last_error = left('http_status_' || response.status_code, 500)
        where dispatch_request_id = batch.dispatch_request_id;
    end if;
  end loop;
end;
$$;
