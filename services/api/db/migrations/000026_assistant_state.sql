-- Up Migration

-- Durable Assistant history is actor-owned. The runtime API reads rows through
-- RLS and performs every write through a narrow SECURITY DEFINER function, so
-- browsers never choose owner_id and retries remain idempotent.
create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.trainers (profile_id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  constraint assistant_conversations_title_not_blank
    check (title is null or char_length(btrim(title)) between 1 and 200)
);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.assistant_conversations (id) on delete cascade,
  turn_id uuid,
  author text not null check (author in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  action jsonb,
  created_at timestamptz not null default now(),
  constraint assistant_messages_action_is_object
    check (action is null or jsonb_typeof(action) = 'object')
);

create unique index assistant_messages_turn_author_unique
  on public.assistant_messages (conversation_id, turn_id, author)
  where turn_id is not null;
create index assistant_conversations_owner_created_idx
  on public.assistant_conversations (owner_id, created_at desc);
create index assistant_messages_conversation_created_idx
  on public.assistant_messages (conversation_id, created_at, id);

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.trainers (profile_id) on delete cascade,
  conversation_id uuid not null
    references public.assistant_conversations (id) on delete cascade,
  assistant_message_id uuid not null unique
    references public.assistant_messages (id) on delete cascade,
  tool text not null check (tool in (
    'record_workout', 'create_client_draft', 'create_program_draft',
    'schedule_program', 'summarize_progress'
  )),
  status text not null default 'proposed'
    check (status in ('proposed', 'applying', 'applied', 'failed', 'cancelled')),
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
  on public.assistant_actions (conversation_id, created_at);

create trigger set_updated_at before update on public.assistant_actions
  for each row execute function public.set_updated_at();

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_actions enable row level security;

create policy assistant_conversations_read_own on public.assistant_conversations
  for select to fit_api using (owner_id = (select auth.uid()));
create policy assistant_messages_read_own on public.assistant_messages
  for select to fit_api using (exists (
    select 1 from public.assistant_conversations conversation
    where conversation.id = assistant_messages.conversation_id
      and conversation.owner_id = (select auth.uid())
  ));
create policy assistant_actions_read_own on public.assistant_actions
  for select to fit_api using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.assistant_conversations conversation
      where conversation.id = assistant_actions.conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

revoke all on public.assistant_conversations,
  public.assistant_messages, public.assistant_actions from public, fit_api;
grant select on public.assistant_conversations,
  public.assistant_messages, public.assistant_actions to fit_api;

create or replace function app_private.require_assistant_trainer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1 from public.trainers trainer where trainer.profile_id = actor_id
  ) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;
  return actor_id;
end;
$$;

revoke all on function app_private.require_assistant_trainer() from public, fit_api;

