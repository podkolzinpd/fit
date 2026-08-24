-- Assistant conversations remain in the current production data authority
-- while application tenants are still served by Supabase. The Yandex Cloud
-- orchestrator writes assistant replies with its server-only service key;
-- browsers can create only their own user messages.
create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  constraint assistant_conversations_title_not_blank check (title is null or btrim(title) <> '')
);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  author text not null check (author in ('user', 'assistant')),
  content text not null check (btrim(content) <> ''),
  action jsonb,
  created_at timestamptz not null default now(),
  constraint assistant_messages_action_is_object check (action is null or jsonb_typeof(action) = 'object')
);

create index assistant_conversations_owner_created_idx
  on public.assistant_conversations (owner_id, created_at desc);
create index assistant_messages_conversation_created_idx
  on public.assistant_messages (conversation_id, created_at, id);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

revoke all on table public.assistant_conversations, public.assistant_messages from anon, authenticated;
grant select, insert on table public.assistant_conversations to authenticated;
grant select, insert on table public.assistant_messages to authenticated;

create policy "assistant_conversations_read_own" on public.assistant_conversations
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "assistant_conversations_insert_own" on public.assistant_conversations
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "assistant_messages_read_own" on public.assistant_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.assistant_conversations conversation
      where conversation.id = assistant_messages.conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

create policy "assistant_messages_insert_user_own" on public.assistant_messages
  for insert to authenticated
  with check (
    author = 'user'
    and action is null
    and exists (
      select 1
      from public.assistant_conversations conversation
      where conversation.id = assistant_messages.conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );
