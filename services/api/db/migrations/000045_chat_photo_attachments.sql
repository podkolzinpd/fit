-- Up Migration

alter table public.chat_messages
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer,
  add column image_size_bytes integer;
alter table public.chat_messages alter column body set default '';
alter table public.chat_messages drop constraint chat_messages_body_valid;
alter table public.chat_messages add constraint chat_messages_content_valid check (
  body=btrim(body) and char_length(body)<=4000 and (char_length(body)>0 or image_path is not null)
  and ((image_path is null and image_mime_type is null and image_width is null and image_height is null and image_size_bytes is null)
    or (image_path is not null and image_mime_type='image/jpeg' and image_width between 1 and 4096
      and image_height between 1 and 4096 and image_size_bytes between 1 and 2097152))
);

create function public.list_chat_messages_v2(
  p_conversation_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50
)
returns table(id uuid,conversation_id uuid,sender_id uuid,body text,created_at timestamptz,image_path text,image_mime_type text,image_width integer,image_height integer,image_size_bytes integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.chat_conversations conversation where conversation.id=p_conversation_id and auth.uid() in(conversation.client_user_id,conversation.trainer_id))
    then raise exception 'chat_forbidden' using errcode='PT403'; end if;
  return query select message.id,message.conversation_id,message.sender_id,message.body,message.created_at,
    message.image_path,message.image_mime_type,message.image_width,message.image_height,message.image_size_bytes
    from public.chat_messages message
    where message.conversation_id=p_conversation_id and (p_before_created_at is null or (message.created_at,message.id)<(p_before_created_at,p_before_id))
    order by message.created_at desc,message.id desc limit least(greatest(p_limit,1),100);
end; $$;

create function public.send_chat_message_v2(
  p_conversation_id uuid,p_message_id uuid,p_body text,p_image_path text,p_image_mime_type text,
  p_image_width integer,p_image_height integer,p_image_size_bytes integer
)
returns table(id uuid,conversation_id uuid,sender_id uuid,body text,created_at timestamptz,image_path text,image_mime_type text,image_width integer,image_height integer,image_size_bytes integer)
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); conversation public.chat_conversations; normalized text:=coalesce(btrim(p_body),''); recipient_id uuid; sender_name text;
begin
  select * into conversation from public.chat_conversations item where item.id=p_conversation_id and actor_id in(item.client_user_id,item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode='PT403'; end if;
  if char_length(normalized)>4000 or (normalized='' and p_image_path is null) then raise exception 'chat_message_invalid' using errcode='PT422'; end if;
  if p_image_path is null then
    if p_image_mime_type is not null or p_image_width is not null or p_image_height is not null or p_image_size_bytes is not null
      then raise exception 'chat_message_invalid' using errcode='PT422'; end if;
  elsif p_image_path<>(p_conversation_id::text||'/'||p_message_id::text||'.jpg') or p_image_mime_type<>'image/jpeg'
    or p_image_width not between 1 and 4096 or p_image_height not between 1 and 4096 or p_image_size_bytes not between 1 and 2097152
    then raise exception 'chat_message_invalid' using errcode='PT422';
  end if;
  if exists(select 1 from public.chat_messages message where message.id=p_message_id) then
    if not exists(select 1 from public.chat_messages message where message.id=p_message_id and message.conversation_id=p_conversation_id
      and message.sender_id=actor_id and message.body=normalized and message.image_path is not distinct from p_image_path
      and message.image_mime_type is not distinct from p_image_mime_type and message.image_width is not distinct from p_image_width
      and message.image_height is not distinct from p_image_height and message.image_size_bytes is not distinct from p_image_size_bytes)
      then raise exception 'chat_message_conflict' using errcode='PT409'; end if;
    return query select message.id,message.conversation_id,message.sender_id,message.body,message.created_at,
      message.image_path,message.image_mime_type,message.image_width,message.image_height,message.image_size_bytes
      from public.chat_messages message where message.id=p_message_id; return;
  end if;
  insert into public.chat_messages(id,conversation_id,sender_id,body,image_path,image_mime_type,image_width,image_height,image_size_bytes,created_at)
    values(p_message_id,p_conversation_id,actor_id,normalized,p_image_path,p_image_mime_type,p_image_width,p_image_height,p_image_size_bytes,now());
  update public.chat_conversations set updated_at=now(),client_last_read_at=case when actor_id=client_user_id then now() else client_last_read_at end,
    trainer_last_read_at=case when actor_id=trainer_id then now() else trainer_last_read_at end where id=p_conversation_id;
  recipient_id:=case when actor_id=conversation.client_user_id then conversation.trainer_id else conversation.client_user_id end;
  select coalesce(nullif(btrim(coalesce(first_name,'')||' '||coalesce(last_name,'')),''),'Fit') into sender_name from public.profiles where id=actor_id;
  insert into app_private.push_notifications_outbox(kind,user_id,title,body,data,subscription_id)
  select 'chat_message',recipient_id,sender_name,case when normalized='' then 'Фото' else left(normalized,160) end,
    jsonb_build_object('conversation_id',p_conversation_id,'message_id',p_message_id,'url','/chat/'||p_conversation_id),subscription.id
    from public.push_subscriptions subscription where subscription.user_id=recipient_id
      and coalesce((select preference.enabled from public.notification_preferences preference where preference.user_id=recipient_id and preference.kind='chat_message'),true)
    on conflict(kind,user_id,data,subscription_id) do nothing;
  return query select message.id,message.conversation_id,message.sender_id,message.body,message.created_at,
    message.image_path,message.image_mime_type,message.image_width,message.image_height,message.image_size_bytes
    from public.chat_messages message where message.id=p_message_id;
end; $$;

revoke all on function public.list_chat_messages_v2(uuid,timestamptz,uuid,integer),
  public.send_chat_message_v2(uuid,uuid,text,text,text,integer,integer,integer) from public;
grant execute on function public.list_chat_messages_v2(uuid,timestamptz,uuid,integer),
  public.send_chat_message_v2(uuid,uuid,text,text,text,integer,integer,integer) to fit_api;

-- Down Migration

revoke execute on function public.list_chat_messages_v2(uuid,timestamptz,uuid,integer),
  public.send_chat_message_v2(uuid,uuid,text,text,text,integer,integer,integer) from fit_api;
drop function public.send_chat_message_v2(uuid,uuid,text,text,text,integer,integer,integer);
drop function public.list_chat_messages_v2(uuid,timestamptz,uuid,integer);
update public.chat_messages set body='Фото' where body='';
alter table public.chat_messages drop constraint chat_messages_content_valid;
alter table public.chat_messages drop column image_path,drop column image_mime_type,drop column image_width,drop column image_height,drop column image_size_bytes;
alter table public.chat_messages add constraint chat_messages_body_valid check(body=btrim(body) and char_length(body) between 1 and 4000);
alter table public.chat_messages alter column body drop default;

