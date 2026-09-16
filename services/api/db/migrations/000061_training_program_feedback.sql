-- Up Migration

alter table public.app_feedback
  add column model_input_json jsonb,
  add column model_output_json jsonb,
  drop constraint app_feedback_kind_check,
  add constraint app_feedback_kind_check
    check (kind in ('suggestion', 'problem', 'training program')),
  add constraint app_feedback_training_program_payloads
    check ((kind = 'training program') = (model_input_json is not null and model_output_json is not null));

create function public.submit_app_feedback(
  p_kind text,
  p_message text,
  p_screen_path text,
  p_app_version text,
  p_display_mode text,
  p_user_agent text,
  p_model_input_json jsonb,
  p_model_output_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_kind text := lower(btrim(p_kind));
  normalized_message text := btrim(p_message);
  normalized_display_mode text := lower(btrim(p_display_mode));
  feedback_id uuid;
begin
  select profile.account_role into actor_role from public.profiles profile where profile.id = actor_id;
  if actor_id is null or actor_role is null or actor_role not in ('trainer', 'client') then
    raise exception 'app_feedback_forbidden' using errcode = 'PT403';
  end if;
  if normalized_kind not in ('suggestion', 'problem', 'training program')
    or normalized_message is null or char_length(normalized_message) not between 3 and 2000
    or normalized_display_mode not in ('browser', 'standalone')
    or (normalized_kind = 'training program' and (p_model_input_json is null or p_model_output_json is null))
    or (normalized_kind <> 'training program' and (p_model_input_json is not null or p_model_output_json is not null)) then
    raise exception 'app_feedback_invalid' using errcode = 'PT422';
  end if;
  insert into public.app_feedback (user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, model_input_json, model_output_json)
  values (actor_id, actor_role, normalized_kind, normalized_message, left(coalesce(nullif(btrim(p_screen_path), ''), '/'), 500), left(coalesce(nullif(btrim(p_app_version), ''), 'unknown'), 64), normalized_display_mode, left(coalesce(nullif(btrim(p_user_agent), ''), 'unknown'), 512), p_model_input_json, p_model_output_json)
  returning id into feedback_id;
  return feedback_id;
exception when check_violation then
  raise exception 'app_feedback_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb) to fit_api;

create or replace function app_private.claim_app_feedback_deliveries(
  p_limit integer default 20, p_now timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lease_token uuid := gen_random_uuid(); deliveries jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422'; end if;
  update public.app_feedback feedback set tracker_sync_attempts = case when feedback.tracker_issue_key is null then least(feedback.tracker_sync_attempts + 1, 10) else feedback.tracker_sync_attempts end, tracker_last_error = case when feedback.tracker_issue_key is null then 'dispatch_timeout' else feedback.tracker_last_error end, telegram_sync_attempts = case when feedback.telegram_notified_at is null then least(feedback.telegram_sync_attempts + 1, 10) else feedback.telegram_sync_attempts end, telegram_last_error = case when feedback.telegram_notified_at is null then 'dispatch_timeout' else feedback.telegram_last_error end, operations_dispatch_token = null, operations_dispatch_started_at = null where feedback.operations_dispatch_started_at < p_now - interval '10 minutes';
  with due as materialized (select feedback.id from public.app_feedback feedback where feedback.operations_dispatch_token is null and ((feedback.tracker_issue_key is null and feedback.tracker_sync_attempts < 10) or (feedback.telegram_notified_at is null and feedback.telegram_sync_attempts < 10)) order by feedback.created_at, feedback.id limit p_limit for update of feedback skip locked), claimed as (
    update public.app_feedback feedback set operations_dispatch_token = lease_token, operations_dispatch_started_at = p_now from due where feedback.id = due.id returning feedback.id, feedback.account_role, feedback.kind, feedback.message, feedback.screen_path, feedback.app_version, feedback.display_mode, feedback.created_at, feedback.model_input_json, feedback.model_output_json, feedback.tracker_issue_key is null and feedback.tracker_sync_attempts < 10 as send_tracker, feedback.telegram_notified_at is null and feedback.telegram_sync_attempts < 10 as send_telegram
  ) select jsonb_agg(jsonb_build_object('id', claimed.id, 'accountRole', claimed.account_role, 'kind', claimed.kind, 'message', claimed.message, 'screenPath', claimed.screen_path, 'appVersion', claimed.app_version, 'displayMode', claimed.display_mode, 'createdAt', claimed.created_at, 'modelInputJson', claimed.model_input_json, 'modelOutputJson', claimed.model_output_json, 'sendTracker', claimed.send_tracker, 'sendTelegram', claimed.send_telegram) order by claimed.created_at, claimed.id) into deliveries from claimed;
  if deliveries is null then return null; end if;
  return jsonb_build_object('dispatchToken', lease_token, 'deliveries', deliveries);
end;
$$;

-- Down Migration

revoke execute on function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb) from fit_api;
drop function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb);
alter table public.app_feedback
  drop constraint app_feedback_training_program_payloads,
  drop constraint app_feedback_kind_check,
  add constraint app_feedback_kind_check check (kind in ('suggestion', 'problem')),
  drop column model_output_json,
  drop column model_input_json;
