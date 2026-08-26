-- app_feedback -> Telegram-чат команды.
--
-- analytics.app_feedback (20260826153300) даёт команде доступ на чтение, но
-- требует зайти в DataLens самой. Для оперативной реакции на "problem"/
-- "suggestion" нужен push в чат, где команда уже сидит.
--
-- Tracker-путь (20260825180000, 20260826140000) для этого не подходит:
-- робот-аккаунт с внешнего IP (Supabase Cloud) заблокирован политикой
-- Яндекса на уровне OAuth, легитимного обхода без TVM/Security Design
-- Review нет — эта миграция идёт в Telegram Bot API вместо Tracker,
-- авторизация там токеном бота, а не robot-OAuth, поэтому блокировка
-- не применяется.
--
-- Планировщик — pg_cron (бизнес-триггеры запрещены AGENTS.md,
-- "Инициализация вызывается явно"). HTTP-вызов — pg_net, тот же
-- dispatch/finalize паттерн, что и в tracker-sync: net.http_post
-- асинхронный, ответ приходит позже в net._http_response.
--
-- Токен бота и chat_id НЕ задаются в этой миграции (секреты). На проде
-- оператор один раз выполняет вне git:
--   select vault.create_secret('<bot token>', 'telegram_bot_token');
--   select vault.create_secret('<chat id>', 'telegram_chat_id');
-- Без них dispatch-функция явно проверяет наличие обоих секретов и тихо
-- ничего не делает — на чистом db reset и в CI безопасный no-op.

alter table public.app_feedback
  add column telegram_request_id bigint,
  add column telegram_notified_at timestamptz,
  add column telegram_sync_attempts smallint not null default 0,
  add column telegram_last_error text;

-- Строка исключается из выборки dispatch, как только она уведомлена
-- (telegram_notified_at) ИЛИ ждёт ответа (telegram_request_id) — индекс
-- сужен ровно под условие запроса ниже.
create index app_feedback_telegram_unsynced_idx on public.app_feedback (created_at)
  where telegram_notified_at is null and telegram_request_id is null;

create or replace function private.finalize_app_feedback_telegram_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  feedback record;
  response record;
begin
  for feedback in
    select id, telegram_request_id, telegram_sync_attempts
    from public.app_feedback
    where telegram_request_id is not null
      and telegram_notified_at is null
  loop
    select status_code, content
      into response
      from net._http_response
      where id = feedback.telegram_request_id;

    -- Ответ ещё не пришёл (или сгорел по ttl раньше времени, что при
    -- минутном цикле не должно происходить) — оставляем на следующий тик.
    if not found then
      continue;
    end if;

    if response.status_code between 200 and 299 then
      update public.app_feedback
        set telegram_notified_at = now(),
            telegram_request_id = null
        where id = feedback.id;
    else
      update public.app_feedback
        set telegram_request_id = null,
            telegram_sync_attempts = feedback.telegram_sync_attempts + 1,
            telegram_last_error = left(coalesce(response.content, 'http_status_' || response.status_code), 500)
        where id = feedback.id;
    end if;
  end loop;
end;
$$;

create or replace function private.dispatch_app_feedback_telegram_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  chat_id text;
  feedback record;
  request_id bigint;
begin
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  select decrypted_secret into chat_id
    from vault.decrypted_secrets where name = 'telegram_chat_id' limit 1;

  if token is null or chat_id is null then
    return;
  end if;

  -- 10 попыток — защита от вечного retry на неустранимой ошибке (например,
  -- бота выкинули из чата); после лимита запись остаётся видна в
  -- analytics.app_feedback с telegram_last_error, но не отправляется снова
  -- без ручного вмешательства.
  for feedback in
    select id, kind, message, screen_path, app_version, account_role, created_at
    from public.app_feedback
    where telegram_notified_at is null
      and telegram_request_id is null
      and telegram_sync_attempts < 10
    order by created_at
    limit 20
  loop
    select net.http_post(
      url := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'chat_id', chat_id,
        'text', format(
          E'%s [%s]\nРоль: %s | Экран: %s | Версия: %s\n\n%s',
          case feedback.kind when 'problem' then '🐞 Проблема' else '💡 Пожелание' end,
          feedback.created_at,
          feedback.account_role, feedback.screen_path, feedback.app_version,
          feedback.message
        )
      ),
      timeout_milliseconds := 8000
    )
    into request_id;

    update public.app_feedback
      set telegram_request_id = request_id
      where id = feedback.id;
  end loop;
end;
$$;

create or replace function private.sync_app_feedback_telegram()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.finalize_app_feedback_telegram_notifications();
  perform private.dispatch_app_feedback_telegram_notifications();
end;
$$;

select cron.schedule(
  'notify-app-feedback-telegram',
  '* * * * *',
  $$select private.sync_app_feedback_telegram()$$
);
