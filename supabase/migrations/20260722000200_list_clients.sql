create index if not exists client_progress_latest_weight_idx
  on public.client_progress (client_id, recorded_on desc, created_at desc)
  where deleted_at is null and weight_kg is not null;

create or replace function public.list_clients(p_include_archived boolean default false)
returns table (
  id uuid,
  full_name text,
  gender text,
  age_years smallint,
  age_updated_at date,
  height_cm numeric,
  goal text,
  note text,
  current_weight_kg numeric,
  archived_at timestamptz,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'P0001';
  end if;

  return query
  select
    c.id,
    c.full_name,
    c.gender,
    c.age_years,
    c.age_updated_at,
    c.height_cm,
    c.goal,
    details.note,
    latest_weight.weight_kg,
    c.archived_at,
    c.version
  from public.clients c
  left join public.client_private_details details
    on details.client_id = c.id and details.trainer_id = c.trainer_id
  left join lateral (
    select progress.weight_kg
    from public.client_progress progress
    where progress.client_id = c.id
      and progress.trainer_id = c.trainer_id
      and progress.deleted_at is null
      and progress.weight_kg is not null
    order by progress.recorded_on desc, progress.created_at desc
    limit 1
  ) latest_weight on true
  where c.trainer_id = actor_id
    and (p_include_archived or c.archived_at is null)
  order by c.created_at desc;
end;
$$;

revoke all on function public.list_clients(boolean) from public, anon;
grant execute on function public.list_clients(boolean) to authenticated;
