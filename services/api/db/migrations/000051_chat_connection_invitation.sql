-- Up Migration

alter table public.chat_conversations
  add column connection_invited_at timestamptz,
  add column connection_accepted_at timestamptz;

create function public.get_chat_connection_state(p_conversation_id uuid)
returns table (
  active_connection boolean,
  invitation_pending boolean,
  invited_at timestamptz,
  can_invite boolean,
  can_accept boolean,
  trainer_switch_required boolean
)
language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as id),
  conversation as (
    select stored.*
    from public.chat_conversations stored, actor
    where stored.id = p_conversation_id
      and actor.id in (stored.client_user_id, stored.trainer_id)
  ),
  connection as (
    select
      conversation.*,
      exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = conversation.client_id
          and relationship.trainer_id = conversation.trainer_id
          and relationship.status = 'active'
      ) or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = conversation.client_id
          and membership.trainer_id = conversation.trainer_id
      ) as is_active,
      exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = conversation.client_id
          and relationship.trainer_id <> conversation.trainer_id
          and relationship.status = 'active'
      ) as has_other_trainer
    from conversation
  )
  select
    connection.is_active,
    connection.connection_invited_at is not null
      and connection.connection_accepted_at is null
      and not connection.is_active,
    connection.connection_invited_at,
    actor.id = connection.trainer_id
      and not connection.is_active
      and not connection.has_other_trainer
      and connection.client_blocked_at is null
      and connection.trainer_blocked_at is null,
    actor.id = connection.client_user_id
      and connection.connection_invited_at is not null
      and connection.connection_accepted_at is null
      and not connection.is_active
      and not connection.has_other_trainer
      and connection.client_blocked_at is null
      and connection.trainer_blocked_at is null,
    connection.has_other_trainer
  from connection cross join actor;
$$;

create function public.send_chat_connection_invitation(p_conversation_id uuid)
returns table (
  active_connection boolean,
  invitation_pending boolean,
  invited_at timestamptz,
  can_invite boolean,
  can_accept boolean,
  trainer_switch_required boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  conversation public.chat_conversations%rowtype;
  client_name text;
begin
  select stored.* into conversation
  from public.chat_conversations stored
  where stored.id = p_conversation_id
  for update;

  if conversation.id is null or actor_id is distinct from conversation.trainer_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  if exists (
    select 1 from public.client_trainer_relationships relationship
    where relationship.client_id = conversation.client_id
      and relationship.trainer_id <> conversation.trainer_id
      and relationship.status = 'active'
  ) then
    raise exception 'trainer_switch_required' using errcode = 'PT409';
  end if;

  if not exists (
    select 1 from public.client_trainer_relationships relationship
    where relationship.client_id = conversation.client_id
      and relationship.trainer_id = conversation.trainer_id
      and relationship.status = 'active'
  ) and not exists (
    select 1 from public.client_trainers membership
    where membership.client_id = conversation.client_id
      and membership.trainer_id = conversation.trainer_id
  ) and conversation.connection_invited_at is null then
    update public.chat_conversations
    set connection_invited_at = now(), connection_accepted_at = null, updated_at = now()
    where id = conversation.id;

    select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Тренер')
    into client_name from public.profiles where id = actor_id;
    insert into app_private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
    select 'chat_message', conversation.client_user_id, client_name, 'Предлагает заниматься вместе',
      jsonb_build_object('conversation_id', conversation.id, 'url', '/chat/' || conversation.id, 'event', 'trainer_invitation'), subscription.id
    from public.push_subscriptions subscription
    where subscription.user_id = conversation.client_user_id
      and coalesce((select preference.enabled from public.notification_preferences preference
        where preference.user_id = conversation.client_user_id and preference.kind = 'chat_message'), true)
    on conflict (kind, user_id, data, subscription_id) do nothing;
  end if;

  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;

create function public.accept_chat_connection_invitation(p_conversation_id uuid)
returns table (
  active_connection boolean,
  invitation_pending boolean,
  invited_at timestamptz,
  can_invite boolean,
  can_accept boolean,
  trainer_switch_required boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  conversation public.chat_conversations%rowtype;
  client_name text;
begin
  select stored.* into conversation
  from public.chat_conversations stored
  where stored.id = p_conversation_id
  for update;

  if conversation.id is null or actor_id is distinct from conversation.client_user_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  if conversation.connection_invited_at is null then
    raise exception 'chat_invitation_required' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.client_trainer_relationships relationship
    where relationship.client_id = conversation.client_id
      and relationship.trainer_id <> conversation.trainer_id
      and relationship.status = 'active'
  ) then
    raise exception 'trainer_switch_required' using errcode = 'PT409';
  end if;

  insert into public.client_trainers (client_id, trainer_id, alias)
  select conversation.client_id, conversation.trainer_id, client.full_name
  from public.clients client
  where client.id = conversation.client_id
    and client.auth_user_id = actor_id
    and client.archived_at is null
    and client.merged_into_client_id is null
  on conflict (client_id, trainer_id) do nothing;
  if not found and not exists (
    select 1 from public.client_trainers membership
    where membership.client_id = conversation.client_id and membership.trainer_id = conversation.trainer_id
  ) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;

  insert into public.client_trainer_relationships (client_id, trainer_id, connected_by)
  select conversation.client_id, conversation.trainer_id, actor_id
  where not exists (
    select 1 from public.client_trainer_relationships relationship
    where relationship.client_id = conversation.client_id and relationship.status = 'active'
  );

  update public.chat_conversations
  set connection_accepted_at = coalesce(connection_accepted_at, now()), updated_at = now()
  where id = conversation.id;

  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Спортсмен')
  into client_name from public.profiles where id = actor_id;
  insert into app_private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  select 'chat_message', conversation.trainer_id, client_name, 'Принял приглашение',
    jsonb_build_object('conversation_id', conversation.id, 'url', '/chat/' || conversation.id, 'event', 'trainer_invitation_accepted'), subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = conversation.trainer_id
    and coalesce((select preference.enabled from public.notification_preferences preference
      where preference.user_id = conversation.trainer_id and preference.kind = 'chat_message'), true)
  on conflict (kind, user_id, data, subscription_id) do nothing;

  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;

revoke all on function public.get_chat_connection_state(uuid),
  public.send_chat_connection_invitation(uuid), public.accept_chat_connection_invitation(uuid) from public;
grant execute on function public.get_chat_connection_state(uuid),
  public.send_chat_connection_invitation(uuid), public.accept_chat_connection_invitation(uuid) to fit_api;

-- Down Migration

-- Connection invitations are rolled forward to preserve chat history and active relationships.
select 1;
