-- Progress 1.1: explicit, user-confirmed criteria for an active goal.
-- Existing goals intentionally receive no inferred rows.

create table public.goal_criteria (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid not null,
  metric text not null,
  operation text not null,
  target_value numeric(12, 3),
  range_min numeric(12, 3),
  range_max numeric(12, 3),
  unit text not null,
  confirmation_status text not null default 'suggested',
  confirmed_by uuid,
  confirmed_at timestamptz,
  position smallint not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint goal_criteria_goal_fk foreign key (goal_id, trainer_id, client_id)
    references public.client_goals (id, trainer_id, client_id)
    on update cascade on delete cascade,
  constraint goal_criteria_metric_allowed check (metric in ('weight', 'waist', 'chest', 'hips')),
  constraint goal_criteria_operation_allowed check (operation in (
    'decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only'
  )),
  constraint goal_criteria_confirmation_allowed check (
    confirmation_status in ('suggested', 'confirmed', 'needs_review')
  ),
  constraint goal_criteria_unit_length check (char_length(btrim(unit)) between 1 and 40),
  constraint goal_criteria_position_non_negative check (position >= 0),
  constraint goal_criteria_values_valid check (
    (operation = 'track_only' and target_value is null and range_min is null and range_max is null)
    or (operation = 'maintain_range' and target_value is null
      and range_min > 0 and range_max >= range_min)
    or (operation in ('decrease_to', 'increase_to')
      and target_value > 0 and range_min is null and range_max is null)
    or (operation = 'change_by'
      and target_value <> 0 and range_min is null and range_max is null)
  ),
  constraint goal_criteria_confirmation_consistent check (
    (confirmation_status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
    or (confirmation_status <> 'confirmed' and confirmed_at is null)
  ),
  constraint goal_criteria_identity_unique unique (id, trainer_id, client_id)
);

create unique index goal_criteria_active_position_uidx
  on public.goal_criteria (goal_id, position) where archived_at is null;
create index goal_criteria_goal_idx
  on public.goal_criteria (goal_id, archived_at, position, id);

alter table public.goal_criteria enable row level security;

create policy "goal_criteria_read_accessible" on public.goal_criteria
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = goal_criteria.client_id
        and membership.trainer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.clients client
      where client.id = goal_criteria.client_id
        and client.auth_user_id = (select auth.uid())
    )
  );

create policy "goal_criteria_write_owner" on public.goal_criteria
  for all to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

grant select on public.goal_criteria to authenticated;

create or replace function public.get_client_goal(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when goal.id is null then null else jsonb_build_object(
    'id', goal.id,
    'clientId', goal.client_id,
    'title', goal.title,
    'targetDate', goal.target_date,
    'status', goal.status,
    'version', goal.version,
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', stage.id,
        'goalId', stage.goal_id,
        'title', stage.title,
        'startsOn', stage.starts_on,
        'endsOn', stage.ends_on,
        'position', stage.position,
        'version', stage.version
      ) order by stage.position, stage.starts_on)
      from public.goal_stages stage where stage.goal_id = goal.id
    ), '[]'::jsonb),
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', criterion.id,
        'goalId', criterion.goal_id,
        'metric', criterion.metric,
        'operation', criterion.operation,
        'targetValue', criterion.target_value,
        'rangeMin', criterion.range_min,
        'rangeMax', criterion.range_max,
        'unit', criterion.unit,
        'confirmationStatus', criterion.confirmation_status,
        'position', criterion.position,
        'version', criterion.version
      ) order by criterion.position, criterion.id)
      from public.goal_criteria criterion
      where criterion.goal_id = goal.id and criterion.archived_at is null
    ), '[]'::jsonb)
  ) end
  from public.clients client
  left join public.client_goals goal
    on goal.client_id = client.id and goal.status = 'active'
  where client.id = p_client_id
    and (
      client.trainer_id = auth.uid()
      or client.auth_user_id = auth.uid()
      or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = client.id and membership.trainer_id = auth.uid()
      )
    );
$$;

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
  root_trainer := public.authorize_client_mutation(client_id_value, false);
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

revoke all on table public.goal_criteria from public, anon;
revoke all on function public.get_client_goal(uuid) from public, anon;
revoke all on function public.save_client_goal(jsonb, bigint) from public, anon;
grant execute on function public.get_client_goal(uuid) to authenticated;
grant execute on function public.save_client_goal(jsonb, bigint) to authenticated;
