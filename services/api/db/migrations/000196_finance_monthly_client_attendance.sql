-- Up Migration

-- Read-only source attendance: no synthesized charges or historical money writes.
create or replace function public.list_trainer_finance_client_v2(p_client_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if not public.is_active_client_trainer_connection(p_client_id, actor_id)
    and not exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ) and not exists (
      select 1 from public.trainer_finance_sessions session
      where session.trainer_id = actor_id and session.client_id = p_client_id
    ) and not exists (
      select 1 from public.workouts workout
      where workout.client_id = p_client_id and workout.status = 'done'
        and workout.deleted_at is null and workout.training_format = 'with_trainer'
        and coalesce(workout.created_by, workout.trainer_id) = actor_id
    ) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;

  return jsonb_build_object(
    'clientId', p_client_id,
    'canCreate', app_private.trainer_finance_has_connection(actor_id, p_client_id),
    -- Only the display name accompanies an already authorized own ledger.
    'clientName', (select client.full_name from public.clients client where client.id = p_client_id),
    'attendedWorkouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workoutId', workout.id, 'workoutDate', workout.workout_date, 'title', workout.title
      ) order by workout.workout_date desc, workout.id)
      from public.workouts workout
      where workout.client_id = p_client_id and workout.status = 'done'
        and workout.deleted_at is null and workout.training_format = 'with_trainer'
        and coalesce(workout.created_by, workout.trainer_id) = actor_id
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(app_private.trainer_finance_package_payload_v2(package.id)
        order by package.starts_on desc, package.created_at desc)
      from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id, 'packageId', payment.package_id,
        'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
        'source', payment.source, 'comment', payment.comment,
        'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
        'version', payment.version, 'createdAt', payment.created_at,
        'updatedAt', payment.updated_at
      ) order by payment.received_on desc, payment.created_at desc)
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.client_id = p_client_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', session.id, 'packageId', session.package_id,
        'workoutId', session.workout_id, 'disposition', session.disposition,
        'source', session.source, 'comment', session.comment,
        'workoutDate', workout.workout_date, 'voidedAt', session.voided_at,
        'voidReason', session.void_reason, 'version', session.version,
        'createdAt', session.created_at, 'updatedAt', session.updated_at
      ) order by workout.workout_date desc, session.created_at desc)
      from public.trainer_finance_sessions session
      join public.workouts workout on workout.id = session.workout_id
      where session.trainer_id = actor_id and session.client_id = p_client_id
    ), '[]'::jsonb)
  );
end;
$$;



-- Down Migration

create or replace function public.list_trainer_finance_client_v2(p_client_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := app_private.trainer_finance_assert_trainer();
begin
  if not public.is_active_client_trainer_connection(p_client_id, actor_id)
    and not exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ) and not exists (
      select 1 from public.trainer_finance_sessions session
      where session.trainer_id = actor_id and session.client_id = p_client_id
    ) and not exists (
      select 1 from public.workouts workout
      where workout.client_id = p_client_id and workout.status = 'done'
        and workout.deleted_at is null and workout.training_format = 'with_trainer'
        and coalesce(workout.created_by, workout.trainer_id) = actor_id
    ) then
    raise exception 'trainer_finance_client_not_found' using errcode = 'PT404';
  end if;

  return jsonb_build_object(
    'clientId', p_client_id,
    'canCreate', app_private.trainer_finance_has_connection(actor_id, p_client_id),
    -- Only the display name accompanies an already authorized own ledger.
    'clientName', (select client.full_name from public.clients client where client.id = p_client_id),
    'packages', coalesce((
      select jsonb_agg(app_private.trainer_finance_package_payload_v2(package.id)
        order by package.starts_on desc, package.created_at desc)
      from public.trainer_finance_packages package
      where package.trainer_id = actor_id and package.client_id = p_client_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id, 'packageId', payment.package_id,
        'amountCents', payment.amount_cents, 'receivedOn', payment.received_on,
        'source', payment.source, 'comment', payment.comment,
        'voidedAt', payment.voided_at, 'voidReason', payment.void_reason,
        'version', payment.version, 'createdAt', payment.created_at,
        'updatedAt', payment.updated_at
      ) order by payment.received_on desc, payment.created_at desc)
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.client_id = p_client_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', session.id, 'packageId', session.package_id,
        'workoutId', session.workout_id, 'disposition', session.disposition,
        'source', session.source, 'comment', session.comment,
        'workoutDate', workout.workout_date, 'voidedAt', session.voided_at,
        'voidReason', session.void_reason, 'version', session.version,
        'createdAt', session.created_at, 'updatedAt', session.updated_at
      ) order by workout.workout_date desc, session.created_at desc)
      from public.trainer_finance_sessions session
      join public.workouts workout on workout.id = session.workout_id
      where session.trainer_id = actor_id and session.client_id = p_client_id
    ), '[]'::jsonb)
  );
end;
$$;
