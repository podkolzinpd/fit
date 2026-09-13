-- Up Migration

alter table public.chat_conversations
  add column origin text not null default 'connection'
    constraint chat_conversations_origin_valid check (origin in ('connection', 'discovery')),
  add column client_blocked_at timestamptz,
  add column trainer_blocked_at timestamptz;

create index chat_conversations_discovery_rate_idx
  on public.chat_conversations (client_user_id, created_at desc)
  where origin = 'discovery';

create function public.open_public_trainer_chat(p_public_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_client_id uuid;
  target_trainer_id uuid;
  result uuid;
begin
  if actor_id is null then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  select client.id into actor_client_id from public.clients client where client.auth_user_id = actor_id;
  select profile.trainer_id into target_trainer_id
    from public.trainer_professional_profiles profile
    where profile.public_id = p_public_id and profile.listed_in_catalog and profile.published_data is not null;
  if actor_client_id is null or target_trainer_id is null or target_trainer_id = actor_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 511));
  select conversation.id into result from public.chat_conversations conversation
    where conversation.client_id = actor_client_id and conversation.trainer_id = target_trainer_id;
  if result is not null then return result; end if;

  if (select count(*) from public.chat_conversations conversation
      where conversation.client_user_id = actor_id and conversation.origin = 'discovery'
        and conversation.created_at >= now() - interval '24 hours') >= 5 then
    raise exception 'chat_rate_limited' using errcode = 'PT429';
  end if;

  insert into public.chat_conversations (client_id, client_user_id, trainer_id, origin)
    values (actor_client_id, actor_id, target_trainer_id, 'discovery')
    on conflict (client_id, trainer_id) do update set updated_at = public.chat_conversations.updated_at
    returning id into result;
  return result;
end;
$$;

create function public.authorize_chat_send(p_conversation_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare conversation public.chat_conversations;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and auth.uid() in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
end;
$$;

create function public.set_chat_block(p_conversation_id uuid, p_blocked boolean)
returns table (can_message boolean, blocked_by_me boolean, blocked_by_partner boolean)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id) for update;
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  update public.chat_conversations item set
    client_blocked_at = case when actor_id = item.client_user_id then case when p_blocked then coalesce(item.client_blocked_at, now()) else null end else item.client_blocked_at end,
    trainer_blocked_at = case when actor_id = item.trainer_id then case when p_blocked then coalesce(item.trainer_blocked_at, now()) else null end else item.trainer_blocked_at end
    where item.id = p_conversation_id returning * into conversation;
  return query select
    conversation.client_blocked_at is null and conversation.trainer_blocked_at is null,
    case when actor_id = conversation.client_user_id then conversation.client_blocked_at is not null else conversation.trainer_blocked_at is not null end,
    case when actor_id = conversation.client_user_id then conversation.trainer_blocked_at is not null else conversation.client_blocked_at is not null end;
end;
$$;

create or replace function public.send_chat_message_v3(
  p_conversation_id uuid, p_message_id uuid, p_body text,
  p_image_path text, p_image_mime_type text, p_image_width integer,
  p_image_height integer, p_image_size_bytes integer, p_reply_to_message_id uuid default null
)
returns setof public.chat_messages
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); conversation public.chat_conversations;
  normalized text := coalesce(btrim(p_body), ''); recipient_id uuid; sender_name text;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  if char_length(normalized) > 4000 or (normalized = '' and p_image_path is null) then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.chat_messages replied where replied.id = p_reply_to_message_id and replied.conversation_id = p_conversation_id
  ) then raise exception 'chat_message_invalid' using errcode = 'PT422'; end if;
  if p_image_path is null then
    if p_image_mime_type is not null or p_image_width is not null or p_image_height is not null or p_image_size_bytes is not null then
      raise exception 'chat_message_invalid' using errcode = 'PT422';
    end if;
  elsif p_image_path <> (p_conversation_id::text || '/' || p_message_id::text || '.jpg')
    or p_image_mime_type <> 'image/jpeg' or p_image_width not between 1 and 4096
    or p_image_height not between 1 and 4096 or p_image_size_bytes not between 1 and 2097152 then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if exists (select 1 from public.chat_messages message where message.id = p_message_id) then
    if not exists (select 1 from public.chat_messages message where message.id = p_message_id
      and message.conversation_id = p_conversation_id and message.sender_id = actor_id
      and message.body = normalized and message.image_path is not distinct from p_image_path
      and message.image_mime_type is not distinct from p_image_mime_type
      and message.image_width is not distinct from p_image_width and message.image_height is not distinct from p_image_height
      and message.image_size_bytes is not distinct from p_image_size_bytes
      and message.reply_to_message_id is not distinct from p_reply_to_message_id) then
      raise exception 'chat_message_conflict' using errcode = 'PT409';
    end if;
    return query select * from public.chat_messages message where message.id = p_message_id;
    return;
  end if;
  insert into public.chat_messages (id, conversation_id, sender_id, body, image_path, image_mime_type,
    image_width, image_height, image_size_bytes, reply_to_message_id, created_at)
    values (p_message_id, p_conversation_id, actor_id, normalized, p_image_path, p_image_mime_type,
      p_image_width, p_image_height, p_image_size_bytes, p_reply_to_message_id, now());
  update public.chat_conversations set updated_at = now() where id = p_conversation_id;
  recipient_id := case when actor_id = conversation.client_user_id then conversation.trainer_id else conversation.client_user_id end;
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Fit') into sender_name
    from public.profiles where id = actor_id;
  insert into app_private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  select 'chat_message', recipient_id, sender_name, case when normalized = '' then 'Фото' else left(normalized, 160) end,
    jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id, 'url', '/chat/' || p_conversation_id), subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = recipient_id and coalesce((select preference.enabled from public.notification_preferences preference
    where preference.user_id = recipient_id and preference.kind = 'chat_message'), true)
  on conflict (kind, user_id, data, subscription_id) do nothing;
  return query select * from public.chat_messages message where message.id = p_message_id;
