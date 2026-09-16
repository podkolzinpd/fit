-- A successful result is cached by the exact input fingerprint. A pending
-- identical request is already deduplicated, and failed requests keep their
-- cooldown. A second period-wide lock therefore only blocks legitimate new
-- input (for example, a newly completed workout) without saving model calls.

create or replace function public.claim_training_summary_generation(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_input_fingerprint text,
  p_request_id uuid,
  p_source_input_chars integer,
  p_model_input_chars integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  guard app_private.training_summary_generation_guards%rowtype;
  calls_today integer;
  period_retry_after timestamptz;
  utc_day date := (timezone('utc', now()))::date;
begin
  if p_period_end < p_period_start or p_request_id is null
    or btrim(coalesce(p_input_fingerprint, '')) = ''
    or p_source_input_chars < 0 or p_model_input_chars < 0
  then
    raise exception 'training_summary_generation_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 9102026));
  select * into guard from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id and stored.period_start = p_period_start
    and stored.period_end = p_period_end and stored.input_fingerprint = p_input_fingerprint
  for update;

  if guard.status = 'succeeded' then return jsonb_build_object('decision', 'cached'); end if;
  if guard.status = 'pending' and guard.lease_until > now() then
    return jsonb_build_object('decision', 'in_progress', 'retry_after', guard.lease_until);
  end if;
  if guard.status = 'failed' and guard.retry_after > now() then
    return jsonb_build_object('decision', 'cooldown', 'retry_after', guard.retry_after);
  end if;

  select max(stored.retry_after) into period_retry_after
  from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id
    and stored.period_start = p_period_start and stored.period_end = p_period_end
    and stored.status = 'failed'
    and stored.retry_after > now();
  if period_retry_after is not null then
    return jsonb_build_object('decision', 'cooldown', 'retry_after', period_retry_after);
  end if;

  select coalesce(sum(stored.model_calls_today), 0)::integer into calls_today
  from app_private.training_summary_generation_guards stored
  where stored.client_id = p_client_id and stored.model_calls_day = utc_day;
  if calls_today >= 3 then
    return jsonb_build_object('decision', 'daily_limit', 'calls_today', calls_today);
  end if;

  insert into app_private.training_summary_generation_guards (
    client_id, period_start, period_end, input_fingerprint, status, owner_request_id,
    lease_until, retry_after, model_calls_day, model_calls_today,
    source_input_chars, model_input_chars, token_usage, failure_code, updated_at
  ) values (
    p_client_id, p_period_start, p_period_end, p_input_fingerprint, 'pending', p_request_id,
    now() + interval '2 minutes', null, utc_day, 1,
    p_source_input_chars, p_model_input_chars, null, null, now()
  ) on conflict (client_id, period_start, period_end, input_fingerprint) do update set
    status = 'pending', owner_request_id = excluded.owner_request_id,
    lease_until = excluded.lease_until, retry_after = null,
    model_calls_today = case
      when app_private.training_summary_generation_guards.model_calls_day = utc_day
        then app_private.training_summary_generation_guards.model_calls_today + 1
      else 1 end,
    model_calls_day = utc_day, source_input_chars = excluded.source_input_chars,
    model_input_chars = excluded.model_input_chars, token_usage = null,
    failure_code = null, updated_at = now();
  return jsonb_build_object('decision', 'claimed', 'calls_today', calls_today + 1);
end;
$$;

revoke all on function public.claim_training_summary_generation(
  uuid, date, date, text, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_training_summary_generation(
  uuid, date, date, text, uuid, integer, integer
) to service_role;

notify pgrst, 'reload schema';
