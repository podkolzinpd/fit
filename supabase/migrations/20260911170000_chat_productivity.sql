alter table public.chat_messages
  add column edited_at timestamptz,
  add column reply_to_message_id uuid references public.chat_messages(id) on delete set null;

alter table public.chat_conversations
  add column client_last_read_message_id uuid,
  add column trainer_last_read_message_id uuid;

update public.chat_conversations conversation set client_last_read_message_id = (
  select message.id from public.chat_messages message
  where message.conversation_id = conversation.id and message.sender_id <> conversation.client_user_id
    and message.deleted_at is null and message.created_at <= conversation.client_last_read_at
  order by message.created_at desc,message.id desc limit 1
) where conversation.client_last_read_at is not null;
update public.chat_conversations conversation set trainer_last_read_message_id = (
  select message.id from public.chat_messages message
  where message.conversation_id = conversation.id and message.sender_id <> conversation.trainer_id
    and message.deleted_at is null and message.created_at <= conversation.trainer_last_read_at
  order by message.created_at desc,message.id desc limit 1
) where conversation.trainer_last_read_at is not null;

create index chat_messages_conversation_body_search_idx
  on public.chat_messages (conversation_id, created_at desc)
  where deleted_at is null and body <> '';

create or replace function public.list_chat_messages_v3(
  p_conversation_id uuid, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer,
  edited_at timestamptz, reply_to_message_id uuid, reply_to_sender_id uuid, reply_to_body text,
  reply_to_has_image boolean, reply_to_deleted boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.chat_conversations conversation
    where conversation.id = p_conversation_id and auth.uid() in (conversation.client_user_id, conversation.trainer_id)) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes,
    message.edited_at, message.reply_to_message_id, replied.sender_id,
    case when replied.deleted_at is null then replied.body else null end,
    (replied.image_path is not null and replied.deleted_at is null),
    (replied.id is not null and replied.deleted_at is not null)
  from public.chat_messages message
  left join public.chat_messages replied on replied.id = message.reply_to_message_id
  where message.conversation_id = p_conversation_id and message.deleted_at is null
    and (p_before_created_at is null or (message.created_at, message.id) < (p_before_created_at, p_before_id))
  order by message.created_at desc, message.id desc limit least(greatest(p_limit, 1), 100);
end;
$$;

create function public.send_chat_message_v3(
  p_conversation_id uuid, p_message_id uuid, p_body text,
  p_image_path text, p_image_mime_type text, p_image_width integer,
  p_image_height integer, p_image_size_bytes integer, p_reply_to_message_id uuid default null
)
returns setof public.chat_messages
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid(); conversation public.chat_conversations;
  normalized text := coalesce(btrim(p_body), ''); recipient_id uuid; sender_name text;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if char_length(normalized) > 4000 or (normalized = '' and p_image_path is null) then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.chat_messages replied
    where replied.id = p_reply_to_message_id and replied.conversation_id = p_conversation_id
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
      and message.image_width is not distinct from p_image_width
      and message.image_height is not distinct from p_image_height
      and message.image_size_bytes is not distinct from p_image_size_bytes
      and message.reply_to_message_id is not distinct from p_reply_to_message_id) then
      raise exception 'chat_message_conflict' using errcode = 'PT409';
    end if;
    return query select * from public.chat_messages message where message.id = p_message_id;
    return;
  end if;
  insert into public.chat_messages (
    id, conversation_id, sender_id, body, image_path, image_mime_type, image_width,
    image_height, image_size_bytes, reply_to_message_id, created_at
  ) values (
    p_message_id, p_conversation_id, actor_id, normalized, p_image_path, p_image_mime_type,
    p_image_width, p_image_height, p_image_size_bytes, p_reply_to_message_id, now()
  );
  update public.chat_conversations set updated_at = now() where public.chat_conversations.id = p_conversation_id;
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
  return query select * from public.chat_messages message where message.id = p_message_id;
end;
$$;

create function public.edit_chat_message(p_conversation_id uuid, p_message_id uuid, p_body text)
returns setof public.chat_messages
language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); normalized text := btrim(p_body);
begin
  if normalized is null or char_length(normalized) not between 1 and 4000 then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  update public.chat_messages message set body = normalized,
    edited_at = case when message.body is distinct from normalized then now() else message.edited_at end
  from public.chat_conversations conversation
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.conversation_id = conversation.id and message.sender_id = actor_id
    and actor_id in (conversation.client_user_id, conversation.trainer_id) and message.deleted_at is null;
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  return query select * from public.chat_messages message where message.id = p_message_id;
end;
$$;

