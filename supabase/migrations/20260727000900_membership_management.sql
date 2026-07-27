create or replace function public.list_client_trainers(p_client_id uuid)
returns table (
  trainer_id uuid,
  first_name text,
  last_name text,
  joined_at timestamptz,
  is_root boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and (
        client.auth_user_id = auth.uid()
        or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id and membership.trainer_id = auth.uid()
        )
      )
  ) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  return query
  select membership.trainer_id, profile.first_name, profile.last_name,
    membership.joined_at, membership.trainer_id = client.trainer_id
  from public.client_trainers membership
  join public.clients client on client.id = membership.client_id
  join public.profiles profile on profile.id = membership.trainer_id
  where membership.client_id = p_client_id
  order by (membership.trainer_id = client.trainer_id) desc, membership.joined_at, membership.trainer_id;
end;
$$;

create or replace function public.remove_client_trainer(p_client_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = p_client_id and auth_user_id = auth.uid()
  ) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  if exists (
    select 1 from public.clients
    where id = p_client_id and trainer_id = p_trainer_id
  ) then
    raise exception 'root_trainer_cannot_be_removed' using errcode = 'PT422';
  end if;
  delete from public.client_trainers
  where client_id = p_client_id and trainer_id = p_trainer_id;
  if not found then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.leave_client_space(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.clients
    where id = p_client_id and trainer_id = auth.uid()
  ) then
    raise exception 'root_trainer_cannot_leave' using errcode = 'PT422';
  end if;
  delete from public.client_trainers
  where client_id = p_client_id and trainer_id = auth.uid();
  if not found then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.list_client_trainers(uuid) from public, anon;
revoke all on function public.remove_client_trainer(uuid, uuid) from public, anon;
revoke all on function public.leave_client_space(uuid) from public, anon;
grant execute on function public.list_client_trainers(uuid) to authenticated;
grant execute on function public.remove_client_trainer(uuid, uuid) to authenticated;
grant execute on function public.leave_client_space(uuid) to authenticated;