end;
$$;

create or replace function public.send_chat_message(p_conversation_id uuid, p_message_id uuid, p_body text)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select message.id, message.conversation_id, message.sender_id, message.body, message.created_at
  from public.send_chat_message_v3(p_conversation_id, p_message_id, p_body, null, null, null, null, null, null) message;
$$;

create or replace function public.send_chat_message_v2(
  p_conversation_id uuid, p_message_id uuid, p_body text, p_image_path text, p_image_mime_type text,
  p_image_width integer, p_image_height integer, p_image_size_bytes integer
)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer)
language sql security definer set search_path = '' as $$
  select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes
  from public.send_chat_message_v3(p_conversation_id, p_message_id, p_body, p_image_path, p_image_mime_type,
    p_image_width, p_image_height, p_image_size_bytes, null) message;
$$;

create or replace function public.edit_chat_message(p_conversation_id uuid, p_message_id uuid, p_body text)
returns setof public.chat_messages language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); normalized text := btrim(p_body); conversation public.chat_conversations;
begin
  if normalized is null or char_length(normalized) not between 1 and 4000 then raise exception 'chat_message_invalid' using errcode = 'PT422'; end if;
  select * into conversation from public.chat_conversations item where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then raise exception 'chat_blocked' using errcode = 'PT403'; end if;
  update public.chat_messages message set body = normalized,
    edited_at = case when message.body is distinct from normalized then now() else message.edited_at end
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.sender_id = actor_id and message.deleted_at is null;
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  return query select * from public.chat_messages message where message.id = p_message_id;
end;
$$;

drop function public.list_chat_threads();
create function public.list_chat_threads()
returns table (
  conversation_id uuid, client_id uuid, trainer_id uuid, partner_user_id uuid, partner_name text,
  active_connection boolean, last_message_body text, last_message_at timestamptz,
  last_message_sender_id uuid, unread_count bigint, can_message boolean,
  blocked_by_me boolean, blocked_by_partner boolean
)
language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as id), available as (
    select conversation.client_id, conversation.trainer_id from public.chat_conversations conversation, actor where actor.id in (conversation.client_user_id, conversation.trainer_id)
    union
    select membership.client_id, membership.trainer_id from public.client_trainers membership join public.clients client on client.id = membership.client_id cross join actor
      where client.auth_user_id is not null and actor.id in (client.auth_user_id, membership.trainer_id)
    union
    select client.id, client.trainer_id from public.clients client cross join actor
      where client.auth_user_id is not null and client.trainer_id <> client.auth_user_id and actor.id in (client.auth_user_id, client.trainer_id)
  )
  select conversation.id, available.client_id, available.trainer_id,
    case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end,
    coalesce(nullif(btrim(coalesce(partner.first_name,'') || ' ' || coalesce(partner.last_name,'')),''), case when actor.id = client.auth_user_id then 'Тренер' else 'Спортсмен' end),
    (client.trainer_id = available.trainer_id and client.trainer_id <> client.auth_user_id) or exists (select 1 from public.client_trainers membership where membership.client_id = available.client_id and membership.trainer_id = available.trainer_id),
    coalesce(nullif(last_message.body,''), case when last_message.image_path is not null then 'Фото' end), last_message.created_at, last_message.sender_id,
    case when conversation.id is null then 0 else (select count(*) from public.chat_messages unread where unread.conversation_id = conversation.id
      and unread.sender_id <> actor.id and unread.deleted_at is null and (unread.created_at,unread.id) > (
        coalesce(case when actor.id = conversation.client_user_id then conversation.client_last_read_at else conversation.trainer_last_read_at end,'-infinity'::timestamptz),
        coalesce(case when actor.id = conversation.client_user_id then conversation.client_last_read_message_id else conversation.trainer_last_read_message_id end,'00000000-0000-0000-0000-000000000000'::uuid))) end,
    coalesce(conversation.client_blocked_at is null and conversation.trainer_blocked_at is null, true),
    coalesce(case when actor.id = conversation.client_user_id then conversation.client_blocked_at is not null else conversation.trainer_blocked_at is not null end, false),
    coalesce(case when actor.id = conversation.client_user_id then conversation.trainer_blocked_at is not null else conversation.client_blocked_at is not null end, false)
  from available join public.clients client on client.id = available.client_id cross join actor
  left join public.chat_conversations conversation on conversation.client_id = available.client_id and conversation.trainer_id = available.trainer_id
  join public.profiles partner on partner.id = case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end
  left join lateral (select message.body,message.image_path,message.created_at,message.sender_id from public.chat_messages message
    where message.conversation_id = conversation.id and message.deleted_at is null order by message.created_at desc,message.id desc limit 1) last_message on true
  order by 8 desc nulls last,5;
$$;

revoke all on function public.open_public_trainer_chat(uuid), public.authorize_chat_send(uuid),
  public.set_chat_block(uuid, boolean) from public;
revoke all on function public.list_chat_threads() from public;
grant execute on function public.open_public_trainer_chat(uuid), public.authorize_chat_send(uuid),
  public.set_chat_block(uuid, boolean) to fit_api;
grant execute on function public.list_chat_threads() to fit_api;


-- Down Migration

-- Security migrations are rolled forward. A corrective migration must preserve existing chat history.
select 1;
