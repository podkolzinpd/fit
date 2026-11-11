-- Up Migration

create function public.correct_trainer_finance_balance(
  p_package_id uuid, p_expected_version bigint, p_remaining_sessions integer,
  p_reason text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id_value uuid := app_private.trainer_finance_assert_trainer();
  target public.trainer_finance_packages;
  receipt app_private.finance_payment_requests;
  request_payload jsonb := jsonb_build_array('correctPackageBalance', p_package_id,
    p_expected_version, p_remaining_sessions, p_reason);
  recorded_sessions integer;
  previous_remaining integer;
  result_value jsonb;
  event_id bigint;
begin
  if p_request_id is null or p_expected_version is null or p_expected_version < 1
    or p_remaining_sessions is null or p_remaining_sessions not between 0 and 10000
    or nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(p_reason) > 500 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select * into target from public.trainer_finance_packages
    where id = p_package_id and trainer_id = actor_id_value;
  if not found then raise exception 'trainer_finance_package_not_found' using errcode = 'PT404'; end if;

  insert into app_private.finance_payment_requests(actor_id,request_id,payload)
    values(actor_id_value,p_request_id,request_payload) on conflict do nothing;
  select * into receipt from app_private.finance_payment_requests
    where actor_id=actor_id_value and request_id=p_request_id for update;
  if receipt.payload <> request_payload then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  if receipt.result is not null then return receipt.result; end if;

  -- Same ledger lock as service edits and actual workout/session accounting.
  -- Do not lock workouts: those writers lock workout -> ledger, in that order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor_id_value::text || ':' || target.client_id::text, 0
  ));
  select * into target from public.trainer_finance_packages
    where id=p_package_id and trainer_id=actor_id_value for update;
  if not found then raise exception 'trainer_finance_package_not_found' using errcode = 'PT404'; end if;
  if target.version <> p_expected_version then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  if target.kind <> 'session_pack' or target.single_session then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select count(*)::integer into recorded_sessions from public.trainer_finance_sessions
    where package_id=p_package_id and disposition='charged' and voided_at is null;
  if p_remaining_sessions > target.sessions_total-recorded_sessions then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  previous_remaining := greatest(target.sessions_total-target.opening_used_sessions-recorded_sessions,0);
  if p_remaining_sessions <> previous_remaining then
    update public.trainer_finance_packages
      set opening_used_sessions=target.sessions_total-recorded_sessions-p_remaining_sessions,
        version=version+1
      where id=p_package_id;
    -- Enrich only the audit event just created by the existing package trigger.
    -- Earlier events, actual sessions, workouts, money and package comment stay intact.
    select id into event_id from public.trainer_finance_events
      where entity_type='package' and entity_id=p_package_id and actor_id=actor_id_value
        and current_data->>'version'=(target.version+1)::text
      order by id desc limit 1;
    if event_id is null then raise exception 'finance_balance_audit_missing'; end if;
    update public.trainer_finance_events set current_data=current_data || jsonb_build_object(
      'balanceCorrection',jsonb_build_object('previousRemaining',previous_remaining,
        'remainingSessions',p_remaining_sessions,'reason',btrim(p_reason),'requestId',p_request_id)
    ) where id=event_id;
  end if;
  result_value := app_private.trainer_finance_package_payload_v2(p_package_id);
  update app_private.finance_payment_requests set result=result_value
    where actor_id=actor_id_value and request_id=p_request_id;
  return result_value;
end;
$$;
revoke all on function public.correct_trainer_finance_balance(uuid,bigint,integer,text,uuid) from public;
grant execute on function public.correct_trainer_finance_balance(uuid,bigint,integer,text,uuid) to fit_api;

-- Down Migration

drop function public.correct_trainer_finance_balance(uuid,bigint,integer,text,uuid);
