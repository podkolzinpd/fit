-- Hotfix: private.dispatch_push_notifications() (20260826190000) не
-- запускалась ни разу с момента появления секретов в vault на проде —
-- `order by o.created_at limit 20` стоял прямо над `jsonb_agg(...)` без
-- вложенного подзапроса, а Postgres требует, чтобы столбец в ORDER BY либо
-- входил в GROUP BY, либо был частью агрегата. Ошибка была не
-- data-dependent — функция падала на КАЖДОМ вызове, вне зависимости от
-- того, было ли что отправлять. Поскольку sync_push_notifications() вызывает
-- finalize и dispatch в одной транзакции без обработки исключений, каждый
-- падающий dispatch откатывал заодно и finalize того же тика.
--
-- Обнаружено вручную: workout_scheduled push не пришёл тестовому клиенту в
-- проде, хотя запись корректно легла в outbox (dispatch_request_id/attempts
-- оставались NULL/0 — верный признак того, что dispatch вообще не
-- добегал до net.http_post).
--
-- Локальные тесты (0061) этот путь не покрывали: единственный сценарий
-- dispatch с ненулевым результатом проверял no-op без секретов; сценарий с
-- реально сконфигурированными секретами и ожидающей строкой в outbox не
-- прогонялся ни разу — добавлен новым тестом ниже вместе с фиксом.

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
      join public.push_subscriptions s on s.user_id = o.user_id
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
