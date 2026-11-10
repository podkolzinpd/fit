-- Up Migration
-- Additive metadata preserves legacy API kinds and all historical records.
alter table public.trainer_finance_packages
  add column if not exists single_session boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid='public.trainer_finance_packages'::regclass
      and conname='trainer_finance_single_session_valid') then
    alter table public.trainer_finance_packages add constraint trainer_finance_single_session_valid
      check (not single_session or (kind='session_pack' and sessions_total=1));
  end if;
end $$;

create or replace function app_private.trainer_finance_package_payload_v2(p_package_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with package_state as (
    select package.*,
      package.opening_used_sessions
        + coalesce(session_totals.used_sessions, 0) as sessions_used,
      coalesce(payment_totals.paid_cents, 0) as paid_cents,
      (now() at time zone profile.timezone)::date as today
    from public.trainer_finance_packages package
    join public.profiles profile on profile.id = package.trainer_id
    left join lateral (
      select count(*)::integer as used_sessions
      from public.trainer_finance_sessions session
      where session.package_id = package.id
        and session.disposition = 'charged'
        and session.voided_at is null
    ) session_totals on true
    left join lateral (
      select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
      from public.trainer_finance_payments payment
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.id = p_package_id and package.trainer_id = auth.uid()
  )
  select jsonb_build_object(
    'id', id,
    'clientId', client_id,
    'trainerId', trainer_id,
    'kind', kind,
    'singleSession', single_session,
    'title', title,
    'sessionsTotal', sessions_total,
    'sessionsUsed', case when kind = 'session_pack'
      then sessions_used else 0 end,
    'sessionsRemaining', case when kind = 'session_pack'
      then greatest(sessions_total - sessions_used, 0) else 0 end,
    'priceCents', price_cents,
    'paidCents', paid_cents,
    'dueCents', greatest(price_cents - paid_cents, 0),
    'startsOn', starts_on,
    'endsOn', ends_on,
    'paymentDueOn', payment_due_on,
    'comment', comment,
    'packageStatus', case
      when closed_at is not null then 'closed'
      when kind = 'session_pack' and sessions_used >= sessions_total then 'completed'
      when ends_on is not null and ends_on < today then 'expired'
      when starts_on > today then 'upcoming'
      else 'active'
    end,
    'paymentStatus', case
      when paid_cents >= price_cents then 'paid'
      when payment_due_on is not null and payment_due_on < today then 'overdue'
      when paid_cents > 0 then 'partial'
      else 'unpaid'
    end,
    'closedAt', closed_at,
    'version', version,
    'createdAt', created_at,
    'updatedAt', updated_at
  )
  from package_state
$$;

create or replace function public.list_client_finance_self_v2()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  client_id_value uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
  if actor_id is null or actor_role <> 'client' then
    raise exception 'trainer_finance_forbidden' using errcode = 'PT403';
  end if;
  select client.id into client_id_value
  from public.clients client
  where client.auth_user_id = actor_id
    and client.merged_into_client_id is null
    and client.archived_at is null;
  if client_id_value is null then
    return jsonb_build_object('trainers', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'trainers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trainerId', scope.trainer_id,
        'trainerName', coalesce(
          nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          'Тренер'
        ),
        'packages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', state.id, 'kind', state.kind, 'title', state.title,
            'singleSession', state.single_session,
            'sessionsTotal', state.sessions_total,
            'sessionsUsed', case when state.kind = 'session_pack'
              then state.sessions_used else 0 end,
            'sessionsRemaining', case when state.kind = 'session_pack'
              then greatest(state.sessions_total - state.sessions_used, 0) else 0 end,
            'priceCents', state.price_cents, 'paidCents', state.paid_cents,
            'dueCents', greatest(state.price_cents - state.paid_cents, 0),
            'startsOn', state.starts_on, 'endsOn', state.ends_on,
            'paymentDueOn', state.payment_due_on,
            'packageStatus', case
              when state.closed_at is not null then 'closed'
              when state.kind = 'session_pack' and state.sessions_used >= state.sessions_total then 'completed'
              when state.ends_on is not null and state.ends_on < state.today then 'expired'
              when state.starts_on > state.today then 'upcoming'
              else 'active'
            end,
            'paymentStatus', case
              when state.paid_cents >= state.price_cents then 'paid'
              when state.payment_due_on is not null and state.payment_due_on < state.today then 'overdue'
              when state.paid_cents > 0 then 'partial'
              else 'unpaid'
            end
          ) order by state.starts_on desc, state.created_at desc)
          from (
            select package.*,
              package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) as sessions_used,
              coalesce(payment_totals.paid_cents, 0)::bigint as paid_cents,
              (now() at time zone profile.timezone)::date as today
            from public.trainer_finance_packages package
            left join lateral (
              select count(*)::integer as used_sessions
              from public.trainer_finance_sessions session
              where session.package_id = package.id
                and session.disposition = 'charged'
                and session.voided_at is null
            ) session_totals on true
            left join lateral (
              select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
              from public.trainer_finance_payments payment
              where payment.package_id = package.id and payment.voided_at is null
            ) payment_totals on true
            where package.client_id = client_id_value
              and package.trainer_id = scope.trainer_id
          ) state
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', payment.id, 'packageId', payment.package_id,
            'amountCents', payment.amount_cents, 'receivedOn', payment.received_on
          ) order by payment.received_on desc, payment.created_at desc)
          from public.trainer_finance_payments payment
          where payment.client_id = client_id_value
            and payment.trainer_id = scope.trainer_id
            and payment.voided_at is null
        ), '[]'::jsonb)
      ) order by profile.first_name nulls last, profile.last_name nulls last, scope.trainer_id)
      from (
        select distinct package.trainer_id
        from public.trainer_finance_packages package
        where package.client_id = client_id_value
      ) scope
      join public.profiles profile on profile.id = scope.trainer_id
    ), '[]'::jsonb)
  );
