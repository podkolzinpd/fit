-- Up Migration

grant usage on schema app_private to fit_api;

create table public.goal_criteria (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  metric text not null,
  operation text not null,
  target_value numeric(12, 3),
  range_min numeric(12, 3),
  range_max numeric(12, 3),
  unit text not null,
  confirmation_status text not null default 'suggested',
  confirmed_by uuid references public.profiles (id) on delete restrict,
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
create trigger set_updated_at before update on public.goal_criteria
  for each row execute function public.set_updated_at();

create policy goal_criteria_read_accessible on public.goal_criteria
  for select to fit_api using (public.can_access_client(client_id));
revoke all on public.goal_criteria from public;
grant select on public.goal_criteria to fit_api;

alter function public.get_client_progress_bundle(uuid)
  rename to get_client_progress_bundle_v1;
revoke execute on function public.get_client_progress_bundle_v1(uuid) from fit_api;

create or replace function public.get_client_progress_bundle(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare bundle jsonb;
declare goal_id_value uuid;
begin
  bundle := public.get_client_progress_bundle_v1(p_client_id);
  goal_id_value := nullif(bundle->'goal'->>'id', '')::uuid;
  if goal_id_value is not null then
    bundle := jsonb_set(bundle, '{goal,criteria}', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', criterion.id, 'goalId', criterion.goal_id,
        'metric', criterion.metric, 'operation', criterion.operation,
        'targetValue', criterion.target_value, 'rangeMin', criterion.range_min,
        'rangeMax', criterion.range_max, 'unit', criterion.unit,
        'confirmationStatus', criterion.confirmation_status,
        'position', criterion.position, 'version', criterion.version
      ) order by criterion.position, criterion.id)
      from public.goal_criteria criterion
      where criterion.goal_id = goal_id_value and criterion.archived_at is null
    ), '[]'::jsonb), true);
  end if;
  return bundle;
end;
$$;

alter function public.save_client_goal(jsonb, bigint)
  rename to save_client_goal_v1;
revoke execute on function public.save_client_goal_v1(jsonb, bigint) from fit_api;

alter table public.goal_criteria enable row level security;

create or replace function public.save_client_goal(
  p_goal jsonb, p_expected_version bigint default null
)
returns table (goal_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  prior_title text;
  result_goal_id uuid;
  result_version bigint;
  root_id uuid;
  client_id_value uuid;
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
  if nullif(p_goal->>'id', '') is not null then
    select stored.title into prior_title
    from public.client_goals stored
    where stored.id = (p_goal->>'id')::uuid;
  end if;

  select saved.goal_id, saved.version into result_goal_id, result_version
  from public.save_client_goal_v1(p_goal, p_expected_version) saved;

  select stored.trainer_id, stored.client_id into root_id, client_id_value
  from public.client_goals stored where stored.id = result_goal_id;

  if prior_title is distinct from btrim(p_goal->>'title')
    and not (
      p_goal ? 'criterion'
      and jsonb_typeof(p_goal->'criterion') = 'object'
    ) then
    update public.goal_criteria set
      confirmation_status = 'needs_review', confirmed_by = null,
      confirmed_at = null, version = public.goal_criteria.version + 1
    where public.goal_criteria.goal_id = result_goal_id and archived_at is null;
  end if;

  if p_goal ? 'criterion' then
    criterion := p_goal->'criterion';
    if criterion = 'null'::jsonb then
      update public.goal_criteria set archived_at = now(),
        version = public.goal_criteria.version + 1
      where public.goal_criteria.goal_id = result_goal_id and archived_at is null;
      return query select result_goal_id, result_version;
      return;
    end if;
    if jsonb_typeof(criterion) <> 'object' then
      raise exception 'goal_criterion_invalid' using errcode = 'PT422';
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
      raise exception 'goal_criterion_invalid' using errcode = 'PT422';
    end if;

    if criterion_id is null then
      insert into public.goal_criteria (
        goal_id, trainer_id, client_id, created_by, metric, operation,
        target_value, range_min, range_max, unit, confirmation_status,
        confirmed_by, confirmed_at, position
      ) values (
        result_goal_id, root_id, client_id_value, actor_id, metric_value,
        operation_value, criterion_target, criterion_min, criterion_max,
        unit_value, 'confirmed', actor_id, now(), position_value
      );
    else
      update public.goal_criteria stored set
        metric = metric_value, operation = operation_value,
        target_value = criterion_target, range_min = criterion_min,
        range_max = criterion_max, unit = unit_value,
        confirmation_status = 'confirmed', confirmed_by = actor_id,
        confirmed_at = now(), position = position_value,
        version = stored.version + 1
      where stored.id = criterion_id and stored.goal_id = result_goal_id
        and stored.archived_at is null and stored.version = criterion_version;
      if not found then
        raise exception 'goal_criterion_conflict' using errcode = 'PT409';
      end if;
    end if;
  end if;

  return query select result_goal_id, result_version;
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'goal_criterion_invalid' using errcode = 'PT422';
  when unique_violation then
    raise exception 'goal_criterion_conflict' using errcode = 'PT409';
end;
$$;

revoke all on function public.get_client_progress_bundle(uuid),
  public.save_client_goal(jsonb, bigint) from public;
grant execute on function public.get_client_progress_bundle(uuid),
  public.save_client_goal(jsonb, bigint) to fit_api;

-- Down Migration

revoke execute on function public.get_client_progress_bundle(uuid),
  public.save_client_goal(jsonb, bigint) from fit_api;
drop function public.get_client_progress_bundle(uuid);
drop function public.save_client_goal(jsonb, bigint);
alter function public.get_client_progress_bundle_v1(uuid)
  rename to get_client_progress_bundle;
alter function public.save_client_goal_v1(jsonb, bigint)
  rename to save_client_goal;
grant execute on function public.get_client_progress_bundle(uuid),
  public.save_client_goal(jsonb, bigint) to fit_api;
drop table public.goal_criteria;
