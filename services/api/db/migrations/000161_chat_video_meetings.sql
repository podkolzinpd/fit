-- Up Migration

create table public.chat_meetings (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index chat_meetings_one_active on public.chat_meetings(conversation_id) where ended_at is null;
create table public.chat_meeting_sessions (
  id uuid primary key,
  meeting_id uuid not null references public.chat_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined boolean not null default false,
  expires_at timestamptz not null
);
create index chat_meeting_sessions_meeting on public.chat_meeting_sessions(meeting_id, expires_at);
create table public.chat_meeting_notices (
  meeting_id uuid not null references public.chat_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null unique references public.chat_messages(id) on delete cascade,
  primary key(meeting_id,user_id)
);
alter table public.chat_meetings enable row level security;
alter table public.chat_meeting_sessions enable row level security;
alter table public.chat_meeting_notices enable row level security;
create policy chat_meetings_read on public.chat_meetings for select to fit_api using (
  exists(select 1 from public.chat_conversations c where c.id=conversation_id and auth.uid() in(c.client_user_id,c.trainer_id))
);
create policy chat_meeting_sessions_read on public.chat_meeting_sessions for select to fit_api using (
  exists(select 1 from public.chat_meetings m where m.id=meeting_id)
);
create policy chat_meeting_notices_read on public.chat_meeting_notices for select to fit_api using (
  exists(select 1 from public.chat_meetings m where m.id=meeting_id)
);
revoke all on public.chat_meetings,public.chat_meeting_sessions,public.chat_meeting_notices from public;
grant select on public.chat_meetings,public.chat_meeting_sessions,public.chat_meeting_notices to fit_api;

create function public.chat_meeting_command(p_conversation uuid,p_action text,p_meeting uuid default null,p_session uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := auth.uid();
  conversation public.chat_conversations;
  meeting public.chat_meetings;
  active boolean;
  participant_count integer;
  notice_id uuid;
  notice_body text;
begin
  -- All lifecycle transitions for a conversation serialize on this root.
  select * into conversation from public.chat_conversations c where c.id=p_conversation
    and actor_id in(c.client_user_id,c.trainer_id) for update;
  if not found then raise exception 'chat_forbidden' using errcode='PT403'; end if;
  if p_action not in('read','prepare','joined','heartbeat','leave') then
    raise exception 'chat_message_invalid' using errcode='PT422';
  end if;
  active := conversation.client_blocked_at is null and conversation.trainer_blocked_at is null
    and public.is_active_client_trainer_connection(conversation.client_id,conversation.trainer_id);
  -- Revocation prevents new tokens and closes app presence on the next heartbeat.
  if not active and p_action not in('read','leave') then
    raise exception 'chat_forbidden' using errcode='PT403';
  end if;
  update public.chat_meetings m set ended_at=now() where m.conversation_id=p_conversation
    and m.ended_at is null and (not active or not exists(
      select 1 from public.chat_meeting_sessions s where s.meeting_id=m.id and s.expires_at>now()
    ));
  select * into meeting from public.chat_meetings m where m.conversation_id=p_conversation and m.ended_at is null;
  if p_action='prepare' then
    if p_session is null then raise exception 'chat_message_invalid' using errcode='PT422'; end if;
    if meeting.id is null then
      insert into public.chat_meetings(conversation_id) values(p_conversation) returning * into meeting;
    end if;
    -- A tab id cannot be reused to take another user's lease or another room.
    if exists(select 1 from public.chat_meeting_sessions s where s.id=p_session
      and (s.user_id<>actor_id or s.meeting_id<>meeting.id)) then
      raise exception 'chat_message_conflict' using errcode='PT409';
    end if;
    insert into public.chat_meeting_sessions(id,meeting_id,user_id,expires_at)
      values(p_session,meeting.id,actor_id,now()+interval '120 seconds')
      on conflict(id) do update set expires_at=now()+interval '120 seconds';
  elsif p_action in('joined','heartbeat','leave') then
    if meeting.id is null or meeting.id is distinct from p_meeting or not exists(
      select 1 from public.chat_meeting_sessions s where s.id=p_session and s.meeting_id=meeting.id
        and s.user_id=actor_id and s.expires_at>now()
    ) then
      if p_action='leave' then return jsonb_build_object('meeting',null,'available',active); end if;
      raise exception 'chat_message_conflict' using errcode='PT409';
    end if;
    if p_action='leave' then
      delete from public.chat_meeting_sessions where id=p_session and user_id=actor_id;
      if not exists(select 1 from public.chat_meeting_sessions s where s.meeting_id=meeting.id and s.expires_at>now()) then
        update public.chat_meetings set ended_at=now() where id=meeting.id;
        meeting.ended_at:=now();
      end if;
    else
      if p_action='heartbeat' and not exists(select 1 from public.chat_meeting_sessions s where s.id=p_session and s.joined) then
        raise exception 'chat_message_conflict' using errcode='PT409';
      end if;
      update public.chat_meeting_sessions set joined=true,expires_at=now()+interval '75 seconds'
        where id=p_session and user_id=actor_id;
      if p_action='joined' and not exists(select 1 from public.chat_meeting_notices n where n.meeting_id=meeting.id and n.user_id=actor_id) then
        notice_id:=gen_random_uuid();
        notice_body:=case when actor_id=conversation.trainer_id then 'Тренер' else 'Спортсмен' end || ' присоединился к видеовстрече';
        -- Reuse chat unread cursors, opt-out, multi-device push and dedupe.
        perform public.send_chat_message_v3(p_conversation,notice_id,notice_body,null,null,null,null,null,null);
        insert into public.chat_meeting_notices values(meeting.id,actor_id,notice_id);
      end if;
    end if;
  end if;
  select count(distinct s.user_id) into participant_count from public.chat_meeting_sessions s
    where s.meeting_id=meeting.id and s.joined and s.expires_at>now();
  return jsonb_build_object('available',active,'meeting',case when meeting.id is null or meeting.ended_at is not null then null
    else jsonb_build_object('id',meeting.id,'participantCount',participant_count) end);
end; $$;
revoke all on function public.chat_meeting_command(uuid,text,uuid,uuid) from public;
grant execute on function public.chat_meeting_command(uuid,text,uuid,uuid) to fit_api;

-- Down Migration

drop function public.chat_meeting_command(uuid,text,uuid,uuid);
drop table public.chat_meeting_notices,public.chat_meeting_sessions,public.chat_meetings;