create function public.get_chat_unread_state(p_conversation_id uuid)
returns table(first_message_id uuid, first_created_at timestamptz, unread_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations; read_at timestamptz; read_id uuid;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  read_at := case when actor_id = conversation.client_user_id then conversation.client_last_read_at else conversation.trainer_last_read_at end;
  read_id := case when actor_id = conversation.client_user_id then conversation.client_last_read_message_id else conversation.trainer_last_read_message_id end;
  return query select boundary.id, boundary.created_at, count(*)
  from public.chat_messages message
  cross join lateral (select candidate.id, candidate.created_at from public.chat_messages candidate
    where candidate.conversation_id = p_conversation_id and candidate.sender_id <> actor_id
      and candidate.deleted_at is null and (candidate.created_at,candidate.id) > (coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'00000000-0000-0000-0000-000000000000'::uuid))
    order by candidate.created_at, candidate.id limit 1) boundary
  where message.conversation_id = p_conversation_id and message.sender_id <> actor_id
    and message.deleted_at is null and (message.created_at,message.id) > (coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'00000000-0000-0000-0000-000000000000'::uuid))
  group by boundary.id, boundary.created_at;
end;
$$;

create function public.mark_chat_read_v2(p_conversation_id uuid, p_through_message_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations; bounded public.chat_messages;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  select * into bounded from public.chat_messages message
    where message.id = p_through_message_id and message.conversation_id = p_conversation_id
      and message.sender_id <> actor_id and message.deleted_at is null;
  if not found then return; end if;
  update public.chat_conversations set
    client_last_read_at = case when actor_id = client_user_id and (bounded.created_at,bounded.id) > (coalesce(client_last_read_at,'-infinity'::timestamptz),coalesce(client_last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)) then bounded.created_at else client_last_read_at end,
    client_last_read_message_id = case when actor_id = client_user_id and (bounded.created_at,bounded.id) > (coalesce(client_last_read_at,'-infinity'::timestamptz),coalesce(client_last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)) then bounded.id else client_last_read_message_id end,
    trainer_last_read_at = case when actor_id = trainer_id and (bounded.created_at,bounded.id) > (coalesce(trainer_last_read_at,'-infinity'::timestamptz),coalesce(trainer_last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)) then bounded.created_at else trainer_last_read_at end,
    trainer_last_read_message_id = case when actor_id = trainer_id and (bounded.created_at,bounded.id) > (coalesce(trainer_last_read_at,'-infinity'::timestamptz),coalesce(trainer_last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)) then bounded.id else trainer_last_read_message_id end
  where id = p_conversation_id;
end;
$$;

create or replace function public.mark_chat_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations; bounded public.chat_messages;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id,item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode='PT403'; end if;
  select * into bounded from public.chat_messages message where message.conversation_id=p_conversation_id
    and message.sender_id<>actor_id and message.deleted_at is null order by message.created_at desc,message.id desc limit 1;
  if not found then return; end if;
  update public.chat_conversations set
    client_last_read_at=case when actor_id=client_user_id then bounded.created_at else client_last_read_at end,
    client_last_read_message_id=case when actor_id=client_user_id then bounded.id else client_last_read_message_id end,
    trainer_last_read_at=case when actor_id=trainer_id then bounded.created_at else trainer_last_read_at end,
    trainer_last_read_message_id=case when actor_id=trainer_id then bounded.id else trainer_last_read_message_id end
  where id=p_conversation_id;
end;
$$;

create function public.search_chat_messages(p_conversation_id uuid, p_query text, p_limit integer default 50)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer,
  edited_at timestamptz, reply_to_message_id uuid, reply_to_sender_id uuid, reply_to_body text,
  reply_to_has_image boolean, reply_to_deleted boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare normalized text := btrim(p_query);
begin
  if not exists (select 1 from public.chat_conversations conversation
    where conversation.id = p_conversation_id and auth.uid() in (conversation.client_user_id, conversation.trainer_id)) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if normalized is null or char_length(normalized) not between 2 and 100 then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.image_path, message.image_mime_type, message.image_width, message.image_height, message.image_size_bytes,
    message.edited_at, message.reply_to_message_id, replied.sender_id,
    case when replied.deleted_at is null then replied.body else null end,
    (replied.image_path is not null and replied.deleted_at is null), (replied.id is not null and replied.deleted_at is not null)
  from public.chat_messages message left join public.chat_messages replied on replied.id = message.reply_to_message_id
  where message.conversation_id = p_conversation_id and message.deleted_at is null
    and position(lower(normalized) in lower(message.body)) > 0
  order by message.created_at desc, message.id desc limit least(greatest(p_limit, 1), 50);
end;
$$;

create function public.get_chat_message_window(p_conversation_id uuid, p_message_id uuid, p_radius integer default 25)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  image_path text, image_mime_type text, image_width integer, image_height integer, image_size_bytes integer,
  edited_at timestamptz, reply_to_message_id uuid, reply_to_sender_id uuid, reply_to_body text,
  reply_to_has_image boolean, reply_to_deleted boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare target public.chat_messages;
begin
  if not exists (select 1 from public.chat_conversations conversation
    where conversation.id = p_conversation_id and auth.uid() in (conversation.client_user_id, conversation.trainer_id)) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  select * into target from public.chat_messages message
    where message.id = p_message_id and message.conversation_id = p_conversation_id and message.deleted_at is null;
  if not found then raise exception 'chat_message_invalid' using errcode = 'PT422'; end if;
  return query with selected as (
    (select message.* from public.chat_messages message where message.conversation_id = p_conversation_id
      and message.deleted_at is null and (message.created_at, message.id) <= (target.created_at, target.id)
      order by message.created_at desc, message.id desc limit least(greatest(p_radius, 1), 50))
    union
    (select message.* from public.chat_messages message where message.conversation_id = p_conversation_id
      and message.deleted_at is null and (message.created_at, message.id) > (target.created_at, target.id)
      order by message.created_at, message.id limit least(greatest(p_radius, 1), 50))
  )
  select selected.id, selected.conversation_id, selected.sender_id, selected.body, selected.created_at,
    selected.image_path, selected.image_mime_type, selected.image_width, selected.image_height, selected.image_size_bytes,
    selected.edited_at, selected.reply_to_message_id, replied.sender_id,
    case when replied.deleted_at is null then replied.body else null end,
    (replied.image_path is not null and replied.deleted_at is null), (replied.id is not null and replied.deleted_at is not null)
  from selected left join public.chat_messages replied on replied.id = selected.reply_to_message_id
  order by selected.created_at, selected.id;
end;
$$;

create or replace function public.list_chat_threads()
returns table (
  conversation_id uuid, client_id uuid, trainer_id uuid, partner_user_id uuid,
  partner_name text, active_connection boolean, last_message_body text,
  last_message_at timestamptz, last_message_sender_id uuid, unread_count bigint
)
language sql stable security definer set search_path = ''
as $$
  with actor as (select auth.uid() as id), available as (
    select conversation.client_id, conversation.trainer_id from public.chat_conversations conversation, actor
      where actor.id in (conversation.client_user_id, conversation.trainer_id)
    union
    select membership.client_id, membership.trainer_id from public.client_trainers membership
      join public.clients client on client.id = membership.client_id cross join actor
      where client.auth_user_id is not null and actor.id in (client.auth_user_id, membership.trainer_id)
    union
    select client.id, client.trainer_id from public.clients client cross join actor
      where client.auth_user_id is not null and client.trainer_id <> client.auth_user_id
        and actor.id in (client.auth_user_id, client.trainer_id)
  )
  select conversation.id, available.client_id, available.trainer_id,
    case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end,
    coalesce(nullif(btrim(coalesce(partner.first_name,'') || ' ' || coalesce(partner.last_name,'')),''),
      case when actor.id = client.auth_user_id then 'Тренер' else 'Спортсмен' end),
    (client.trainer_id = available.trainer_id and client.trainer_id <> client.auth_user_id)
      or exists (select 1 from public.client_trainers membership
        where membership.client_id = available.client_id and membership.trainer_id = available.trainer_id),
    coalesce(nullif(last_message.body,''),case when last_message.image_path is not null then 'Фото' end),
    last_message.created_at,last_message.sender_id,
    case when conversation.id is null then 0 else (select count(*) from public.chat_messages unread
      where unread.conversation_id = conversation.id and unread.sender_id <> actor.id and unread.deleted_at is null
        and (unread.created_at,unread.id) > (
          coalesce(case when actor.id = conversation.client_user_id then conversation.client_last_read_at else conversation.trainer_last_read_at end,'-infinity'::timestamptz),
          coalesce(case when actor.id = conversation.client_user_id then conversation.client_last_read_message_id else conversation.trainer_last_read_message_id end,'00000000-0000-0000-0000-000000000000'::uuid)
        )) end
  from available join public.clients client on client.id = available.client_id cross join actor
  left join public.chat_conversations conversation on conversation.client_id = available.client_id and conversation.trainer_id = available.trainer_id
  join public.profiles partner on partner.id = case when actor.id = client.auth_user_id then available.trainer_id else client.auth_user_id end
  left join lateral (select message.body,message.image_path,message.created_at,message.sender_id
    from public.chat_messages message where message.conversation_id = conversation.id and message.deleted_at is null
    order by message.created_at desc,message.id desc limit 1) last_message on true
  order by 8 desc nulls last,5;
$$;

revoke all on function public.list_chat_messages_v3(uuid,timestamptz,uuid,integer),
  public.send_chat_message_v3(uuid,uuid,text,text,text,integer,integer,integer,uuid),
  public.edit_chat_message(uuid,uuid,text), public.get_chat_unread_state(uuid),
  public.mark_chat_read_v2(uuid,uuid), public.search_chat_messages(uuid,text,integer),
  public.get_chat_message_window(uuid,uuid,integer) from public, anon;
grant execute on function public.list_chat_messages_v3(uuid,timestamptz,uuid,integer),
  public.send_chat_message_v3(uuid,uuid,text,text,text,integer,integer,integer,uuid),
  public.edit_chat_message(uuid,uuid,text), public.get_chat_unread_state(uuid),
  public.mark_chat_read_v2(uuid,uuid), public.search_chat_messages(uuid,text,integer),
  public.get_chat_message_window(uuid,uuid,integer) to authenticated;
