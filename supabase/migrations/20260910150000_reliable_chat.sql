create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  client_user_id uuid not null references public.profiles (id) on delete restrict,
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  client_last_read_at timestamptz,
  trainer_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, trainer_id)
);

create table public.chat_messages (
  id uuid primary key,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_valid check (
    body = btrim(body) and char_length(body) between 1 and 4000
  )
);

create index chat_conversations_client_user_idx on public.chat_conversations (client_user_id, updated_at desc);
create index chat_conversations_trainer_idx on public.chat_conversations (trainer_id, updated_at desc);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc, id desc);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_conversations_read_participants on public.chat_conversations
  for select to authenticated using (auth.uid() in (client_user_id, trainer_id));
create policy chat_messages_read_participants on public.chat_messages
  for select to authenticated using (exists (
    select 1 from public.chat_conversations conversation
    where conversation.id = chat_messages.conversation_id
      and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
  ));

revoke all on public.chat_conversations, public.chat_messages from anon, authenticated;
grant select on public.chat_conversations, public.chat_messages to authenticated;

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
    last_message.body, last_message.created_at, last_message.sender_id,
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
    select message.body, message.created_at, message.sender_id
    from public.chat_messages message where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc limit 1
  ) last_message on true
  order by 8 desc nulls last, 5;
$$;

create or replace function public.open_chat(p_client_id uuid, p_trainer_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); client_user uuid; result uuid;
begin
  select auth_user_id into client_user from public.clients where id = p_client_id;
  if actor_id is null or client_user is null or actor_id not in (client_user, p_trainer_id) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  select id into result from public.chat_conversations
    where client_id = p_client_id and trainer_id = p_trainer_id;
  if result is not null then return result; end if;
  if not exists (select 1 from public.clients client where client.id = p_client_id
    and client.auth_user_id is not null and client.trainer_id = p_trainer_id and client.trainer_id <> client.auth_user_id)
    and not exists (select 1 from public.client_trainers where client_id = p_client_id and trainer_id = p_trainer_id) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  insert into public.chat_conversations (client_id, client_user_id, trainer_id)
  values (p_client_id, client_user, p_trainer_id)
  on conflict (client_id, trainer_id) do update set updated_at = public.chat_conversations.updated_at
  returning id into result;
  return result;
end;
$$;

create or replace function public.list_chat_messages(
  p_conversation_id uuid, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.chat_conversations conversation
    where conversation.id = p_conversation_id and auth.uid() in (conversation.client_user_id, conversation.trainer_id)) then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at
    from public.chat_messages message
    where message.conversation_id = p_conversation_id
      and (p_before_created_at is null or (message.created_at, message.id) < (p_before_created_at, p_before_id))
    order by message.created_at desc, message.id desc limit least(greatest(p_limit, 1), 100);
end;
$$;

create or replace function public.send_chat_message(p_conversation_id uuid, p_message_id uuid, p_body text)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations; normalized text := btrim(p_body); recipient_id uuid; sender_name text;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  if normalized is null or char_length(normalized) not between 1 and 4000 then
    raise exception 'chat_message_invalid' using errcode = 'PT422';
  end if;
  if exists (select 1 from public.chat_messages message where message.id = p_message_id) then
    if not exists (select 1 from public.chat_messages message where message.id = p_message_id
      and message.conversation_id = p_conversation_id and message.sender_id = actor_id and message.body = normalized) then
      raise exception 'chat_message_conflict' using errcode = 'PT409';
    end if;
    return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at
      from public.chat_messages message where message.id = p_message_id;
    return;
  end if;
  insert into public.chat_messages values (p_message_id, p_conversation_id, actor_id, normalized, now());
  update public.chat_conversations set updated_at = now(),
    client_last_read_at = case when actor_id = client_user_id then now() else client_last_read_at end,
    trainer_last_read_at = case when actor_id = trainer_id then now() else trainer_last_read_at end
    where public.chat_conversations.id = p_conversation_id;
  recipient_id := case when actor_id = conversation.client_user_id then conversation.trainer_id else conversation.client_user_id end;
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Fit') into sender_name
    from public.profiles where public.profiles.id = actor_id;
  insert into private.push_notifications_outbox (kind, user_id, title, body, data, subscription_id)
  select 'chat_message', recipient_id, sender_name, left(normalized, 160),
    jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id, 'url', '/chat/' || p_conversation_id), subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = recipient_id and coalesce((select preference.enabled from public.notification_preferences preference
    where preference.user_id = recipient_id and preference.kind = 'chat_message'), true)
  on conflict (kind, user_id, data, subscription_id) do nothing;
  return query select message.id, message.conversation_id, message.sender_id, message.body, message.created_at
    from public.chat_messages message where message.id = p_message_id;
end;
$$;

create or replace function public.mark_chat_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid(); conversation public.chat_conversations;
begin
  select * into conversation from public.chat_conversations item
    where item.id = p_conversation_id and actor_id in (item.client_user_id, item.trainer_id);
  if not found then raise exception 'chat_forbidden' using errcode = 'PT403'; end if;
  update public.chat_conversations set
    client_last_read_at = case when actor_id = client_user_id then now() else client_last_read_at end,
    trainer_last_read_at = case when actor_id = trainer_id then now() else trainer_last_read_at end
  where id = p_conversation_id;
end;
$$;

revoke all on function public.list_chat_threads(), public.open_chat(uuid, uuid),
  public.list_chat_messages(uuid, timestamptz, uuid, integer), public.send_chat_message(uuid, uuid, text),
  public.mark_chat_read(uuid) from public, anon;
grant execute on function public.list_chat_threads(), public.open_chat(uuid, uuid),
  public.list_chat_messages(uuid, timestamptz, uuid, integer), public.send_chat_message(uuid, uuid, text),
  public.mark_chat_read(uuid) to authenticated;

alter publication supabase_realtime add table public.chat_messages;