create or replace function public.create_assistant_conversation(p_title text default null)
returns table (conversation_id uuid, title text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app_private.require_assistant_trainer();
  normalized_title text := nullif(btrim(p_title), '');
begin
  if p_title is not null and (
    normalized_title is null or char_length(normalized_title) > 200
  ) then
    raise exception 'assistant_conversation_invalid' using errcode = 'PT422';
  end if;
  return query
  insert into public.assistant_conversations (owner_id, title)
  values (actor_id, normalized_title)
  returning id, public.assistant_conversations.title,
    public.assistant_conversations.created_at;
end;
$$;

create or replace function public.append_assistant_user_message(
  p_conversation_id uuid,
  p_turn_id uuid,
  p_content text
)
returns table (message_id uuid, created_at timestamptz, deduplicated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app_private.require_assistant_trainer();
  normalized_content text := btrim(p_content);
  stored public.assistant_messages;
begin
  if p_turn_id is null or normalized_content is null
    or char_length(normalized_content) not between 1 and 10000
  then
    raise exception 'assistant_message_invalid' using errcode = 'PT422';
  end if;
  if not exists (
    select 1 from public.assistant_conversations conversation
    where conversation.id = p_conversation_id and conversation.owner_id = actor_id
  ) then
    raise exception 'assistant_conversation_not_found' using errcode = 'PT404';
  end if;

  insert into public.assistant_messages (
    conversation_id, turn_id, author, content
  ) values (
    p_conversation_id, p_turn_id, 'user', normalized_content
  )
  on conflict (conversation_id, turn_id, author)
    where turn_id is not null do nothing
  returning * into stored;

  if stored.id is null then
    select message.* into stored from public.assistant_messages message
    where message.conversation_id = p_conversation_id
      and message.turn_id = p_turn_id and message.author = 'user';
    if stored.content <> normalized_content then
      raise exception 'assistant_turn_reused' using errcode = 'PT409';
    end if;
    return query select stored.id, stored.created_at, true;
    return;
  end if;
  return query select stored.id, stored.created_at, false;
end;
$$;

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
  actor_id uuid := app_private.require_assistant_trainer();
  message_id uuid;
  action_id uuid;
  existing_action public.assistant_actions;
  existing_message public.assistant_messages;
begin
  if not exists (
    select 1 from public.assistant_conversations conversation
    where conversation.id = p_conversation_id and conversation.owner_id = actor_id
  ) then
    raise exception 'assistant_conversation_not_found' using errcode = 'PT404';
  end if;
  if p_turn_id is null or nullif(btrim(p_content), '') is null
    or char_length(btrim(p_content)) > 10000
  then
    raise exception 'assistant_response_invalid' using errcode = 'PT422';
  end if;
  if p_action is not null and jsonb_typeof(p_action) <> 'object' then
    raise exception 'assistant_response_action_invalid' using errcode = 'PT422';
  end if;
  if p_action is not null and p_action->>'id' is not null then
    if p_action->>'status' <> 'proposed'
      or (p_action->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_action->>'tool' not in (
        'record_workout', 'create_client_draft', 'create_program_draft',
        'schedule_program', 'summarize_progress'
      )
      or nullif(btrim(p_action->>'title'), '') is null
      or nullif(btrim(p_action->>'description'), '') is null
      or jsonb_typeof(p_action->'payload') <> 'object'
    then
      raise exception 'assistant_response_action_invalid' using errcode = 'PT422';
    end if;
  end if;

  insert into public.assistant_messages (
    conversation_id, turn_id, author, content, action
  ) values (
    p_conversation_id, p_turn_id, 'assistant', btrim(p_content), p_action
  )
  on conflict (conversation_id, turn_id, author)
    where turn_id is not null do nothing
  returning id into message_id;

  if message_id is null then
    select * into existing_message from public.assistant_messages
    where conversation_id = p_conversation_id
      and turn_id = p_turn_id and author = 'assistant';
    return jsonb_build_object(
      'messageId', existing_message.id,
      'deduplicated', true,
      'content', existing_message.content,
      'action', existing_message.action
    );
  end if;

  if p_action is not null and p_action->>'id' is not null then
    action_id := (p_action->>'id')::uuid;
    insert into public.assistant_actions (
      id, owner_id, conversation_id, assistant_message_id, tool, payload
    ) values (
      action_id, actor_id, p_conversation_id, message_id,
      p_action->>'tool', p_action->'payload'
    ) on conflict (id) do nothing;
    select * into existing_action from public.assistant_actions where id = action_id;
    if not found
      or existing_action.assistant_message_id <> message_id
      or existing_action.owner_id <> actor_id
      or existing_action.tool <> p_action->>'tool'
      or existing_action.payload <> p_action->'payload'
    then
      raise exception 'assistant_action_id_collision' using errcode = 'PT409';
    end if;
  end if;
  return jsonb_build_object('messageId', message_id, 'deduplicated', false);
end;
$$;

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
  actor_id uuid := app_private.require_assistant_trainer();
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
begin
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'))
      || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed')
    or action_row.version <> p_expected_version
  then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  update public.assistant_actions set status = 'applying', error_code = null
  where id = action_row.id;

  begin
    if action_row.tool = 'record_workout' then
      workout_item := p_input->'workout';
      if jsonb_typeof(workout_item) <> 'object'
        or jsonb_typeof(workout_item->'exercises') <> 'array'
        or jsonb_array_length(workout_item->'exercises') < 1
        or nullif(workout_item->>'requestId', '') is null
        or (workout_item->>'clientId')::uuid
          <> (action_row.payload->>'clientId')::uuid
      then
        raise exception 'assistant_workout_invalid' using errcode = 'PT422';
      end if;
      select saved.workout_id into workout_id
      from public.save_completed_workout(workout_item, null) saved;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutId', workout_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutId', workout_id,
        'version', action_row.version + 1
      );
    elsif action_row.tool in ('create_program_draft', 'schedule_program') then
      if jsonb_typeof(p_input->'workouts') <> 'array'
        or jsonb_array_length(p_input->'workouts') not between 1 and 4
      then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;
      for workout_item in select value from jsonb_array_elements(p_input->'workouts')
      loop
        if jsonb_typeof(workout_item) <> 'object'
          or jsonb_typeof(workout_item->'exercises') <> 'array'
          or jsonb_array_length(workout_item->'exercises') < 1
          or nullif(workout_item->>'requestId', '') is null
          or (workout_item->>'clientId')::uuid
            <> (action_row.payload->>'clientId')::uuid
        then
          raise exception 'assistant_program_invalid' using errcode = 'PT422';
        end if;
        select saved.workout_id into workout_id
        from public.save_planned_workout(workout_item, null) saved;
        workout_ids := workout_ids || jsonb_build_array(workout_id);
      end loop;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'workoutIds', workout_ids),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'workoutIds', workout_ids,
        'version', action_row.version + 1
      );
    elsif action_row.tool = 'create_client_draft' then
      if jsonb_typeof(p_input) <> 'object'
        or nullif(btrim(p_input->>'fullName'), '') is null
      then
        raise exception 'assistant_client_invalid' using errcode = 'PT422';
      end if;
      select created.client_id into created_id
      from public.create_client_card(p_input) created;
      update public.assistant_actions set
        status = 'applied',
        result = jsonb_build_object('status', 'applied', 'clientId', created_id),
        version = version + 1,
        applied_at = now()
      where id = action_row.id;
      return jsonb_build_object(
        'status', 'applied', 'clientId', created_id,
        'version', action_row.version + 1
      );
    else
      raise exception 'assistant_action_external_only' using errcode = 'PT422';
    end if;
  exception when others then
    update public.assistant_actions set
      status = 'failed', error_code = 'assistant_action_failed'
    where id = action_row.id;
    return jsonb_build_object(
      'status', 'failed', 'errorCode', 'assistant_action_failed',
      'version', action_row.version
    );
  end;
