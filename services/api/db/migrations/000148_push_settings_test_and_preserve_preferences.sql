-- Up Migration

-- Reconnecting a browser must preserve the user's explicit category choices.
create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_endpoint text := btrim(p_endpoint);
  normalized_p256dh text := btrim(p_p256dh);
  normalized_auth_key text := btrim(p_auth_key);
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_endpoint is null
    or char_length(normalized_endpoint) not between 1 and 2048
    or normalized_endpoint !~ '^https://'
    or normalized_p256dh is null
    or char_length(normalized_p256dh) not between 1 and 512
    or normalized_auth_key is null
    or char_length(normalized_auth_key) not between 1 and 512
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  insert into public.push_subscriptions (
    user_id, endpoint, p256dh, auth_key
  ) values (
    actor_id, normalized_endpoint, normalized_p256dh, normalized_auth_key
  )
  on conflict (user_id, endpoint) do update set
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', true)
  on conflict (user_id, kind) do nothing;
exception
  when check_violation then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
end;
$$;

-- The caller selects a stored endpoint belonging to its own authenticated actor.
-- Only a harmless test message can be enqueued, using the existing dispatcher.
create function public.request_test_push_notification(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  subscription_id uuid;
  actor_role text;
begin
  select profile.account_role into actor_role
    from public.profiles profile where profile.id = actor_id;
  if actor_id is null or not found then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if p_endpoint is null or char_length(btrim(p_endpoint)) not between 1 and 2048
    or btrim(p_endpoint) !~ '^https://' then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('test-push:' || actor_id::text, 0)
  );
  select subscription.id into subscription_id
    from public.push_subscriptions subscription
    where subscription.user_id = actor_id and subscription.endpoint = btrim(p_endpoint);
  if subscription_id is null then
    raise exception 'push_subscription_missing' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from app_private.push_notifications_outbox notification
    where notification.user_id = actor_id and notification.kind = 'test'
      and notification.created_at >= now() - interval '1 minute'
  ) then
    raise exception 'push_test_rate_limited' using errcode = 'PT429';
  end if;

  insert into app_private.push_notifications_outbox (
    kind, user_id, title, body, data, subscription_id
  ) values (
    'test', actor_id, 'Проверка уведомлений Fit',
    'Вы получили тестовое уведомление.',
    jsonb_build_object(
      'test', true, 'test_id', gen_random_uuid(),
      'url', case when actor_role = 'trainer' then '/profile/settings' else '/me/settings' end
    ),
    subscription_id
  );
end;
$$;

revoke all on function public.request_test_push_notification(text) from public;
grant execute on function public.request_test_push_notification(text) to fit_api;

-- Down Migration

revoke execute on function public.request_test_push_notification(text) from fit_api;
drop function public.request_test_push_notification(text);

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_endpoint text := btrim(p_endpoint);
  normalized_p256dh text := btrim(p_p256dh);
  normalized_auth_key text := btrim(p_auth_key);
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_endpoint is null
    or char_length(normalized_endpoint) not between 1 and 2048
    or normalized_endpoint !~ '^https://'
    or normalized_p256dh is null
    or char_length(normalized_p256dh) not between 1 and 512
    or normalized_auth_key is null
    or char_length(normalized_auth_key) not between 1 and 512
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  insert into public.push_subscriptions (
    user_id, endpoint, p256dh, auth_key
  ) values (
    actor_id, normalized_endpoint, normalized_p256dh, normalized_auth_key
  )
  on conflict (user_id, endpoint) do update set
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', true)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;
exception
  when check_violation then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
end;
$$;
