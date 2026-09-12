-- Up Migration

-- client_trainer_relationships is the source of truth for connection state.
-- Legacy memberships are intentionally left untouched: targeted disconnect
-- operations own access revocation, while these read models avoid guessing at
-- historical production data.

create or replace function public.is_active_client_trainer_connection(
  p_client_id uuid,
  p_trainer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.client_trainer_relationships relationship
      where relationship.client_id = p_client_id
        and relationship.trainer_id = p_trainer_id
        and relationship.status = 'active'
    )
    or (
      not exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = p_client_id
          and relationship.status = 'active'
      )
      and exists (
        select 1 from public.client_trainers membership
        where membership.client_id = p_client_id
          and membership.trainer_id = p_trainer_id
      )
      and not exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = p_client_id
          and relationship.trainer_id = p_trainer_id
          and relationship.status = 'disconnected'
      )
    );
$$;

create or replace function public.list_accessible_client_trainers()
returns table (
  client_id uuid,
  trainer_id uuid,
  first_name text,
  last_name text,
  joined_at timestamptz,
  is_root boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  return query
  select
    candidate.client_id,
    candidate.trainer_id,
    profile.first_name,
    profile.last_name,
    candidate.joined_at,
    candidate.trainer_id = client.trainer_id
  from (
    select source.client_id, source.trainer_id, max(source.joined_at) as joined_at
    from (
      select relationship.client_id, relationship.trainer_id,
        relationship.connected_at as joined_at
      from public.client_trainer_relationships relationship
      union all
      select membership.client_id, membership.trainer_id, membership.joined_at
      from public.client_trainers membership
    ) source
    group by source.client_id, source.trainer_id
  ) candidate
  join public.clients client on client.id = candidate.client_id
  join public.profiles profile on profile.id = candidate.trainer_id
  where public.is_active_client_trainer_connection(candidate.client_id, candidate.trainer_id)
    and client.archived_at is null
    and public.can_access_client(candidate.client_id)
  order by candidate.client_id, candidate.joined_at, candidate.trainer_id;
end;
$$;

create or replace function public.open_chat(p_client_id uuid, p_trainer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_user uuid;
  result uuid;
begin
  select auth_user_id into client_user
  from public.clients
  where id = p_client_id;

  if actor_id is null or client_user is null
    or actor_id not in (client_user, p_trainer_id) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;

  select id into result
  from public.chat_conversations
  where client_id = p_client_id and trainer_id = p_trainer_id;
  if result is not null then
    return result;
  end if;

  if not public.is_active_client_trainer_connection(p_client_id, p_trainer_id) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;

  insert into public.chat_conversations (client_id, client_user_id, trainer_id)
  values (p_client_id, client_user, p_trainer_id)
  on conflict (client_id, trainer_id)
  do update set updated_at = public.chat_conversations.updated_at
  returning id into result;
  return result;
end;
$$;

drop function public.list_chat_threads();
create function public.list_chat_threads()
returns table (
  conversation_id uuid, client_id uuid, trainer_id uuid,
  partner_user_id uuid, partner_name text, active_connection boolean,
  last_message_body text, last_message_at timestamptz,
  last_message_sender_id uuid, unread_count bigint, can_message boolean,
  blocked_by_me boolean, blocked_by_partner boolean
)
language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as id),
  available as (
    select conversation.client_id, conversation.trainer_id
    from public.chat_conversations conversation, actor
    where actor.id in (conversation.client_user_id, conversation.trainer_id)
    union
    select relationship.client_id, relationship.trainer_id
    from public.client_trainer_relationships relationship
    join public.clients client on client.id = relationship.client_id
    cross join actor
    where relationship.status = 'active'
      and client.auth_user_id is not null
      and actor.id in (client.auth_user_id, relationship.trainer_id)
    union
    select membership.client_id, membership.trainer_id
    from public.client_trainers membership
    join public.clients client on client.id = membership.client_id
    cross join actor
    where client.auth_user_id is not null
      and actor.id in (client.auth_user_id, membership.trainer_id)
      and public.is_active_client_trainer_connection(membership.client_id, membership.trainer_id)
  )
  select conversation.id, available.client_id, available.trainer_id,
    case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end,
    coalesce(nullif(btrim(coalesce(partner.first_name,'') || ' ' || coalesce(partner.last_name,'')),''),
      case when actor.id = client.auth_user_id then 'Тренер' else 'Спортсмен' end),
    public.is_active_client_trainer_connection(available.client_id, available.trainer_id),
    coalesce(nullif(last_message.body,''), case when last_message.image_path is not null then 'Фото' end),
    last_message.created_at, last_message.sender_id,
    case when conversation.id is null then 0 else (
      select count(*) from public.chat_messages unread
      where unread.conversation_id = conversation.id
        and unread.sender_id <> actor.id
        and unread.deleted_at is null
        and (unread.created_at,unread.id) > (
          coalesce(case when actor.id = conversation.client_user_id
            then conversation.client_last_read_at else conversation.trainer_last_read_at end,'-infinity'::timestamptz),
          coalesce(case when actor.id = conversation.client_user_id
            then conversation.client_last_read_message_id else conversation.trainer_last_read_message_id end,
            '00000000-0000-0000-0000-000000000000'::uuid)
        )
    ) end,
    coalesce(conversation.client_blocked_at is null and conversation.trainer_blocked_at is null,true),
    coalesce(case when actor.id = conversation.client_user_id
      then conversation.client_blocked_at is not null else conversation.trainer_blocked_at is not null end,false),
    coalesce(case when actor.id = conversation.client_user_id
      then conversation.trainer_blocked_at is not null else conversation.client_blocked_at is not null end,false)
  from available
  join public.clients client on client.id = available.client_id
  cross join actor
  left join public.chat_conversations conversation
    on conversation.client_id = available.client_id and conversation.trainer_id = available.trainer_id
  join public.profiles partner on partner.id = case when actor.id = client.auth_user_id
    then available.trainer_id else client.auth_user_id end
  left join lateral (
    select message.body,message.image_path,message.created_at,message.sender_id
    from public.chat_messages message
    where message.conversation_id = conversation.id and message.deleted_at is null
    order by message.created_at desc,message.id desc limit 1
  ) last_message on true
  order by 8 desc nulls last,5;
$$;

create or replace function public.get_chat_connection_state(p_conversation_id uuid)
returns table (
  active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean
)
language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as id),
  conversation as (
    select stored.* from public.chat_conversations stored, actor
    where stored.id = p_conversation_id
      and actor.id in (stored.client_user_id, stored.trainer_id)
  ),
  connection as (
    select conversation.*,
      public.is_active_client_trainer_connection(
        conversation.client_id,
        conversation.trainer_id
      ) as is_active,
      exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = conversation.client_id
          and relationship.trainer_id <> conversation.trainer_id
          and relationship.status = 'active'
      ) as has_other_trainer
    from conversation
  )
  select connection.is_active,
    connection.connection_invited_at is not null
      and connection.connection_accepted_at is null and not connection.is_active,
    connection.connection_invited_at,
    actor.id = connection.trainer_id and not connection.is_active
      and not connection.has_other_trainer
      and connection.client_blocked_at is null and connection.trainer_blocked_at is null,
    actor.id = connection.client_user_id and connection.connection_invited_at is not null
      and connection.connection_accepted_at is null and not connection.is_active
      and not connection.has_other_trainer
      and connection.client_blocked_at is null and connection.trainer_blocked_at is null,
    connection.has_other_trainer
  from connection cross join actor;
