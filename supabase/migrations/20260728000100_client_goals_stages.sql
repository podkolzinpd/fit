-- Периодизация (Заход 2, M1): цель как сущность + этапы (подцели).
-- Партиционирование по trainer_id (владелец партиции клиента) — как остальные
-- клиентские данные; мутации идут через RPC + authorize_client_mutation,
-- поэтому мультитренерский доступ и клиент-владелец работают единообразно.

create table public.client_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  trainer_id uuid not null,
  created_by uuid not null,
  title text not null,
  target_date date,
  status text not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint client_goals_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade,
  constraint client_goals_status_allowed check (status in ('active', 'archived')),
  constraint client_goals_title_len check (char_length(title) between 1 and 200),
  constraint client_goals_identity_unique unique (id, trainer_id, client_id)
);

-- Одна активная цель на клиента.
create unique index client_goals_one_active
  on public.client_goals (client_id) where status = 'active';
create index client_goals_client_idx on public.client_goals (client_id, status);

create table public.goal_stages (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  position smallint not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_stages_goal_fk foreign key (goal_id, trainer_id, client_id)
    references public.client_goals (id, trainer_id, client_id) on delete cascade,
  constraint goal_stages_title_len check (char_length(title) between 1 and 120),
  constraint goal_stages_period check (ends_on >= starts_on)
);
create index goal_stages_goal_idx on public.goal_stages (goal_id, position, starts_on);

alter table public.client_goals enable row level security;
alter table public.goal_stages enable row level security;

-- Чтение: тренер-владелец, подключённый тренер (membership) или клиент-владелец.
create policy "client_goals_read_accessible" on public.client_goals
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = client_goals.client_id
        and membership.trainer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.clients c
      where c.id = client_goals.client_id and c.auth_user_id = (select auth.uid())
    )
  );
create policy "goal_stages_read_accessible" on public.goal_stages
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.client_trainers membership
      where membership.client_id = goal_stages.client_id
        and membership.trainer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.clients c
      where c.id = goal_stages.client_id and c.auth_user_id = (select auth.uid())
    )
  );

-- Запись — только владельцу партиции (RPC переключает sub на root_trainer).
create policy "client_goals_write_owner" on public.client_goals
  for all to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));
create policy "goal_stages_write_owner" on public.goal_stages
  for all to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

-- Чтение цели + этапов одним вызовом.
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

-- Создать/обновить активную цель (title + target_date). Если цели нет — создаём.
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
begin
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  -- authorize_client_mutation возвращает actor_id для тренера без связи с
  -- клиентом (путь «тренер заводит своего клиента на лету»). Для цели это чужой
  -- клиент — явно отклоняем, если партиция root_trainer им не владеет.
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
    return goal_id_value;
  end if;

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
  return goal_id_value;
exception
  when invalid_text_representation then
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
  root_trainer := public.authorize_client_mutation(client_id_value, false);
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
  root_trainer uuid;
  title_value text := btrim(p_stage->>'title');
  starts_value date := (p_stage->>'startsOn')::date;
  ends_value date := (p_stage->>'endsOn')::date;
  position_value smallint := coalesce((p_stage->>'position')::smallint, 0);
  next_version bigint;
begin
  select client_id into client_id_value from public.client_goals where id = goal_id_value;
  if client_id_value is null then
    raise exception 'goal_not_found' using errcode = 'PT404';
  end if;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  if title_value is null or title_value = '' or char_length(title_value) > 120
    or starts_value is null or ends_value is null or ends_value < starts_value then
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
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  delete from public.goal_stages where id = p_stage_id and trainer_id = root_trainer;
end;
$$;

revoke all on function public.get_client_goal(uuid) from public, anon;
revoke all on function public.save_client_goal(jsonb, bigint) from public, anon;
revoke all on function public.archive_client_goal(uuid, bigint) from public, anon;
revoke all on function public.save_goal_stage(jsonb, bigint) from public, anon;
revoke all on function public.delete_goal_stage(uuid) from public, anon;
grant execute on function public.get_client_goal(uuid) to authenticated;
grant execute on function public.save_client_goal(jsonb, bigint) to authenticated;
grant execute on function public.archive_client_goal(uuid, bigint) to authenticated;
grant execute on function public.save_goal_stage(jsonb, bigint) to authenticated;
grant execute on function public.delete_goal_stage(uuid) to authenticated;
