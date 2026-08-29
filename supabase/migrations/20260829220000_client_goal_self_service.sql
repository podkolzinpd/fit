-- A client owns the wording and structure of their goal. Goal mutations keep
-- using the client's existing partition owner, but authorization now accepts
-- the linked client account as well as an accessible trainer.

create or replace function public.save_client_goal(p_goal jsonb, p_expected_version bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_goal->>'clientId')::uuid;
  root_trainer uuid;
  title_value text := btrim(p_goal->>'title');
  target_value date := nullif(p_goal->>'targetDate', '')::date;
  goal_id_value uuid := nullif(p_goal->>'id', '')::uuid;
  next_version bigint;
  previous_title text;
  criterion jsonb;
  criterion_id uuid;
  criterion_version bigint;
  metric_value text;
  operation_value text;
  unit_value text;
  criterion_target numeric;
  criterion_min numeric;
  criterion_max numeric;
  position_value smallint;
begin
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  if not exists (
    select 1 from public.clients
    where id = client_id_value and trainer_id = root_trainer
  ) then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  if title_value is null or title_value = '' or char_length(title_value) > 200 then
    raise exception 'invalid_goal' using errcode = 'PT422';
  end if;

  if goal_id_value is null then
    insert into public.client_goals (client_id, trainer_id, created_by, title, target_date)
    values (client_id_value, root_trainer, actor_id, title_value, target_value)
    returning id into goal_id_value;
  else
    select goal.title into previous_title
    from public.client_goals goal
    where goal.id = goal_id_value and goal.client_id = client_id_value
      and goal.trainer_id = root_trainer and goal.status = 'active';

    update public.client_goals set
      title = title_value,
      target_date = target_value,
      version = version + 1,
      updated_at = now()
    where id = goal_id_value and client_id = client_id_value and trainer_id = root_trainer
      and status = 'active'
      and (p_expected_version is null or version = p_expected_version)
    returning version into next_version;
    if next_version is null then
      raise exception 'goal_conflict' using errcode = 'PT409';
    end if;

    if previous_title is distinct from title_value
      and not (
        p_goal ? 'criterion'
        and jsonb_typeof(p_goal->'criterion') = 'object'
      ) then
      update public.goal_criteria set
        confirmation_status = 'needs_review',
        confirmed_by = null,
        confirmed_at = null,
        version = version + 1,
        updated_at = now()
      where goal_id = goal_id_value and archived_at is null;
    end if;
  end if;

  if p_goal ? 'criterion' then
    criterion := p_goal->'criterion';
    if criterion = 'null'::jsonb then
      update public.goal_criteria set
        archived_at = now(),
        version = version + 1,
        updated_at = now()
      where goal_id = goal_id_value and archived_at is null;
      return goal_id_value;
    end if;
    if jsonb_typeof(criterion) <> 'object' then
      raise exception 'invalid_goal_criterion' using errcode = 'PT422';
    end if;

    criterion_id := nullif(criterion->>'id', '')::uuid;
    criterion_version := nullif(criterion->>'version', '')::bigint;
    metric_value := criterion->>'metric';
    operation_value := criterion->>'operation';
    unit_value := btrim(criterion->>'unit');
    criterion_target := nullif(criterion->>'targetValue', '')::numeric;
    criterion_min := nullif(criterion->>'rangeMin', '')::numeric;
    criterion_max := nullif(criterion->>'rangeMax', '')::numeric;
    position_value := coalesce(nullif(criterion->>'position', '')::smallint, 0);

    if metric_value not in ('weight', 'waist', 'chest', 'hips')
      or operation_value not in ('decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only')
      or (metric_value = 'weight' and unit_value <> 'кг')
      or (metric_value <> 'weight' and unit_value <> 'см')
      or position_value < 0
      or coalesce(criterion->>'confirmationStatus', '') <> 'confirmed'
      or (operation_value = 'track_only' and (criterion_target is not null or criterion_min is not null or criterion_max is not null))
      or (operation_value = 'maintain_range' and (
        criterion_target is not null or criterion_min is null or criterion_min <= 0
        or criterion_max is null or criterion_max < criterion_min
      ))
      or (operation_value in ('decrease_to', 'increase_to') and (
        criterion_target is null or criterion_target <= 0
        or criterion_min is not null or criterion_max is not null
      ))
      or (operation_value = 'change_by' and (
        criterion_target is null or criterion_target = 0
        or criterion_min is not null or criterion_max is not null
      )) then
      raise exception 'invalid_goal_criterion' using errcode = 'PT422';
    end if;

    if criterion_id is null then
      insert into public.goal_criteria (
        goal_id, trainer_id, client_id, created_by, metric, operation,
        target_value, range_min, range_max, unit, confirmation_status,
        confirmed_by, confirmed_at, position
      ) values (
        goal_id_value, root_trainer, client_id_value, actor_id, metric_value,
        operation_value, criterion_target, criterion_min, criterion_max,
        unit_value, 'confirmed', actor_id, now(), position_value
      );
    else
      if criterion_version is null then
        raise exception 'goal_criterion_conflict' using errcode = 'PT409';
      end if;
      update public.goal_criteria set
        metric = metric_value,
        operation = operation_value,
        target_value = criterion_target,
        range_min = criterion_min,
        range_max = criterion_max,
        unit = unit_value,
        confirmation_status = 'confirmed',
        confirmed_by = actor_id,
        confirmed_at = now(),
        position = position_value,
        version = version + 1,
        updated_at = now()
      where id = criterion_id and goal_id = goal_id_value and archived_at is null
        and version = criterion_version;
      if not found then
        raise exception 'goal_criterion_conflict' using errcode = 'PT409';
      end if;
    end if;
  end if;

  return goal_id_value;
exception
  when check_violation or invalid_text_representation then
    if p_goal ? 'criterion' then
      raise exception 'invalid_goal_criterion' using errcode = 'PT422';
    end if;
    raise exception 'invalid_goal' using errcode = 'PT422';
end;
$$;

create or replace function public.archive_client_goal(p_goal_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_id_value uuid;
  root_trainer uuid;
  updated bigint;
begin
  select client_id into client_id_value from public.client_goals where id = p_goal_id;
  if client_id_value is null then
    raise exception 'goal_not_found' using errcode = 'PT404';
  end if;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  update public.client_goals set
    status = 'archived', archived_at = now(), version = version + 1, updated_at = now()
  where id = p_goal_id and trainer_id = root_trainer and status = 'active'
    and version = p_expected_version
  returning version into updated;
  if updated is null then
    raise exception 'goal_conflict' using errcode = 'PT409';
  end if;
end;
$$;

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
  root_trainer := public.authorize_client_mutation(client_id_value, true);
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

create or replace function public.delete_goal_stage(p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_id_value uuid;
  root_trainer uuid;
begin
  select client_id into client_id_value from public.goal_stages where id = p_stage_id;
  if client_id_value is null then
    raise exception 'stage_not_found' using errcode = 'PT404';
  end if;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  delete from public.goal_stages where id = p_stage_id and trainer_id = root_trainer;
end;
$$;

revoke all on function public.save_client_goal(jsonb, bigint),
  public.archive_client_goal(uuid, bigint),
  public.save_goal_stage(jsonb, bigint), public.delete_goal_stage(uuid)
  from public, anon;
grant execute on function public.save_client_goal(jsonb, bigint),
  public.archive_client_goal(uuid, bigint),
  public.save_goal_stage(jsonb, bigint), public.delete_goal_stage(uuid)
  to authenticated;
