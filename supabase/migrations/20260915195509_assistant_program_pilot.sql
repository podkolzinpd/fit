-- Four-week program pilot. Existing actions retain their original four-workout limit.
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
      if jsonb_typeof(p_input->'workouts') is distinct from 'array'
        or jsonb_array_length(p_input->'workouts') < 1
        or jsonb_array_length(p_input->'workouts') > 12 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      if action_row.payload->>'schemaVersion' = 'program-v1' then
        -- Serialize program saves per client before rechecking all source changes.
        perform 1 from public.clients where id = (action_row.payload->>'clientId')::uuid for update;
        if jsonb_array_length(p_input->'workouts') not in (4, 8, 12)
          or p_input->'workouts' is distinct from action_row.payload->'canonicalWorkouts'
          or nullif(action_row.payload->>'sourceCapturedAt', '') is null
          or (action_row.payload->>'sourceCapturedAt')::timestamptz < now() - interval '24 hours'
        then
          raise exception 'assistant_program_requires_validation' using errcode = 'PT422';
        end if;
        if exists (select 1 from public.workouts w
          where w.client_id = (action_row.payload->>'clientId')::uuid
            and w.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
          or exists (select 1 from public.clients c
            where c.id = (action_row.payload->>'clientId')::uuid
              and c.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
        then
          raise exception 'assistant_program_source_changed' using errcode = 'PT409';
        end if;
      elsif jsonb_array_length(p_input->'workouts') > 4 then
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
