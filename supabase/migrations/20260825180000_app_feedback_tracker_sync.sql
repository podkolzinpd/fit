-- app_feedback -> Yandex Tracker (очередь YAFIT).
--
-- submit_app_feedback (20260823020000_app_feedback.sql) уже пишет сообщения
-- тренеров/клиентов в app_feedback, но команда не имеет read-доступа к
-- таблице: RLS включён, SELECT-политик нет, GRANT есть только на insert-RPC.
-- Единственный способ увидеть фидбэк сегодня — вручную зайти в БД под
-- service_role. Эта миграция переносит новые записи в Tracker, где команда
-- уже живёт, вместо того чтобы строить отдельный dashboard/уведомления.
--
-- Планировщик — pg_cron (уже используется в проекте для refresh
-- materialized view), а не AFTER INSERT trigger: бизнес-триггеры запрещены
-- AGENTS.md ("Инициализация вызывается явно"). HTTP-вызов — pg_net, он и
-- pg_cron, и supabase_vault уже входят в образ Supabase Postgres, отдельно
-- включать не требуется.
--
-- Двухфазная синхронизация, потому что net.http_post асинхронный (сразу
-- возвращает request_id, реальный ответ приходит позже в net._http_response):
--   1. dispatch — берёт несинхронизированные записи, отправляет create-issue,
--      запоминает request_id.
--   2. finalize — на следующем тике читает net._http_response по этим
--      request_id, при успехе проставляет tracker_issue_key, при ошибке —
--      снимает request_id (чтобы попробовать снова) и считает попытку.
-- Обе фазы объединены в один cron job, дающий раз-в-минуту цикл: сначала
-- собрать прошлый заход, потом отправить новый.
--
-- Токен Tracker НЕ задаётся в этой миграции (секрет). На проде оператор
-- один раз выполняет вне git:
--   select vault.create_secret('<robot OAuth token>', 'tracker_api_token');
-- Без него dispatch-функция явно проверяет наличие секрета и тихо ничего не
-- делает — на чистом db reset и в CI это безопасный no-op, синхронизация
-- просто не запускается, пока оператор не положит токен.

alter table public.app_feedback
  add column tracker_issue_key text,
  add column tracker_request_id bigint,
  add column tracker_sync_attempts smallint not null default 0,
  add column tracker_last_error text;

-- Строка исключается из выборки dispatch, как только у неё появляется
-- tracker_issue_key ИЛИ активный tracker_request_id (ждём ответ) — индекс
-- сужен ровно под условие запроса ниже.
create index app_feedback_tracker_unsynced_idx on public.app_feedback (created_at)
  where tracker_issue_key is null and tracker_request_id is null;

create or replace function private.finalize_app_feedback_tracker_issues()
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
    select id, tracker_request_id, tracker_sync_attempts
    from public.app_feedback
    where tracker_request_id is not null
      and tracker_issue_key is null
  loop
    select status_code, content
      into response
      from net._http_response
      where id = feedback.tracker_request_id;

    -- Ответ ещё не пришёл (или сгорел по ttl раньше времени, что при
    -- минутном цикле не должно происходить) — оставляем на следующий тик.
    if not found then
      continue;
    end if;

    if response.status_code between 200 and 299 then
      update public.app_feedback
        set tracker_issue_key = response.content::jsonb ->> 'key',
            tracker_request_id = null
        where id = feedback.id;
    else
      update public.app_feedback
        set tracker_request_id = null,
            tracker_sync_attempts = feedback.tracker_sync_attempts + 1,
            tracker_last_error = left(coalesce(response.content, 'http_status_' || response.status_code), 500)
        where id = feedback.id;
    end if;
  end loop;
end;
$$;

create or replace function private.dispatch_app_feedback_tracker_issues()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  feedback record;
  request_id bigint;
begin
  select decrypted_secret
    into token
    from vault.decrypted_secrets
    where name = 'tracker_api_token'
    limit 1;

  if token is null then
    return;
  end if;

  -- 10 попыток — защита от вечного retry на неустранимой ошибке (например,
  -- отозванный токен); после лимита запись остаётся видна в БД с
  -- tracker_last_error, но не отправляется снова без ручного вмешательства.
  for feedback in
    select id, kind, message, screen_path, app_version, display_mode, account_role, created_at
    from public.app_feedback
    where tracker_issue_key is null
      and tracker_request_id is null
      and tracker_sync_attempts < 10
    order by created_at
    limit 20
  loop
    select net.http_post(
      url := 'https://st-api.yandex-team.ru/v3/issues/',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || token,
        'X-Org-Id', '0'
      ),
      body := jsonb_build_object(
        'queue', 'YAFIT',
        'summary', format('[app-feedback/%s] %s', feedback.kind, left(feedback.message, 100)),
        'description', format(
          E'Роль: %s\nЭкран: %s\nВерсия приложения: %s\nРежим: %s\nОтправлено: %s\n\n%s',
          feedback.account_role, feedback.screen_path, feedback.app_version,
          feedback.display_mode, feedback.created_at, feedback.message
        ),
        'type', 'task',
        'tags', jsonb_build_array('app-feedback', 'app-feedback-' || feedback.kind),
        'unique', feedback.id::text
      ),
      timeout_milliseconds := 8000
    )
    into request_id;

    update public.app_feedback
      set tracker_request_id = request_id
      where id = feedback.id;
  end loop;
end;
$$;

create or replace function private.sync_app_feedback_tracker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.finalize_app_feedback_tracker_issues();
  perform private.dispatch_app_feedback_tracker_issues();
end;
$$;

select cron.schedule(
  'sync-app-feedback-tracker',
  '* * * * *',
  $$select private.sync_app_feedback_tracker()$$
);
