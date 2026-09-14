create function public.authorize_chat_media_read(
  p_conversation_id uuid, p_message_id uuid
)
returns void language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1
    from public.chat_messages message
    join public.chat_conversations conversation on conversation.id = message.conversation_id
    where message.conversation_id = p_conversation_id
      and message.id = p_message_id
      and message.deleted_at is null
      and message.image_path = p_conversation_id::text || '/' || p_message_id::text || '.jpg'
      and actor_id in (conversation.client_user_id, conversation.trainer_id)
  ) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
end;
$$;

create function public.authorize_chat_media_remove(
  p_conversation_id uuid, p_message_id uuid
)
returns void language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1
    from public.chat_messages message
    where message.conversation_id = p_conversation_id
      and message.id = p_message_id
      and message.deleted_at is not null
      and message.sender_id = actor_id
      and message.image_path = p_conversation_id::text || '/' || p_message_id::text || '.jpg'
  ) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
end;
$$;

revoke all on function public.authorize_chat_media_read(uuid, uuid),
  public.authorize_chat_media_remove(uuid, uuid) from public, anon;
grant execute on function public.authorize_chat_media_read(uuid, uuid),
  public.authorize_chat_media_remove(uuid, uuid) to authenticated;