$$;

create or replace function public.send_chat_connection_invitation(p_conversation_id uuid)
returns table (
  active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  conversation public.chat_conversations%rowtype;
  trainer_name text;
begin
  select stored.* into conversation from public.chat_conversations stored
  where stored.id = p_conversation_id for update;
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

  if not public.is_active_client_trainer_connection(
    conversation.client_id,
    conversation.trainer_id
  ) and conversation.connection_invited_at is null then
    update public.chat_conversations
    set connection_invited_at = now(), connection_accepted_at = null, updated_at = now()
    where id = conversation.id;
    select coalesce(nullif(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')),''),'Тренер')
      into trainer_name from public.profiles where id = actor_id;
    insert into app_private.push_notifications_outbox (kind,user_id,title,body,data,subscription_id)
    select 'chat_message',conversation.client_user_id,trainer_name,'Предлагает заниматься вместе',
      jsonb_build_object('conversation_id',conversation.id,'url','/chat/'||conversation.id,'event','trainer_invitation'),subscription.id
    from public.push_subscriptions subscription
    where subscription.user_id = conversation.client_user_id
      and coalesce((select preference.enabled from public.notification_preferences preference
        where preference.user_id = conversation.client_user_id and preference.kind = 'chat_message'),true)
    on conflict (kind,user_id,data,subscription_id) do nothing;
  end if;
  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;

revoke all on function public.is_active_client_trainer_connection(uuid,uuid) from public,fit_api;
revoke all on function public.list_accessible_client_trainers(), public.open_chat(uuid,uuid),
  public.list_chat_threads(), public.get_chat_connection_state(uuid),
  public.send_chat_connection_invitation(uuid) from public;
grant execute on function public.list_accessible_client_trainers(), public.open_chat(uuid,uuid),
  public.list_chat_threads(), public.get_chat_connection_state(uuid),
  public.send_chat_connection_invitation(uuid) to fit_api;

-- Down Migration

-- Connection state is rolled forward to preserve chat history.
select 1;
