-- Этап — путь К цели, поэтому не может заканчиваться позже даты достижения цели.
-- Добавляем в save_goal_stage проверку ends_on ≤ target_date (если дата цели задана).

create or replace function public.save_goal_stage(p_stage jsonb, p_expected_version bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal_id_value uuid := (p_stage->>'goalId')::uuid;
  stage_id_value uuid := nullif(p_stage->>'id', '')::uuid;
  client_id_value uuid;
  target_value date;
  root_trainer uuid;
  title_value text := btrim(p_stage->>'title');
  starts_value date := (p_stage->>'startsOn')::date;
  ends_value date := (p_stage->>'endsOn')::date;
  position_value smallint := coalesce((p_stage->>'position')::smallint, 0);
  next_version bigint;
begin
  select client_id, target_date into client_id_value, target_value
  from public.client_goals where id = goal_id_value;
  if client_id_value is null then
    raise exception 'goal_not_found' using errcode = 'PT404';
  end if;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  if title_value is null or title_value = '' or char_length(title_value) > 120
    or starts_value is null or ends_value is null or ends_value < starts_value
    or (target_value is not null and ends_value > target_value) then
    raise exception 'invalid_stage' using errcode = 'PT422';
  end if;

  if stage_id_value is null then
    insert into public.goal_stages (goal_id, trainer_id, client_id, title, starts_on, ends_on, position)
    values (goal_id_value, root_trainer, client_id_value, title_value, starts_value, ends_value, position_value)
    returning id into stage_id_value;
    return stage_id_value;
  end if;

  update public.goal_stages set
    title = title_value, starts_on = starts_value, ends_on = ends_value,
    position = position_value, version = version + 1, updated_at = now()
  where id = stage_id_value and goal_id = goal_id_value and trainer_id = root_trainer
    and (p_expected_version is null or version = p_expected_version)
  returning version into next_version;
  if next_version is null then
    raise exception 'stage_conflict' using errcode = 'PT409';
  end if;
  return stage_id_value;
exception
  when invalid_text_representation then
    raise exception 'invalid_stage' using errcode = 'PT422';
end;
$$;
