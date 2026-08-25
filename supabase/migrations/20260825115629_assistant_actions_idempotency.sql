-- Durable assistant turn/action state. The browser can read its own history and
-- action state, but all assistant writes and confirmations go through the
-- orchestrator or narrow, ownership-checked RPCs.
alter table public.assistant_messages
  add column turn_id uuid;

create unique index assistant_messages_turn_author_unique
  on public.assistant_messages (conversation_id, turn_id, author)
  where turn_id is not null;

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  assistant_message_id uuid not null unique references public.assistant_messages (id) on delete cascade,
  tool text not null check (tool in ('record_workout', 'create_client_draft', 'create_program_draft', 'schedule_program', 'summarize_progress')),
  status text not null default 'proposed' check (status in ('proposed', 'applying', 'applied', 'failed', 'cancelled')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result jsonb,
  error_code text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz
);

create index assistant_actions_owner_created_idx
  on public.assistant_actions (owner_id, created_at desc);
create index assistant_actions_conversation_created_idx
  on public.assistant_actions (conversation_id, created_at desc);

create or replace function private.validate_assistant_action_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_owner uuid;
  message_conversation uuid;
begin
  select owner_id into conversation_owner
  from public.assistant_conversations where id = new.conversation_id;
  select conversation_id into message_conversation
  from public.assistant_messages where id = new.assistant_message_id;
  if conversation_owner is null
    or conversation_owner <> new.owner_id
    or message_conversation is distinct from new.conversation_id then
    raise exception 'assistant_action_tenant_mismatch' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger assistant_actions_tenant_guard
  before insert or update on public.assistant_actions
  for each row execute function private.validate_assistant_action_tenant();

revoke all on function private.validate_assistant_action_tenant() from public, anon, authenticated;

alter table public.assistant_actions enable row level security;
revoke all on table public.assistant_actions from anon, authenticated;
grant select on table public.assistant_actions to authenticated;

-- The orchestrator authenticates the caller first, then uses its backend role
-- to read the owned conversation/history and append the user turn. Keep these
-- grants narrower than generic table ownership; action writes stay behind the
-- dedicated SECURITY DEFINER persistence RPC below.
grant select on table public.assistant_conversations to service_role;
grant select, insert on table public.assistant_messages to service_role;

create policy "assistant_actions_read_own" on public.assistant_actions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.assistant_conversations conversation
      where conversation.id = assistant_actions.conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

create or replace function public.persist_assistant_response(
  p_conversation_id uuid,
  p_turn_id uuid,
  p_content text,
  p_action jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_owner uuid;
  message_id uuid;
  action_id uuid;
  existing_action public.assistant_actions;
  existing_message public.assistant_messages;
begin
  select owner_id into conversation_owner
  from public.assistant_conversations
  where id = p_conversation_id;
  if conversation_owner is null then
    raise exception 'conversation_not_found' using errcode = 'PT404';
  end if;
  if p_turn_id is null or nullif(btrim(p_content), '') is null then
    raise exception 'assistant_response_invalid' using errcode = 'PT422';
  end if;
  if p_action is not null and p_action->>'id' is not null then
    if p_action->>'status' <> 'proposed'
      or (p_action->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_action->>'tool' not in ('record_workout', 'create_client_draft', 'create_program_draft', 'schedule_program', 'summarize_progress')
      or nullif(btrim(p_action->>'title'), '') is null
      or nullif(btrim(p_action->>'description'), '') is null
      or jsonb_typeof(p_action->'payload') <> 'object' then
      raise exception 'assistant_response_action_invalid' using errcode = 'PT422';
    end if;
  end if;

  insert into public.assistant_messages (conversation_id, turn_id, author, content, action)
  values (p_conversation_id, p_turn_id, 'assistant', p_content, p_action)
  on conflict (conversation_id, turn_id, author) where turn_id is not null do nothing
  returning id into message_id;

  if message_id is null then
    select * into existing_message
    from public.assistant_messages
    where conversation_id = p_conversation_id and turn_id = p_turn_id and author = 'assistant';
    return jsonb_build_object(
      'messageId', existing_message.id,
      'deduplicated', true,
      'content', existing_message.content,
      'action', existing_message.action
    );
  end if;

  if p_action is not null and p_action->>'id' is not null then
    action_id := (p_action->>'id')::uuid;
    insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, status, payload)
    values (action_id, conversation_owner, p_conversation_id, message_id, p_action->>'tool', 'proposed', p_action->'payload')
    on conflict (id) do nothing;
    select * into existing_action from public.assistant_actions where id = action_id;
    if not found
      or existing_action.assistant_message_id <> message_id
      or existing_action.conversation_id <> p_conversation_id
      or existing_action.owner_id <> conversation_owner
      or existing_action.tool <> p_action->>'tool'
      or existing_action.payload <> p_action->'payload' then
      raise exception 'assistant_action_id_collision' using errcode = 'PT409';
    end if;
  end if;
  return jsonb_build_object('messageId', message_id);
end;
$$;

revoke all on function public.persist_assistant_response(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_assistant_response(uuid, uuid, text, jsonb) to service_role;

create or replace function public.apply_assistant_action(
  p_action_id uuid,
  p_input jsonb default '{}'::jsonb,
  p_expected_version bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
  error_text text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;

  select * into action_row
  from public.assistant_actions
  where id = p_action_id and owner_id = actor_id
  for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'));
  end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  update public.assistant_actions
  set status = 'applying', updated_at = now(), error_code = null
  where id = action_row.id;

  begin
    if action_row.tool = 'record_workout' then
      workout_item := p_input->'workout';
      if jsonb_typeof(workout_item) <> 'object'
        or nullif(workout_item->>'clientId', '') is null
        or nullif(workout_item->>'requestId', '') is null
        or jsonb_typeof(workout_item->'exercises') <> 'array'
        or jsonb_array_length(workout_item->'exercises') < 1
        or (workout_item->>'clientId')::uuid <> (action_row.payload->>'clientId')::uuid then
        raise exception 'assistant_workout_invalid' using errcode = 'PT422';
      end if;
      workout_id := public.save_completed_workout(workout_item, null);
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'workoutId', workout_id),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'workoutId', workout_id, 'version', action_row.version + 1);
    elsif action_row.tool = 'create_program_draft' or action_row.tool = 'schedule_program' then
      if jsonb_typeof(p_input->'workouts') <> 'array'
        or jsonb_array_length(p_input->'workouts') < 1
        or jsonb_array_length(p_input->'workouts') > 4 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      -- Every call is part of this function transaction. If any child fails,
      -- the nested block rolls back all previously inserted workouts.
      for workout_item in select value from jsonb_array_elements(p_input->'workouts')
      loop
        if jsonb_typeof(workout_item) <> 'object'
          or nullif(workout_item->>'clientId', '') is null
          or nullif(workout_item->>'requestId', '') is null
          or jsonb_typeof(workout_item->'exercises') <> 'array'
          or jsonb_array_length(workout_item->'exercises') < 1 then
          raise exception 'assistant_program_invalid' using errcode = 'PT422';
        end if;
        if (workout_item->>'clientId')::uuid <> (action_row.payload->>'clientId')::uuid then
          raise exception 'assistant_action_client_mismatch' using errcode = 'PT403';
        end if;
        workout_id := public.save_workout(workout_item, null);
        workout_ids := workout_ids || jsonb_build_array(workout_id);
      end loop;
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'workoutIds', workout_ids),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'workoutIds', workout_ids, 'version', action_row.version + 1);
    elsif action_row.tool = 'create_client_draft' then
      if jsonb_typeof(p_input) <> 'object' or nullif(btrim(p_input->>'fullName'), '') is null then
        raise exception 'assistant_client_invalid' using errcode = 'PT422';
      end if;
      created_id := public.create_client(p_input);
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'clientId', created_id),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'clientId', created_id, 'version', action_row.version + 1);
    else
      raise exception 'assistant_action_external_only' using errcode = 'PT422';
    end if;
  exception when others then
    get stacked diagnostics error_text = message_text;
    update public.assistant_actions
    set status = 'failed', error_code = 'assistant_action_failed', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object('status', 'failed', 'errorCode', 'assistant_action_failed', 'version', action_row.version);
  end;
