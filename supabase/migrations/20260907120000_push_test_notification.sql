-- Диагностический пуш для онбординга: пользователь только что включил
-- уведомления, ему нужно видимое подтверждение "работает", не дожидаясь
-- минутного cron-тика sync-push-notifications.
--
-- kind='test' — не пользовательская категория: не читает
-- notification_preferences (нет опции отключить самопроверку) и не
-- участвует в producer-конвейере других сценариев. Это разовый зонд самого
-- пайплайна producer -> dispatcher -> sender, а не push-уведомление в
-- продуктовом смысле.

create or replace function public.send_test_push_notification(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_subscription uuid;
begin
  select id into target_subscription
    from public.push_subscriptions
    where user_id = actor and endpoint = p_endpoint;

  if not found then
    raise exception 'subscription_not_found' using errcode = 'PT404';
  end if;

  insert into private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  values (
    'test',
    actor,
    'Тестовое уведомление',
    'Если вы это видите — уведомления работают.',
    jsonb_build_object('test', true, 'sent_at', extract(epoch from clock_timestamp())),
    target_subscription
  );
  -- Без on conflict: 'sent_at' в data делает каждый вызов уникальным для
  -- dedupe-индекса, так что повторные нажатия "отправить тест" всегда ставят
  -- в очередь свежую строку, а не молча схлопываются в уже отправленную.

  -- Не ждём минутный cron — раз пользователь ждёт ответа прямо сейчас,
  -- диспетчеризация идёт в той же транзакции.
  perform private.dispatch_push_notifications();
end;
$$;

-- 20260809060000 revoked PUBLIC execute retroactively and set a default for
-- role postgres going forward, but a fresh SECURITY DEFINER function created
-- here still surfaced a PUBLIC grant in local testing (0041) — revoking it
-- explicitly rather than relying on the default to have taken effect.
revoke execute on function public.send_test_push_notification(text) from public;
grant execute on function public.send_test_push_notification(text) to authenticated;
