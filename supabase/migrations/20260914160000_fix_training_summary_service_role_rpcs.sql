-- These RPCs are backend-only. Authorization is enforced by the EXECUTE
-- grants below instead of request.jwt.claim.role, which is not a reliable GUC
-- for service-role calls through every supported PostgREST runtime.

create or replace function public.claim_training_summary_generation(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_input_fingerprint text,
  p_request_id uuid,
  p_source_input_chars integer,
  p_model_input_chars integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  guard app_private.training_summary_generation_guards%rowtype;
  calls_today integer;
  period_calls_today integer;
  utc_day date := (timezone('utc', now()))::date;
begin
  if p_period_end < p_period_start
    or p_request_id is null
    or btrim(coalesce(p_input_fingerprint, '')) = ''
    or p_source_input_chars < 0
    or p_model_input_chars < 0
  then
    raise exception 'training_summary_generation_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 9102026));

  select * into guard
  from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id
    and stored.period_start = p_period_start
    and stored.period_end = p_period_end
    and stored.input_fingerprint = p_input_fingerprint
  for update;

  if guard.status = 'succeeded' then
    return jsonb_build_object('decision', 'cached');
  end if;
  if guard.status = 'pending' and guard.lease_until > now() then
    return jsonb_build_object('decision', 'in_progress', 'retry_after', guard.lease_until);
  end if;
  if guard.status = 'failed' and guard.retry_after > now() then
    return jsonb_build_object('decision', 'cooldown', 'retry_after', guard.retry_after);
  end if;

  select coalesce(sum(stored.model_calls_today), 0)::integer into calls_today
  from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id and stored.model_calls_day = utc_day;

  if calls_today >= 3 then
    return jsonb_build_object('decision', 'daily_limit', 'calls_today', calls_today);
  end if;
  select coalesce(sum(stored.model_calls_today), 0)::integer into period_calls_today
  from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id
    and stored.period_start = p_period_start
    and stored.period_end = p_period_end
    and stored.model_calls_day = utc_day;
  if period_calls_today >= 1 then
    return jsonb_build_object('decision', 'period_limit', 'calls_today', calls_today);
  end if;

  insert into app_private.training_summary_generation_guards (
    client_id, period_start, period_end, input_fingerprint, status,
    owner_request_id, lease_until, retry_after, model_calls_day,
    model_calls_today, source_input_chars, model_input_chars,
    token_usage, failure_code, updated_at
  ) values (
    p_client_id, p_period_start, p_period_end, p_input_fingerprint, 'pending',
    p_request_id, now() + interval '2 minutes', null, utc_day,
    1, p_source_input_chars, p_model_input_chars, null, null, now()
  ) on conflict (client_id, period_start, period_end, input_fingerprint)
  do update set
    status = 'pending',
    owner_request_id = excluded.owner_request_id,
    lease_until = excluded.lease_until,
    retry_after = null,
    model_calls_today = case
      when app_private.training_summary_generation_guards.model_calls_day = utc_day
        then app_private.training_summary_generation_guards.model_calls_today + 1
      else 1
    end,
    model_calls_day = utc_day,
    source_input_chars = excluded.source_input_chars,
    model_input_chars = excluded.model_input_chars,
    token_usage = null,
    failure_code = null,
    updated_at = now();

  return jsonb_build_object('decision', 'claimed', 'calls_today', calls_today + 1);
end;
$$;

create or replace function public.complete_training_summary_generation(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_input_fingerprint text,
  p_request_id uuid,
  p_token_usage jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.training_summary_generation_guards stored
  set status = 'succeeded', lease_until = null, retry_after = null,
      token_usage = p_token_usage, failure_code = null, updated_at = now()
  where stored.client_id = p_client_id
    and stored.period_start = p_period_start
    and stored.period_end = p_period_end
    and stored.input_fingerprint = p_input_fingerprint
    and stored.owner_request_id = p_request_id;
  return found;
end;
$$;

create or replace function public.fail_training_summary_generation(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_input_fingerprint text,
  p_request_id uuid,
  p_failure_code text,
  p_token_usage jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.training_summary_generation_guards stored
  set status = 'failed', lease_until = null, retry_after = now() + interval '30 minutes',
      token_usage = p_token_usage, failure_code = left(p_failure_code, 120), updated_at = now()
  where stored.client_id = p_client_id
    and stored.period_start = p_period_start
    and stored.period_end = p_period_end
    and stored.input_fingerprint = p_input_fingerprint
    and stored.owner_request_id = p_request_id;
  return found;
end;
$$;

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
  client_row public.clients%rowtype;
  source_row public.client_training_summaries%rowtype;
  visible public.client_published_training_summaries%rowtype;
begin
  select client.* into client_row
  from public.clients client
  where client.id = p_client_id and client.archived_at is null;

  if client_row.id is null then
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

revoke all on function public.claim_training_summary_generation(
  uuid, date, date, text, uuid, integer, integer
) from public, anon, authenticated;
revoke all on function public.complete_training_summary_generation(
  uuid, date, date, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.fail_training_summary_generation(
  uuid, date, date, text, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.publish_cached_training_summary_for_client(
  uuid, date, date, text, text
) from public, anon, authenticated;

grant execute on function public.claim_training_summary_generation(
  uuid, date, date, text, uuid, integer, integer
) to service_role;
grant execute on function public.complete_training_summary_generation(
  uuid, date, date, text, uuid, jsonb
) to service_role;
grant execute on function public.fail_training_summary_generation(
  uuid, date, date, text, uuid, text, jsonb
) to service_role;
grant execute on function public.publish_cached_training_summary_for_client(
  uuid, date, date, text, text
) to service_role;

notify pgrst, 'reload schema';