end;
$$;




create or replace function public.create_trainer_finance_service_v3(
  p_client_id uuid, p_kind text, p_title text, p_sessions_total integer,
  p_opening_used_sessions integer, p_price_cents bigint, p_opening_paid_cents bigint,
  p_starts_on date, p_ends_on date, p_payment_due_on date, p_comment text,
  p_opening_received_on date, p_request_id uuid, p_single_session boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id_value uuid := app_private.trainer_finance_assert_trainer();
  request_payload jsonb := jsonb_build_array('createSingleService',p_client_id,p_kind,p_title,
    p_sessions_total,p_opening_used_sessions,p_price_cents,p_opening_paid_cents,p_starts_on,
    p_ends_on,p_payment_due_on,p_comment,p_opening_received_on,p_single_session);
  receipt app_private.finance_payment_requests;
  result_value jsonb;
  package_id_value uuid;
begin
  if not app_private.trainer_finance_has_connection(actor_id_value,p_client_id) then
    raise exception 'trainer_finance_client_not_found' using errcode='PT404';
  end if;
  if p_single_session is distinct from true or p_kind is distinct from 'session_pack'
    or p_sessions_total is distinct from 1 or p_request_id is null then
    raise exception 'trainer_finance_invalid' using errcode='PT422';
  end if;
  insert into app_private.finance_payment_requests(actor_id,request_id,payload)
    values(actor_id_value,p_request_id,request_payload) on conflict do nothing;
  select * into receipt from app_private.finance_payment_requests
    where actor_id=actor_id_value and request_id=p_request_id for update;
  if receipt.payload <> request_payload then
    raise exception 'trainer_finance_conflict' using errcode='PT409';
  end if;
  if receipt.result is not null then return receipt.result; end if;
  result_value := public.create_trainer_finance_service_v2(p_client_id,p_kind,p_title,
    p_sessions_total,p_opening_used_sessions,p_price_cents,p_opening_paid_cents,p_starts_on,
    p_ends_on,p_payment_due_on,p_comment,p_opening_received_on,null);
  package_id_value := (result_value->>'id')::uuid;
  update public.trainer_finance_packages set single_session=true where id=package_id_value;
  result_value := app_private.trainer_finance_package_payload_v2(package_id_value);
  update app_private.finance_payment_requests set result=result_value
    where actor_id=actor_id_value and request_id=p_request_id;
  return result_value;
end;
$$;
revoke all on function public.create_trainer_finance_service_v3(uuid,text,text,integer,integer,bigint,bigint,date,date,date,text,date,uuid,boolean) from public;
grant execute on function public.create_trainer_finance_service_v3(uuid,text,text,integer,integer,bigint,bigint,date,date,date,text,date,uuid,boolean) to fit_api;

create or replace function public.finish_single_trainer_workout(
  p_workout_id uuid,p_expected_version bigint,p_operation_id uuid,
  p_price_cents bigint,p_paid_cents bigint,p_received_on date
) returns table(version bigint,replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  workout_row public.workouts;
  service jsonb;
begin
  perform 1 from app_private.authorize_workout_lifecycle(p_workout_id,false);
  select * into workout_row from public.workouts where id=p_workout_id for update;
  if workout_row.training_format is distinct from 'with_trainer' then
    raise exception 'workout_invalid' using errcode='PT422';
  end if;
  service := public.create_trainer_finance_service_v3(workout_row.client_id,'session_pack',
    'Разовое занятие',1,0,p_price_cents,p_paid_cents,workout_row.workout_date,
    null,null,null,p_received_on,p_operation_id,true);
  return query select finished.version,finished.replayed from public.finish_live_workout(
    p_workout_id,p_expected_version,p_operation_id,true,'charged',(service->>'id')::uuid) finished;
end;
$$;
revoke all on function public.finish_single_trainer_workout(uuid,bigint,uuid,bigint,bigint,date) from public;
grant execute on function public.finish_single_trainer_workout(uuid,bigint,uuid,bigint,bigint,date) to fit_api;

-- Down Migration
-- Forward-only: preserve recorded services, receipts and session history.
