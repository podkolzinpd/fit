alter table public.chat_messages
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer,
  add column image_size_bytes integer;

alter table public.chat_messages alter column body set default '';
alter table public.chat_messages drop constraint chat_messages_body_valid;
alter table public.chat_messages add constraint chat_messages_content_valid check (
  body = btrim(body)
  and char_length(body) <= 4000
  and (char_length(body) > 0 or image_path is not null)
  and (
    (image_path is null and image_mime_type is null and image_width is null and image_height is null and image_size_bytes is null)
    or
    (image_path is not null and image_mime_type = 'image/jpeg'
      and image_width between 1 and 4096 and image_height between 1 and 4096
      and image_size_bytes between 1 and 2097152)
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 2097152, array['image/jpeg'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Chat participants can read photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and exists (
    select 1 from public.chat_conversations conversation
    where conversation.id::text = (storage.foldername(name))[1]
      and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
  )
);

create policy "Chat participants can upload photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and exists (
    select 1 from public.chat_conversations conversation
    where conversation.id::text = (storage.foldername(name))[1]
      and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
  )
);

create or replace function public.list_chat_threads()
returns table (
  conversation_id uuid, client_id uuid, trainer_id uuid, partner_user_id uuid,
  partner_name text, active_connection boolean, last_message_body text,
  last_message_at timestamptz, last_message_sender_id uuid, unread_count bigint
)
language sql stable security definer set search_path = ''
as $$
  with actor as (select auth.uid() as id),
  available as (
    select conversation.client_id, conversation.trainer_id
    from public.chat_conversations conversation, actor
    where actor.id in (conversation.client_user_id, conversation.trainer_id)
    union
    select membership.client_id, membership.trainer_id
    from public.client_trainers membership
    join public.clients client on client.id = membership.client_id
    cross join actor
    where client.auth_user_id is not null
      and actor.id in (client.auth_user_id, membership.trainer_id)
    union
    select client.id, client.trainer_id
    from public.clients client
    cross join actor
    where client.auth_user_id is not null
      and client.trainer_id <> client.auth_user_id
      and actor.id in (client.auth_user_id, client.trainer_id)
  )
  select conversation.id, available.client_id, available.trainer_id,
    case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end,
    coalesce(nullif(btrim(coalesce(partner.first_name, '') || ' ' || coalesce(partner.last_name, '')), ''),
      case when actor.id = client.auth_user_id then 'Тренер' else 'Спортсмен' end),
    (client.trainer_id = available.trainer_id and client.trainer_id <> client.auth_user_id)
      or exists (select 1 from public.client_trainers current_membership
        where current_membership.client_id = available.client_id and current_membership.trainer_id = available.trainer_id),
    coalesce(nullif(last_message.body, ''), case when last_message.image_path is not null then 'Фото' end),
    last_message.created_at, last_message.sender_id,
    case when conversation.id is null then 0 else (
      select count(*) from public.chat_messages unread
      where unread.conversation_id = conversation.id and unread.sender_id <> actor.id
        and unread.created_at > coalesce(
          case when actor.id = conversation.client_user_id then conversation.client_last_read_at else conversation.trainer_last_read_at end,
          '-infinity'::timestamptz)
    ) end
  from available
  join public.clients client on client.id = available.client_id
  cross join actor
  left join public.chat_conversations conversation
    on conversation.client_id = available.client_id and conversation.trainer_id = available.trainer_id
  join public.profiles partner on partner.id = case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end
  left join lateral (
    select message.body, message.image_path, message.created_at, message.sender_id
    from public.chat_messages message where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc limit 1
  ) last_message on true
  order by 8 desc nulls last, 5;
$$;

create function public.list_chat_messages_v2(
  p_conversation_id uuid, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.chat_conversations conversation
    where conversation.id = p_conversation_id and auth.uid() in (conversation.client_user_id, conversation.trainer_id)) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes
    from public.chat_messages message
    where message.conversation_id = p_conversation_id
      and (p_before_created_at is null or (message.created_at, message.id) < (p_before_created_at, p_before_id))
    order by message.created_at desc, message.id desc limit least(greatest(p_limit, 1), 100);
end;
$$;

create function public.send_chat_message_v2(
  p_conversation_id uuid, p_message_id uuid, p_body text,
  p_image_path text, p_image_mime_type text, p_image_width integer,
  p_image_height integer, p_image_size_bytes integer
)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer
)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  conversation public.chat_conversations;
  normalized text := coalesce(btrim(p_body), '');
  recipient_id uuid;
  sender_name text;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if char_length(normalized) > 4000 or (normalized = '' and p_image_path is null) then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if p_image_path is null then
    if p_image_mime_type is not null or p_image_width is not null or p_image_height is not null or p_image_size_bytes is not null then
      raise exception 'chat_message_invalid' using errcode = 'PT422';
    end if;
  elsif p_image_path <> (p_conversation_id::text || '/' || p_message_id::text || '.jpg')
    or p_image_mime_type <> 'image/jpeg'
    or p_image_width not between 1 and 4096 or p_image_height not between 1 and 4096
    or p_image_size_bytes not between 1 and 2097152 then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if exists (select 1 from public.chat_messages message where message.id = p_message_id) then
    if not exists (select 1 from public.chat_messages message where message.id = p_message_id
      and message.conversation_id = p_conversation_id and message.sender_id = actor_id
      and message.body = normalized and message.image_path is not distinct from p_image_path
      and message.image_mime_type is not distinct from p_image_mime_type
      and message.image_width is not distinct from p_image_width
      and message.image_height is not distinct from p_image_height
      and message.image_size_bytes is not distinct from p_image_size_bytes) then
      raise exception 'chat_message_conflict' using errcode = 'PT409';
    end if;
    return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
      message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes
      from public.chat_messages message where message.id = p_message_id;
    return;
  end if;
  insert into public.chat_messages (
    id, conversation_id, sender_id, body, image_path, image_mime_type, image_width, image_height, image_size_bytes, created_at
  ) values (
    p_message_id, p_conversation_id, actor_id, normalized, p_image_path, p_image_mime_type, p_image_width, p_image_height, p_image_size_bytes, now()
  );
  update public.chat_conversations set updated_at = now(),
    client_last_read_at = case when actor_id = client_user_id then now() else client_last_read_at end,
    trainer_last_read_at = case when actor_id = trainer_id then now() else trainer_last_read_at end
    where public.chat_conversations.id = p_conversation_id;
  recipient_id := case when actor_id = conversation.client_user_id then conversation.trainer_id else conversation.client_user_id end;
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Fit') into sender_name
    from public.profiles where public.profiles.id = actor_id;
  insert into private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  select 'chat_message', recipient_id, sender_name, case when normalized = '' then 'Фото' else left(normalized, 160) end,
    jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id, 'url', '/chat/' || p_conversation_id), subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = recipient_id and coalesce((select preference.enabled from public.notification_preferences preference
    where preference.user_id = recipient_id and preference.kind = 'chat_message'), true)
  on conflict (kind, user_id, data, subscription_id) do nothing;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes
    from public.chat_messages message where message.id = p_message_id;
end;
$$;

revoke all on function public.list_chat_messages_v2(uuid, timestamptz, uuid, integer),
  public.send_chat_message_v2(uuid, uuid, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.list_chat_messages_v2(uuid, timestamptz, uuid, integer),
  public.send_chat_message_v2(uuid, uuid, text, text, text, integer, integer, integer) to authenticated;
