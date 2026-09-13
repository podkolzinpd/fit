alter table public.chat_messages add column deleted_at timestamptz;

alter table public.chat_messages drop constraint chat_messages_content_valid;
alter table public.chat_messages add constraint chat_messages_content_valid check (
  body = btrim(body)
  and char_length(body) <= 4000
  and (
    deleted_at is not null
    or (
      (char_length(body) > 0 or image_path is not null)
      and (
        (image_path is null and image_mime_type is null and image_width is null and image_height is null and image_size_bytes is null)
        or
        (image_path is not null and image_mime_type = 'image/jpeg'
          and image_width between 1 and 4096 and image_height between 1 and 4096
          and image_size_bytes between 1 and 2097152)
      )
    )
  )
);

create policy "Chat senders can delete own photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-media'
  and exists (
    select 1 from public.chat_messages message
    where message.image_path = name and message.sender_id = auth.uid()
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
        and unread.deleted_at is null
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
    from public.chat_messages message
    where message.conversation_id = conversation.id and message.deleted_at is null
    order by message.created_at desc, message.id desc limit 1
  ) last_message on true
  order by 8 desc nulls last, 5;
$$;

create or replace function public.list_chat_messages_v2(
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
    where message.conversation_id = p_conversation_id and message.deleted_at is null
      and (p_before_created_at is null or (message.created_at, message.id) < (p_before_created_at, p_before_id))
    order by message.created_at desc, message.id desc limit least(greatest(p_limit, 1), 100);
end;
$$;

create function public.delete_chat_message(p_conversation_id uuid, p_message_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  stored_path text;
begin
  select message.image_path into stored_path
  from public.chat_messages message
  join public.chat_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.sender_id = actor_id
    and actor_id in (conversation.client_user_id, conversation.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;

  update public.chat_messages
  set body = '', deleted_at = coalesce(deleted_at, now())
  where id = p_message_id;
  return stored_path;
end;
$$;

revoke all on function public.delete_chat_message(uuid, uuid) from public, anon;
grant execute on function public.delete_chat_message(uuid, uuid) to authenticated;
