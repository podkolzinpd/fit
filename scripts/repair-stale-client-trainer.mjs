// Operator-only, client-authorized repair of a diagnosed legacy membership.
// Reuses the deployed RPC; all assertions and the RPC run in one transaction.
export function buildStaleTrainerRepair({ emailHash, trainerNameHash }) {
  if ([emailHash, trainerNameHash].some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Lowercase SHA-256 lookup hashes are required')
  }
  // DO blocks do not accept bind parameters. Both interpolated values have a
  // strict hex-only grammar; no user text or arbitrary SQL can enter the block.
  return `do $fit_repair$
  declare
    actor uuid;
    client_row public.clients%rowtype;
    target uuid;
    counts_before jsonb;
    others_before jsonb;
    relations_before jsonb;
  begin
    select id into strict actor from auth.users
    where encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex') = '${emailHash}';
    select * into strict client_row from public.clients
    where auth_user_id = actor and archived_at is null and merged_into_client_id is null
    for update;
    if client_row.trainer_id is distinct from actor then
      raise exception 'repair_requires_self_owned_client';
    end if;
    select m.trainer_id into strict target
    from public.client_trainers m join public.profiles p on p.id = m.trainer_id
    where m.client_id = client_row.id
      and encode(extensions.digest(lower(btrim(p.first_name)), 'sha256'), 'hex') = '${trainerNameHash}'
    for update of m;
    if target = actor or exists (
      select 1 from public.client_trainer_relationships
      where client_id = client_row.id and trainer_id = target
    ) then
      raise exception 'repair_target_is_not_a_stale_membership';
    end if;
    counts_before := app_private.client_dependency_counts(client_row.id);
    select jsonb_agg(to_jsonb(m) order by m.trainer_id) into others_before
    from public.client_trainers m where m.client_id = client_row.id and m.trainer_id <> target;
    if others_before is null then raise exception 'repair_requires_remaining_trainer'; end if;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into relations_before
    from public.client_trainer_relationships r where r.client_id = client_row.id;

    -- The operator acts on the client's explicit request. Ownership and role
    -- validation still run inside the existing, deployed user-action RPC.
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
    perform public.remove_client_trainer(client_row.id, target);

    if exists(select 1 from public.client_trainers where client_id = client_row.id and trainer_id = target)
      or exists(select 1 from public.list_client_trainers(client_row.id) where trainer_id = target) then
      raise exception 'repair_did_not_remove_target';
    end if;
    if (select to_jsonb(c) from public.clients c where c.id = client_row.id) is distinct from to_jsonb(client_row)
      or app_private.client_dependency_counts(client_row.id) is distinct from counts_before
      or (select jsonb_agg(to_jsonb(m) order by m.trainer_id) from public.client_trainers m where m.client_id = client_row.id) is distinct from others_before
      or (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from public.client_trainer_relationships r where r.client_id = client_row.id) is distinct from relations_before then
      raise exception 'repair_preservation_check_failed';
    end if;
    perform set_config('request.jwt.claim.sub', target::text, true);
    if public.can_access_client(client_row.id) then raise exception 'repair_target_retained_access'; end if;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    if not public.can_access_client(client_row.id) then raise exception 'repair_client_lost_access'; end if;
  end;
  $fit_repair$;`
}

export async function repairStaleTrainer({ accessToken, projectId, emailHash, trainerNameHash, fetchImplementation = fetch }) {
  const query = buildStaleTrainerRepair({ emailHash, trainerNameHash })
  if (typeof projectId !== 'string' || !/^[a-z]{20}$/.test(projectId)) throw new Error('SUPABASE_PROJECT_ID is invalid')
  if (!accessToken?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetchImplementation(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, read_only: false }),
  })
  if (!response.ok) throw new Error(`Stale trainer repair failed with HTTP ${response.status}`)
  return { disconnected: true, other_trainers_preserved: true, client_data_preserved: true }
}