end;
$$;

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
  actor_id uuid := app_private.require_assistant_trainer();
  action_row public.assistant_actions;
  summary_row public.client_training_summaries;
  summary_result jsonb;
begin
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if action_row.tool <> 'summarize_progress' then
    raise exception 'assistant_action_tool_mismatch' using errcode = 'PT422';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'))
      || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed')
    or action_row.version <> p_expected_version
  then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  select * into summary_row from public.client_training_summaries
  where trainer_id = actor_id
    and client_id = nullif(action_row.payload->>'clientId', '')::uuid
    and period_start = nullif(action_row.payload->>'periodStart', '')::date
    and period_end = nullif(action_row.payload->>'periodEnd', '')::date
  order by generated_at desc limit 1;
  if not found then
    raise exception 'assistant_summary_not_found' using errcode = 'PT404';
  end if;

  summary_result := jsonb_build_object(
    'status', 'applied',
    'summaryId', summary_row.id,
    'clientId', summary_row.client_id,
    'clientName', nullif(btrim(action_row.payload->>'clientName'), ''),
    'periodStart', summary_row.period_start,
    'periodEnd', summary_row.period_end,
    'periodLabel', nullif(btrim(action_row.payload->>'periodLabel'), ''),
    'trainer', jsonb_build_object(
      'headline', summary_row.trainer_summary->>'headline',
      'progress', summary_row.trainer_summary->'progress',
      'consistency', summary_row.trainer_summary->>'consistency',
      'attention', summary_row.trainer_summary->'attention'
    ),
    'metrics', jsonb_build_object(
      'completedWorkouts', coalesce(
        summary_row.display_metrics->'completed_workouts', '0'::jsonb
      ),
      'workoutsPerWeek', coalesce(
        summary_row.display_metrics->'workouts_per_week', '0'::jsonb
      ),
      'activeWeeks', coalesce(
        summary_row.display_metrics->'active_weeks', '0'::jsonb
      )
    )
  );
  update public.assistant_actions set
    status = 'applied', result = summary_result,
    version = version + 1, applied_at = now()
  where id = action_row.id;
  return summary_result || jsonb_build_object('version', action_row.version + 1);
