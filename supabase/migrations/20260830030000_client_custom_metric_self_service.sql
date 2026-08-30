-- Custom measurements belong to the client card, so both the client and every
-- trainer who can access that card may manage them. Keep the partition owner
-- stable and expose mutations through guarded RPCs instead of broader RLS.

drop policy if exists "metrics_insert_own" on public.client_custom_metrics;
create policy "metrics_insert_own" on public.client_custom_metrics
  for insert to authenticated with check (
    trainer_id = auth.uid()
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.account_role = 'trainer'
    )
    and exists (
      select 1 from public.clients client
      where client.id = public.client_custom_metrics.client_id
        and client.trainer_id = auth.uid() and client.archived_at is null
    )
  );

drop policy if exists "metrics_update_own" on public.client_custom_metrics;
create policy "metrics_update_own" on public.client_custom_metrics
  for update to authenticated using (
    trainer_id = auth.uid()
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.account_role = 'trainer'
    )
  ) with check (
    trainer_id = auth.uid()
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.account_role = 'trainer'
    )
  );

create or replace function public.create_client_custom_metric(
  p_client_id uuid,
  p_name text,
  p_unit text default null
)
returns public.client_custom_metrics
language plpgsql
security definer
set search_path = ''
as $$
declare
  root_trainer uuid;
  name_value text := btrim(p_name);
  unit_value text := nullif(btrim(p_unit), '');
  created public.client_custom_metrics;
begin
  root_trainer := public.authorize_client_mutation(p_client_id, true);
  if not exists (
    select 1 from public.clients client
    where client.id = p_client_id and client.trainer_id = root_trainer
  ) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  if name_value is null or name_value = '' or char_length(name_value) > 80
    or (unit_value is not null and char_length(unit_value) > 24) then
    raise exception 'invalid_custom_metric' using errcode = 'PT422';
  end if;

  insert into public.client_custom_metrics (trainer_id, client_id, name, unit)
  values (root_trainer, p_client_id, name_value, unit_value)
  returning * into created;
  return created;
exception
  when unique_violation then
    raise exception 'custom_metric_exists' using errcode = 'PT409';
end;
$$;

create or replace function public.set_client_custom_metric_archived(
  p_metric_id uuid,
  p_expected_version bigint,
  p_archived boolean
)
returns public.client_custom_metrics
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_id_value uuid;
  root_trainer uuid;
  changed public.client_custom_metrics;
begin
  select client_id into client_id_value
  from public.client_custom_metrics
  where id = p_metric_id;
  if client_id_value is null then
    raise exception 'custom_metric_not_found' using errcode = 'PT404';
  end if;

  root_trainer := public.authorize_client_mutation(client_id_value, true);
  if not exists (
    select 1 from public.clients client
    where client.id = client_id_value and client.trainer_id = root_trainer
  ) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  update public.client_custom_metrics set
    archived_at = case when p_archived then now() else null end,
    version = version + 1,
    updated_at = now()
  where id = p_metric_id and client_id = client_id_value
    and trainer_id = root_trainer and version = p_expected_version
  returning * into changed;
  if changed.id is null then
    raise exception 'custom_metric_conflict' using errcode = 'PT409';
  end if;
  return changed;
end;
$$;

revoke all on function public.create_client_custom_metric(uuid, text, text) from public, anon;
revoke all on function public.set_client_custom_metric_archived(uuid, bigint, boolean) from public, anon;
grant execute on function public.create_client_custom_metric(uuid, text, text) to authenticated;
grant execute on function public.set_client_custom_metric_archived(uuid, bigint, boolean) to authenticated;
