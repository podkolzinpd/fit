-- Keep the assistant's completed progress summary durable and renderable in chat.
-- The source of trainer text and metrics is always client_training_summaries;
-- action payload is used only for conversational labels supplied by the flow.
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
  summary_row public.client_training_summaries;
  summary_result jsonb;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'assistant_trainer_required' using errcode = 'PT403';
  end if;

  select * into action_row
  from public.assistant_actions
  where id = p_action_id and owner_id = actor_id
  for update;
  if not found then raise exception 'assistant_action_not_found' using errcode = 'PT404'; end if;
  if action_row.tool <> 'summarize_progress' then
    raise exception 'assistant_action_tool_mismatch' using errcode = 'PT422';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied')) || jsonb_build_object('version', action_row.version);
  end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  select * into summary_row
  from public.client_training_summaries
  where trainer_id = actor_id
    and client_id = nullif(action_row.payload->>'clientId', '')::uuid
    and period_start = nullif(action_row.payload->>'periodStart', '')::date
    and period_end = nullif(action_row.payload->>'periodEnd', '')::date
  order by generated_at desc
  limit 1;
  if not found then raise exception 'assistant_summary_not_found' using errcode = 'PT404'; end if;

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
      'completedWorkouts', coalesce(summary_row.display_metrics->'completed_workouts', '0'::jsonb),
      'workoutsPerWeek', coalesce(summary_row.display_metrics->'workouts_per_week', '0'::jsonb),
      'activeWeeks', coalesce(summary_row.display_metrics->'active_weeks', '0'::jsonb)
    )
  );

  update public.assistant_actions
  set status = 'applied', result = summary_result,
      version = version + 1, updated_at = now(), applied_at = now()
  where id = action_row.id;
  return summary_result || jsonb_build_object('version', action_row.version + 1);
end;
$$;

revoke all on function public.complete_assistant_summary(uuid, bigint) from public, anon;
grant execute on function public.complete_assistant_summary(uuid, bigint) to authenticated;
