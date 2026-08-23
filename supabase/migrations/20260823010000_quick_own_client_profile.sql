-- Самостоятельный спортсмен может начать первую тренировку без длинной
-- анкеты. Карточка создаётся только по явному действию пользователя, чтобы
-- не занимать auth_user_id до возможного подключения по приглашению тренера.
create or replace function public.create_quick_own_client(p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_id uuid;
  created_id uuid := gen_random_uuid();
  full_name_value text := btrim(p_full_name);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = actor_id and account_role = 'client'
  ) then
    raise exception 'client_account_required' using errcode = 'PT403';
  end if;
  if char_length(full_name_value) < 2 then
    raise exception 'client_name_too_short' using errcode = '22023';
  end if;

  select id into existing_id
  from public.clients
  where auth_user_id = actor_id;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.clients (id, trainer_id, auth_user_id, full_name)
  values (created_id, actor_id, actor_id, full_name_value);

  insert into public.client_private_details (client_id, trainer_id)
  values (created_id, actor_id);

  return created_id;
end;
$$;

revoke all on function public.create_quick_own_client(text) from public, anon;
grant execute on function public.create_quick_own_client(text) to authenticated;
