-- Program generation jobs are claimed by the authenticated assistant actor.
-- Trainers were the only supported owners when the lease table was added;
-- client-owned programs must also be able to claim a job for the client's own
-- active card. The RPC remains service-role-only.

create or replace function public.assistant_program_generation_job(
  p_id uuid, p_owner_id uuid, p_client_id uuid, p_lease_id uuid,
  p_result jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare job private.assistant_program_generations;
begin
  if p_id is null or p_owner_id is null or p_client_id is null or p_lease_id is null then
    raise exception 'invalid_program_job' using errcode = 'PT422';
  end if;
  if not exists(select 1 from public.trainers where profile_id = p_owner_id)
    and not exists(
      select 1
      from public.clients client
      where client.id = p_client_id
        and client.auth_user_id = p_owner_id
        and client.archived_at is null
    )
  then
    raise exception 'assistant_program_owner_required' using errcode = 'PT403';
  end if;
  insert into private.assistant_program_generations(id, owner_id, client_id, lease_id, lease_until)
    values(p_id, p_owner_id, p_client_id, p_lease_id, now() + interval '3 minutes')
    on conflict(id) do nothing;
  select * into job from private.assistant_program_generations where id = p_id for update;
  if job.owner_id <> p_owner_id or job.client_id <> p_client_id then
    raise exception 'program_job_owner_mismatch' using errcode = 'PT403';
  end if;
  if job.result is not null then return jsonb_build_object('status','complete','result',job.result); end if;
  if p_result is not null then
    if job.lease_id <> p_lease_id or job.lease_until <= now() or jsonb_typeof(p_result) <> 'object' then
      raise exception 'program_job_conflict' using errcode = 'PT409';
    end if;
    update private.assistant_program_generations set result = p_result where id = p_id;
    return jsonb_build_object('status','complete','result',p_result);
  end if;
  if job.lease_id = p_lease_id or job.lease_until <= now() then
    update private.assistant_program_generations set lease_id = p_lease_id, lease_until = now() + interval '3 minutes' where id = p_id;
    return jsonb_build_object('status','claimed');
  end if;
  return jsonb_build_object('status','busy');
end;
$$;

revoke all on function public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb)
  to service_role;
