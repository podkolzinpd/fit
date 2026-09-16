-- A service-only lease/cache prevents different chat turns from paying twice.
create table private.assistant_program_generations (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  lease_id uuid not null,
  lease_until timestamptz not null,
  result jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.assistant_program_generations from public, anon, authenticated;

create or replace function public.assistant_program_generation_job(
  p_id uuid, p_owner_id uuid, p_client_id uuid, p_lease_id uuid,
  p_result jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare job private.assistant_program_generations;
begin
  if p_id is null or p_owner_id is null or p_client_id is null or p_lease_id is null then
    raise exception 'invalid_program_job' using errcode = 'PT422';
  end if;
  if not exists(select 1 from public.trainers where profile_id = p_owner_id) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;
  insert into private.assistant_program_generations(id, owner_id, client_id, lease_id, lease_until)
    values(p_id, p_owner_id, p_client_id, p_lease_id, now() + interval '3 minutes')
    on conflict(id) do nothing;
  select * into job from private.assistant_program_generations where id = p_id for update;
  if job.owner_id <> p_owner_id or job.client_id <> p_client_id then
    raise exception 'program_job_owner_mismatch' using errcode = 'PT403';
  end if;
  if job.result is not null then return jsonb_build_object('status','complete','result',job.result); end if;
  if p_result is not null then
    if job.lease_id <> p_lease_id or job.lease_until <= now() or jsonb_typeof(p_result) <> 'object' then
      raise exception 'program_job_conflict' using errcode = 'PT409';
    end if;
    update private.assistant_program_generations set result = p_result where id = p_id;
    return jsonb_build_object('status','complete','result',p_result);
  end if;
  if job.lease_id = p_lease_id or job.lease_until <= now() then
    update private.assistant_program_generations set lease_id = p_lease_id, lease_until = now() + interval '3 minutes' where id = p_id;
    return jsonb_build_object('status','claimed');
  end if;
  return jsonb_build_object('status','busy');
end;
$$;
revoke all on function public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Include edits/deletions of every profile source in the existing client guard.
create or replace function private.touch_program_client_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_id uuid := coalesce(new.client_id, old.client_id);
begin
  update public.clients set updated_at = clock_timestamp() where id = target_id;
  return coalesce(new, old);
end;
$$;
revoke all on function private.touch_program_client_source() from public, anon, authenticated;
create trigger program_source_goal_changed after insert or update or delete on public.client_goals for each row execute function private.touch_program_client_source();
create trigger program_source_stage_changed after insert or update or delete on public.goal_stages for each row execute function private.touch_program_client_source();
create trigger program_source_criteria_changed after insert or update or delete on public.goal_criteria for each row execute function private.touch_program_client_source();
create trigger program_source_progress_changed after insert or update or delete on public.client_progress for each row execute function private.touch_program_client_source();

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
    if p_action->'payload'->>'programId' is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action->'payload'->>'programId', 0));
      update public.assistant_actions set status = 'cancelled', version = version + 1, updated_at = now()
        where owner_id = conversation_owner and id <> action_id and status in ('proposed','failed')
          and payload->>'programId' = p_action->'payload'->>'programId';
    end if;
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

