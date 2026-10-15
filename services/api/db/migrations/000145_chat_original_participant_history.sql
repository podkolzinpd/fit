-- Up Migration

-- A mutable client binding is not the identity of an existing conversation.
-- Retain the original participants, stable IDs and all stored history.
create or replace function public.list_chat_threads()
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
    select client.id, client.trainer_id
    from public.clients client
    join public.trainers trainer on trainer.profile_id = client.trainer_id
    cross join actor
    where client.auth_user_id is not null
      and actor.id in (client.auth_user_id, client.trainer_id)
      and public.is_active_client_trainer_connection(client.id, client.trainer_id)
    union
    select membership.client_id, membership.trainer_id
    from public.client_trainers membership
    join public.clients client on client.id = membership.client_id
    cross join actor
    where client.auth_user_id is not null
      and actor.id in (client.auth_user_id, membership.trainer_id)
      and public.is_active_client_trainer_connection(membership.client_id, membership.trainer_id)
  ), threads (
    conversation_id, client_id, trainer_id, partner_user_id, partner_name,
    active_connection, last_message_body, last_message_at, last_message_sender_id,
    unread_count, can_message, blocked_by_me, blocked_by_partner
  ) as (
  select conversation.id, coalesce(canonical.id, available.client_id), available.trainer_id,
    case when actor.id = coalesce(conversation.client_user_id, client.auth_user_id) then available.trainer_id else coalesce(conversation.client_user_id, client.auth_user_id) end,
    coalesce(nullif(btrim(coalesce(partner.first_name,'') || ' ' || coalesce(partner.last_name,'')),''),
      case when actor.id = coalesce(conversation.client_user_id, client.auth_user_id) then 'Тренер' else 'Спортсмен' end),
    public.is_active_client_trainer_connection(coalesce(canonical.id, available.client_id), available.trainer_id),
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
  -- Only a verified same-owner canonical card may provide a current UI link.
  -- Conversation identity, messages and read cursors are never moved.
  left join lateral (
    with recursive chain as (
      select card.id, card.auth_user_id, card.merged_into_client_id,
        array[card.id] as visited, 1 as depth
      from public.clients card where card.id = available.client_id
      union all
      select next_card.id, next_card.auth_user_id, next_card.merged_into_client_id,
        chain.visited || next_card.id, chain.depth + 1
      from chain
      join public.clients next_card on next_card.id = chain.merged_into_client_id
      where chain.depth < 8 and not next_card.id = any(chain.visited)
    )
    select chain.id from chain
    where chain.merged_into_client_id is null
      and chain.auth_user_id = conversation.client_user_id
      and public.can_access_client(chain.id)
    limit 1
  ) canonical on conversation.id is not null
  join public.profiles partner on partner.id = case when actor.id = coalesce(conversation.client_user_id, client.auth_user_id)
    then available.trainer_id else coalesce(conversation.client_user_id, client.auth_user_id) end
  left join lateral (
    select message.body,message.image_path,message.created_at,message.sender_id
    from public.chat_messages message
    where message.conversation_id = conversation.id and message.deleted_at is null
    order by message.created_at desc,message.id desc limit 1
  ) last_message on true
  where conversation.id is null
    or actor.id in (conversation.client_user_id, conversation.trainer_id)
  )
  select thread.* from threads thread
  where thread.conversation_id is not null or not exists (
    select 1 from threads history
    where history.client_id = thread.client_id and history.trainer_id = thread.trainer_id
      and history.conversation_id is not null
  )
  order by thread.last_message_at desc nulls last,thread.partner_name,thread.conversation_id;
$$;

create or replace function public.open_chat(p_client_id uuid, p_trainer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  client_user uuid;
  stored public.chat_conversations%rowtype;
  result uuid;
begin
  if actor_id is null then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  select auth_user_id into client_user from public.clients
    where id = p_client_id for share;
  select * into stored from public.chat_conversations
    where client_id = p_client_id and trainer_id = p_trainer_id;
  if found then
    if actor_id not in (stored.client_user_id, stored.trainer_id) then
      raise exception 'chat_forbidden' using errcode = 'PT403';
    end if;
    return stored.id;
  end if;
  if client_user is null or actor_id not in (client_user, p_trainer_id)
    or not public.is_active_client_trainer_connection(p_client_id, p_trainer_id) then
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

-- CREATE OR REPLACE preserves grants; restate the narrow execution contract.
revoke all on function public.list_chat_threads(), public.open_chat(uuid,uuid) from public;
grant execute on function public.list_chat_threads(), public.open_chat(uuid,uuid) to fit_api;

-- Down Migration

create or replace function public.list_chat_threads()
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
    select client.id, client.trainer_id
    from public.clients client
    join public.trainers trainer on trainer.profile_id = client.trainer_id
    cross join actor
    where client.auth_user_id is not null
      and actor.id in (client.auth_user_id, client.trainer_id)
      and public.is_active_client_trainer_connection(client.id, client.trainer_id)
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

revoke all on function public.list_chat_threads(), public.open_chat(uuid,uuid) from public;
grant execute on function public.list_chat_threads(), public.open_chat(uuid,uuid) to fit_api;
