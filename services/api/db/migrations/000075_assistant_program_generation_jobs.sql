-- Up Migration

-- Short actor-scoped leases keep an expensive program generation idempotent
-- without holding a PostgreSQL transaction open during the YandexGPT call.
create table private.assistant_program_generations (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  lease_id uuid not null,
  lease_until timestamptz not null,
  result jsonb,
  created_at timestamptz not null default now()
);

revoke all on private.assistant_program_generations from public, fit_api;

create or replace function public.assistant_program_generation_job(
  p_id uuid,
  p_client_id uuid,
  p_lease_id uuid,
  p_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  job private.assistant_program_generations;
begin
  if actor_id is null or p_id is null or p_client_id is null or p_lease_id is null then
    raise exception 'invalid_program_job' using errcode = 'PT422';
  end if;
  if not public.can_access_client(p_client_id)
    or exists (
      select 1 from public.clients client
      where client.id = p_client_id and client.archived_at is not null
    )
  then
    raise exception 'assistant_program_owner_required' using errcode = 'PT403';
  end if;

  insert into private.assistant_program_generations (
    id, owner_id, client_id, lease_id, lease_until
  ) values (
    p_id, actor_id, p_client_id, p_lease_id, now() + interval '3 minutes'
  ) on conflict (id) do nothing;

  select * into job
  from private.assistant_program_generations
  where id = p_id
  for update;

  if job.owner_id <> actor_id or job.client_id <> p_client_id then
    raise exception 'program_job_owner_mismatch' using errcode = 'PT403';
  end if;
  if job.result is not null then
    return jsonb_build_object('status', 'complete', 'result', job.result);
  end if;
  if p_result is not null then
    if job.lease_id <> p_lease_id
      or job.lease_until <= now()
      or jsonb_typeof(p_result) <> 'object'
    then
      raise exception 'program_job_conflict' using errcode = 'PT409';
    end if;
    update private.assistant_program_generations
    set result = p_result
    where id = p_id;
    return jsonb_build_object('status', 'complete', 'result', p_result);
  end if;
  if job.lease_id = p_lease_id or job.lease_until <= now() then
    update private.assistant_program_generations
    set lease_id = p_lease_id, lease_until = now() + interval '3 minutes'
    where id = p_id;
    return jsonb_build_object('status', 'claimed');
  end if;
  return jsonb_build_object('status', 'busy');
end;
$$;

create or replace function public.release_assistant_program_generation_job(
  p_id uuid,
  p_client_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.assistant_program_generations
  set lease_until = now()
  where id = p_id
    and owner_id = auth.uid()
    and client_id = p_client_id
    and lease_id = p_lease_id
    and result is null;
  return found;
end;
$$;

revoke all on function public.assistant_program_generation_job(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.release_assistant_program_generation_job(uuid, uuid, uuid) from public;
grant execute on function public.assistant_program_generation_job(uuid, uuid, uuid, jsonb) to fit_api;
grant execute on function public.release_assistant_program_generation_job(uuid, uuid, uuid) to fit_api;

-- Keep the program source timestamp sensitive to edits outside workouts, just
-- like the Supabase implementation. The common updated_at trigger performs the
-- actual timestamp change on clients.
create or replace function app_private.touch_program_client_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := coalesce(new.client_id, old.client_id);
begin
  update public.clients set updated_at = clock_timestamp() where id = target_id;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.touch_program_client_source() from public, fit_api;

create trigger program_source_goal_changed
after insert or update or delete on public.client_goals
for each row execute function app_private.touch_program_client_source();

create trigger program_source_stage_changed
after insert or update or delete on public.goal_stages
for each row execute function app_private.touch_program_client_source();

create trigger program_source_criteria_changed
after insert or update or delete on public.goal_criteria
for each row execute function app_private.touch_program_client_source();

create trigger program_source_progress_changed
after insert or update or delete on public.client_progress
for each row execute function app_private.touch_program_client_source();

-- Down Migration

drop trigger program_source_progress_changed on public.client_progress;
drop trigger program_source_criteria_changed on public.goal_criteria;
drop trigger program_source_stage_changed on public.goal_stages;
drop trigger program_source_goal_changed on public.client_goals;
drop function app_private.touch_program_client_source();
revoke execute on function public.release_assistant_program_generation_job(uuid, uuid, uuid) from fit_api;
revoke execute on function public.assistant_program_generation_job(uuid, uuid, uuid, jsonb) from fit_api;
drop function public.release_assistant_program_generation_job(uuid, uuid, uuid);
drop function public.assistant_program_generation_job(uuid, uuid, uuid, jsonb);
drop table private.assistant_program_generations;
