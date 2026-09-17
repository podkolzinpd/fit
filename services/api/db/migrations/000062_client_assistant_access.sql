-- Up Migration

alter table public.assistant_actions
  drop constraint assistant_actions_owner_id_fkey,
  add constraint assistant_actions_owner_id_fkey
    foreign key (owner_id) references public.profiles (id) on delete cascade;

alter table public.assistant_conversations
  drop constraint assistant_conversations_owner_id_fkey,
  add constraint assistant_conversations_owner_id_fkey
    foreign key (owner_id) references public.profiles (id) on delete cascade;

-- The historical function name remains stable for existing callers. It now
-- accepts both product roles; action functions below keep trainer-only tools
-- unavailable to client actors.
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
    select 1
    from public.profiles profile
    where profile.id = actor_id
      and (
        profile.account_role = 'client'
        or (
          profile.account_role = 'trainer'
          and exists (
            select 1 from public.trainers trainer
            where trainer.profile_id = actor_id
          )
        )
      )
  ) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;
  return actor_id;
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
  actor_role text;
  actor_client_id uuid;
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
begin
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'client' then
    select id into actor_client_id
    from public.clients
    where auth_user_id = actor_id and archived_at is null
    limit 1;
    if actor_client_id is null then
      raise exception 'assistant_client_card_required' using errcode = 'PT403';
    end if;
  end if;

  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if actor_role = 'client' and (
    action_row.tool <> 'record_workout'
    or nullif(action_row.payload->>'clientId', '')::uuid <> actor_client_id
  ) then
    raise exception 'assistant_action_forbidden' using errcode = 'PT403';
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
      if jsonb_typeof(p_input->'workouts') is distinct from 'array'
        or jsonb_array_length(p_input->'workouts') not between 1 and 12
      then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;
      if action_row.payload->>'schemaVersion' = 'program-v1' then
        perform 1 from public.clients where id = (action_row.payload->>'clientId')::uuid for update;
        if jsonb_array_length(p_input->'workouts') not in (4, 8, 12)
          or p_input->'workouts' is distinct from action_row.payload->'canonicalWorkouts'
          or nullif(action_row.payload->>'sourceCapturedAt', '') is null
          or (action_row.payload->>'sourceCapturedAt')::timestamptz < now() - interval '24 hours'
        then
          raise exception 'assistant_program_requires_validation' using errcode = 'PT422';
        end if;
        if exists (select 1 from public.workouts workout
          where workout.client_id = (action_row.payload->>'clientId')::uuid
            and workout.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
          or exists (select 1 from public.clients client
            where client.id = (action_row.payload->>'clientId')::uuid
              and client.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz)
        then
          raise exception 'assistant_program_source_changed' using errcode = 'PT409';
        end if;
      elsif jsonb_array_length(p_input->'workouts') > 4 then
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
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then raise exception 'assistant_action_not_found' using errcode = 'PT404'; end if;
  if action_row.tool <> 'summarize_progress' then raise exception 'assistant_action_tool_mismatch' using errcode = 'PT422'; end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'))
      || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;
  select * into summary_row from public.client_training_summaries
  where trainer_id = actor_id
    and client_id = nullif(action_row.payload->>'clientId', '')::uuid
    and period_start = nullif(action_row.payload->>'periodStart', '')::date
    and period_end = nullif(action_row.payload->>'periodEnd', '')::date
  order by generated_at desc limit 1;
  if not found then raise exception 'assistant_summary_not_found' using errcode = 'PT404'; end if;

  summary_result := jsonb_build_object(
    'status', 'applied', 'summaryId', summary_row.id,
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
      'completedWorkouts', coalesce(summary_row.display_metrics->'completed_workouts', '0'::jsonb),
      'workoutsPerWeek', coalesce(summary_row.display_metrics->'workouts_per_week', '0'::jsonb),
      'activeWeeks', coalesce(summary_row.display_metrics->'active_weeks', '0'::jsonb)
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
  actor_role text;
  actor_client_id uuid;
  action_row public.assistant_actions;
begin
  select account_role into actor_role from public.profiles where id = actor_id;
  select * into action_row from public.assistant_actions
  where id = p_action_id and owner_id = actor_id for update;
  if not found then raise exception 'assistant_action_not_found' using errcode = 'PT404'; end if;
  if actor_role = 'client' then
    select id into actor_client_id from public.clients
    where auth_user_id = actor_id and archived_at is null limit 1;
    if actor_client_id is null
      or action_row.tool <> 'record_workout'
      or nullif(action_row.payload->>'clientId', '')::uuid <> actor_client_id then
      raise exception 'assistant_action_forbidden' using errcode = 'PT403';
    end if;
  end if;
  if action_row.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;
  update public.assistant_actions set status = 'cancelled', version = version + 1
  where id = action_row.id;
  return jsonb_build_object('status', 'cancelled', 'version', action_row.version + 1);
end;
$$;

revoke all on function app_private.require_assistant_trainer() from public, fit_api;
revoke all on function public.apply_assistant_action(uuid, jsonb, bigint) from public;
revoke all on function public.complete_assistant_summary(uuid, bigint) from public;
revoke all on function public.cancel_assistant_action(uuid, bigint) from public;
grant execute on function public.apply_assistant_action(uuid, jsonb, bigint) to fit_api;
grant execute on function public.complete_assistant_summary(uuid, bigint) to fit_api;
grant execute on function public.cancel_assistant_action(uuid, bigint) to fit_api;

-- Down Migration
-- Forward-only: client-owned assistant history cannot be converted back to a
-- trainer foreign key without deleting valid product data.