end;
$$;

revoke all on function public.apply_assistant_action(uuid, jsonb, bigint) from public, anon;
grant execute on function public.apply_assistant_action(uuid, jsonb, bigint) to authenticated;

create or replace function public.complete_assistant_summary(
  p_action_id uuid,
  p_expected_version bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  action_row public.assistant_actions;
  summary_id uuid;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then raise exception 'assistant_trainer_required' using errcode = 'PT403'; end if;
  select * into action_row from public.assistant_actions where id = p_action_id and owner_id = actor_id for update;
  if not found then raise exception 'assistant_action_not_found' using errcode = 'PT404'; end if;
  if action_row.tool <> 'summarize_progress' then raise exception 'assistant_action_tool_mismatch' using errcode = 'PT422'; end if;
  if action_row.status = 'applied' then return coalesce(action_row.result, jsonb_build_object('status', 'applied')); end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;
  select id into summary_id
  from public.client_training_summaries
  where trainer_id = actor_id
    and client_id = nullif(action_row.payload->>'clientId', '')::uuid
    and period_start = nullif(action_row.payload->>'periodStart', '')::date
    and period_end = nullif(action_row.payload->>'periodEnd', '')::date
  order by generated_at desc limit 1;
  if summary_id is null then raise exception 'assistant_summary_not_found' using errcode = 'PT404'; end if;
  update public.assistant_actions
  set status = 'applied', result = jsonb_build_object('status', 'applied', 'summaryId', summary_id),
      version = version + 1, updated_at = now(), applied_at = now()
  where id = action_row.id;
  return jsonb_build_object('status', 'applied', 'summaryId', summary_id, 'version', action_row.version + 1);
end;
$$;

revoke all on function public.complete_assistant_summary(uuid, bigint) from public, anon;
grant execute on function public.complete_assistant_summary(uuid, bigint) to authenticated;

create or replace function public.cancel_assistant_action(
  p_action_id uuid,
  p_expected_version bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_row public.assistant_actions;
begin
  if not exists (select 1 from public.trainers where profile_id = auth.uid()) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = auth.uid() for update;
  if not found then raise exception 'assistant_action_not_found' using errcode = 'PT404'; end if;
  if action_row.status = 'cancelled' then return jsonb_build_object('status', 'cancelled', 'version', action_row.version); end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;
  update public.assistant_actions
  set status = 'cancelled', updated_at = now(), version = version + 1
  where id = action_row.id;
  return jsonb_build_object('status', 'cancelled', 'version', action_row.version + 1);
end;
$$;

revoke all on function public.cancel_assistant_action(uuid, bigint) from public, anon;
grant execute on function public.cancel_assistant_action(uuid, bigint) to authenticated;
