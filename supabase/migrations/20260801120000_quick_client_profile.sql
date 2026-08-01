-- Быстрый старт тренера: для первой записи тренировки достаточно имени.
-- Медицинские/антропометрические данные не подставляем фиктивно: их можно
-- дополнить позднее из карточки клиента.
alter table public.clients
  alter column gender drop not null,
  alter column age_years drop not null,
  alter column age_updated_at drop not null,
  alter column height_cm drop not null;

create or replace function public.create_quick_client(p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_id uuid;
  full_name_value text := btrim(p_full_name);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'PT422';
  end if;
  if char_length(full_name_value) < 2 then
    raise exception 'client_name_too_short' using errcode = '22023';
  end if;

  insert into public.clients (trainer_id, full_name)
  values (actor_id, full_name_value)
  returning id into created_id;

  insert into public.client_private_details (client_id, trainer_id)
  values (created_id, actor_id);

  insert into public.client_trainers (client_id, trainer_id, alias)
  values (created_id, actor_id, full_name_value);

  return created_id;
end;
$$;

revoke all on function public.create_quick_client(text) from public, anon;
grant execute on function public.create_quick_client(text) to authenticated;
