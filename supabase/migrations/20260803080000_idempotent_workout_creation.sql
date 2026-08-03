create table private.workout_create_requests (
  trainer_id uuid not null references public.trainers(profile_id) on delete cascade,
  request_id uuid not null,
  workout_id uuid references public.workouts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trainer_id, request_id)
);

alter function public.save_workout(jsonb, bigint) rename to legacy_save_workout_request;
alter function public.legacy_save_workout_request(jsonb, bigint) set schema private;
alter function public.save_completed_workout(jsonb, bigint) rename to legacy_save_completed_workout_request;
alter function public.legacy_save_completed_workout_request(jsonb, bigint) set schema private;

create or replace function private.claim_workout_create_request(p_trainer_id uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  insert into private.workout_create_requests (trainer_id, request_id)
  values (p_trainer_id, p_request_id)
  on conflict (trainer_id, request_id) do update set request_id = excluded.request_id
  returning workout_id into result;
  return result;
end;
$$;

create or replace function private.finish_workout_create_request(p_trainer_id uuid, p_request_id uuid, p_workout_id uuid)
returns void language sql security definer set search_path = '' as $$
  update private.workout_create_requests set workout_id = p_workout_id
  where trainer_id = p_trainer_id and request_id = p_request_id;
$$;

create or replace function public.save_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid; root_trainer uuid; result uuid;
begin
  if nullif(p_workout->>'id', '') is not null or request_id_value is null then
    return private.legacy_save_workout_request(p_workout, p_expected_version);
  end if;
  root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  result := private.claim_workout_create_request(root_trainer, request_id_value);
  if result is not null then return result; end if;
  result := private.legacy_save_workout_request(p_workout, p_expected_version);
  perform private.finish_workout_create_request(root_trainer, request_id_value, result);
  return result;
end;
$$;

create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid; root_trainer uuid; result uuid;
begin
  if nullif(p_workout->>'id', '') is not null or request_id_value is null then
    return private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  end if;
  root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  result := private.claim_workout_create_request(root_trainer, request_id_value);
  if result is not null then return result; end if;
  result := private.legacy_save_completed_workout_request(p_workout, p_expected_version);
  perform private.finish_workout_create_request(root_trainer, request_id_value, result);
  return result;
end;
$$;

revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
