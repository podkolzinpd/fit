-- Rollback-backend parity for the one-time canonical-domain announcement.
-- Production enqueue is operated against Yandex through the private runner.
create or replace function private.enqueue_domain_change_announcement(
  p_apply boolean default false
)
returns table (
  eligible_users bigint,
  eligible_subscriptions bigint,
  already_queued bigint,
  inserted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted bigint := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('domain_change_announcement_2026_09', 0)
  );

  with eligible as (
    select subscription.id, subscription.user_id
    from public.push_subscriptions subscription
    where exists (
      select 1
      from (values
        ('workout_reminder'),
        ('workout_scheduled'),
        ('chat_message')
      ) category(kind)
      where coalesce((
        select preference.enabled
        from public.notification_preferences preference
        where preference.user_id = subscription.user_id
          and preference.kind = category.kind
      ), true)
    )
  )
  select
    count(distinct eligible.user_id),
    count(*),
    count(notification.id)
  into eligible_users, eligible_subscriptions, already_queued
  from eligible
  left join private.push_notifications_outbox notification
    on notification.subscription_id = eligible.id
    and notification.kind = 'service_domain_changed_2026_09'
    and notification.data = jsonb_build_object(
      'announcement', 'canonical_domain_2026_09',
      'url', '/'
    );

  if p_apply then
    insert into private.push_notifications_outbox (
      kind, user_id, title, body, data, subscription_id
    )
    select
      'service_domain_changed_2026_09',
      subscription.user_id,
      'Fit теперь на новом адресе',
      'Открывайте приложение на fit-training.ru. Старая ссылка пока перенаправляет автоматически.',
      jsonb_build_object(
        'announcement', 'canonical_domain_2026_09',
        'url', '/'
      ),
      subscription.id
    from public.push_subscriptions subscription
    where (
      exists (
        select 1
        from (values
          ('workout_reminder'),
          ('workout_scheduled'),
          ('chat_message')
        ) category(kind)
        where coalesce((
          select preference.enabled
          from public.notification_preferences preference
          where preference.user_id = subscription.user_id
            and preference.kind = category.kind
        ), true)
      )
    )
    on conflict (kind, user_id, data, subscription_id) do nothing;

    get diagnostics v_inserted = row_count;
  end if;

  inserted := v_inserted;
  return next;
end;
$$;

revoke all on function private.enqueue_domain_change_announcement(boolean)
  from public, anon, authenticated;