end;
$$;

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
  actor_id uuid := app_private.require_assistant_trainer();
  action_row public.assistant_actions;
begin
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if action_row.status = 'cancelled' then
    return jsonb_build_object(
      'status', 'cancelled', 'version', action_row.version
    );
  end if;
  if action_row.status not in ('proposed', 'failed')
    or action_row.version <> p_expected_version
  then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;
  update public.assistant_actions set
    status = 'cancelled', version = version + 1
  where id = action_row.id;
  return jsonb_build_object(
    'status', 'cancelled', 'version', action_row.version + 1
  );
end;
$$;

revoke all on function public.create_assistant_conversation(text) from public;
revoke all on function public.append_assistant_user_message(uuid, uuid, text) from public;
revoke all on function public.persist_assistant_response(uuid, uuid, text, jsonb) from public;
revoke all on function public.apply_assistant_action(uuid, jsonb, bigint) from public;
revoke all on function public.complete_assistant_summary(uuid, bigint) from public;
revoke all on function public.cancel_assistant_action(uuid, bigint) from public;

grant execute on function public.create_assistant_conversation(text) to fit_api;
grant execute on function public.append_assistant_user_message(uuid, uuid, text) to fit_api;
grant execute on function public.persist_assistant_response(uuid, uuid, text, jsonb) to fit_api;
grant execute on function public.apply_assistant_action(uuid, jsonb, bigint) to fit_api;
grant execute on function public.complete_assistant_summary(uuid, bigint) to fit_api;
grant execute on function public.cancel_assistant_action(uuid, bigint) to fit_api;

-- Down Migration

revoke execute on function public.cancel_assistant_action(uuid, bigint) from fit_api;
revoke execute on function public.complete_assistant_summary(uuid, bigint) from fit_api;
revoke execute on function public.apply_assistant_action(uuid, jsonb, bigint) from fit_api;
revoke execute on function public.persist_assistant_response(uuid, uuid, text, jsonb) from fit_api;
revoke execute on function public.append_assistant_user_message(uuid, uuid, text) from fit_api;
revoke execute on function public.create_assistant_conversation(text) from fit_api;

drop function public.cancel_assistant_action(uuid, bigint);
drop function public.complete_assistant_summary(uuid, bigint);
drop function public.apply_assistant_action(uuid, jsonb, bigint);
drop function public.persist_assistant_response(uuid, uuid, text, jsonb);
drop function public.append_assistant_user_message(uuid, uuid, text);
drop function public.create_assistant_conversation(text);
drop function app_private.require_assistant_trainer();

drop table public.assistant_actions;
drop table public.assistant_messages;
drop table public.assistant_conversations;
