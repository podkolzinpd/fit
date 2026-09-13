create or replace function public.publish_cached_training_summary_for_client(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_prompt_version text,
  p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  client_row public.clients%rowtype;
  source_row public.client_training_summaries%rowtype;
  visible public.client_published_training_summaries%rowtype;
begin
  select client.* into client_row
  from public.clients client
  where client.id = p_client_id and client.archived_at is null;

  if client_row.id is null
    or (request_role <> 'service_role' and actor_id is distinct from client_row.auth_user_id)
  then
    raise exception 'training_summary_forbidden' using errcode = 'PT403';
  end if;

  select summary.* into source_row
  from public.client_training_summaries summary
  where summary.client_id = p_client_id
    and summary.period_start = p_period_start
    and summary.period_end = p_period_end
    and summary.prompt_version = p_prompt_version
    and summary.input_fingerprint = p_input_fingerprint;

  if source_row.id is null then return null; end if;

  insert into public.client_published_training_summaries (
    source_summary_id, trainer_id, client_id, period_start, period_end,
    summary, display_metrics, generated_at,
    published_at, published_by
  ) values (
    source_row.id, source_row.trainer_id, source_row.client_id,
    source_row.period_start, source_row.period_end, source_row.client_summary,
    source_row.display_metrics, source_row.generated_at, now(), null
  ) on conflict (client_id, period_start, period_end)
  do update set
    source_summary_id = excluded.source_summary_id,
    trainer_id = excluded.trainer_id,
    summary = excluded.summary,
    display_metrics = excluded.display_metrics,
    generated_at = excluded.generated_at,
    published_at = excluded.published_at,
    published_by = null
  returning * into visible;

  return jsonb_build_object(
    'id', visible.id,
    'source_summary_id', visible.source_summary_id,
    'client_id', visible.client_id,
    'period_start', visible.period_start,
    'period_end', visible.period_end,
    'summary', visible.summary,
    'display_metrics', visible.display_metrics,
    'generated_at', visible.generated_at,
    'published_at', visible.published_at
  );
end;
$$;

revoke all on function public.publish_cached_training_summary_for_client(uuid, date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_cached_training_summary_for_client(uuid, date, date, text, text)
  to service_role;
