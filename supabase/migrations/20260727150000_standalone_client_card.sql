-- `clients.trainer_id` is the legacy partition owner used by the existing aggregate
-- RPCs. A self-managed client owns that partition with their profile id, without
-- receiving a trainer role or a row in `trainers`.
alter table public.clients drop constraint clients_trainer_id_fkey;
alter table public.clients
  add constraint clients_partition_owner_fk
  foreign key (trainer_id) references public.profiles (id) on delete restrict;

create or replace function public.create_own_client(p_client jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := gen_random_uuid();
  full_name_value text := btrim(p_client->>'fullName');
  gender_value text := p_client->>'gender';
  age_value smallint := (p_client->>'ageYears')::smallint;
  age_updated_value date := coalesce(nullif(p_client->>'ageUpdatedAt', '')::date, current_date);
  height_value numeric := (p_client->>'heightCm')::numeric;
  goal_value text := nullif(btrim(p_client->>'goal'), '');
  note_value text := nullif(btrim(p_client->>'note'), '');
  weight_value numeric := nullif(p_client->>'initialWeightKg', '')::numeric;
  weight_date_value date := coalesce(
    nullif(p_client->>'initialWeightRecordedOn', '')::date,
    current_date
  );
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
  if exists (select 1 from public.clients where auth_user_id = actor_id) then
    raise exception 'client_card_already_exists' using errcode = 'PT409';
  end if;
  if full_name_value is null or full_name_value = ''
    or gender_value is null or gender_value not in ('male', 'female')
    or age_value is null or age_value not between 1 and 119
    or height_value is null or height_value <= 0 or height_value >= 260
    or weight_value is not null and weight_value <= 0
  then
    raise exception 'invalid_client_card' using errcode = 'PT422';
  end if;

  insert into public.clients (
    id, trainer_id, auth_user_id, full_name, gender, age_years,
    age_updated_at, height_cm, goal
  ) values (
    client_id_value, actor_id, actor_id, full_name_value, gender_value, age_value,
    age_updated_value, height_value, goal_value
  );

  insert into public.client_private_details (client_id, trainer_id, note)
  values (client_id_value, actor_id, note_value);

  if weight_value is not null then
    insert into public.client_progress (
      trainer_id, client_id, recorded_on, weight_kg, created_by
    ) values (
      actor_id, client_id_value, weight_date_value, weight_value, actor_id
    );
  end if;

  return client_id_value;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_client_card' using errcode = 'PT422';
end;
$$;

revoke all on function public.create_own_client(jsonb) from public, anon;
grant execute on function public.create_own_client(jsonb) to authenticated;
