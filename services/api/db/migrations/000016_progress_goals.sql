-- Up Migration

create table public.client_progress (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  recorded_on date not null,
  weight_kg numeric(7, 2),
  chest_cm numeric(7, 2),
  waist_cm numeric(7, 2),
  hip_cm numeric(7, 2),
  notes text,
  deleted_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_progress_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete restrict,
  constraint client_progress_values_positive check (
    (weight_kg is null or weight_kg > 0)
    and (chest_cm is null or chest_cm > 0)
    and (waist_cm is null or waist_cm > 0)
    and (hip_cm is null or hip_cm > 0)
  ),
  constraint client_progress_identity_unique unique (id, trainer_id, client_id)
);

create table public.client_custom_metrics (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  unit text,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_metrics_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete restrict,
  constraint client_metrics_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint client_metrics_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 40),
  constraint client_metrics_identity_unique unique (id, trainer_id, client_id)
);

create table public.client_progress_custom (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  progress_id uuid not null,
  metric_id uuid not null,
  value numeric(12, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_custom_progress_fk foreign key (progress_id, trainer_id, client_id)
    references public.client_progress (id, trainer_id, client_id) on delete cascade,
  constraint progress_custom_metric_fk foreign key (metric_id, trainer_id, client_id)
    references public.client_custom_metrics (id, trainer_id, client_id) on delete restrict,
  constraint progress_custom_unique unique (progress_id, metric_id)
);

create table public.client_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  trainer_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
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
  constraint client_goals_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint client_goals_identity_unique unique (id, trainer_id, client_id)
);

create table public.goal_stages (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  position smallint not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_stages_goal_fk foreign key (goal_id, trainer_id, client_id)
    references public.client_goals (id, trainer_id, client_id) on delete cascade,
  constraint goal_stages_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint goal_stages_period_valid check (ends_on >= starts_on),
  constraint goal_stages_position_non_negative check (position >= 0)
);

create unique index client_progress_active_date_uidx
  on public.client_progress (client_id, recorded_on) where deleted_at is null;
create index client_progress_client_date_idx
  on public.client_progress (client_id, recorded_on desc, id desc);
create unique index client_metrics_active_name_uidx
  on public.client_custom_metrics (client_id, lower(btrim(name))) where archived_at is null;
create index progress_custom_client_idx
  on public.client_progress_custom (client_id, progress_id);
create unique index client_goals_one_active_uidx
  on public.client_goals (client_id) where status = 'active';
create index goal_stages_goal_idx
  on public.goal_stages (goal_id, position, starts_on, id);
create index if not exists workout_exercises_client_ref_workout_idx
  on public.workout_exercises (client_id, exercise_ref, workout_id);
create index if not exists workouts_completed_client_cursor_idx
  on public.workouts (client_id, completed_at desc, id desc)
  where status = 'done' and deleted_at is null;

create trigger set_updated_at before update on public.client_progress
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_custom_metrics
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_progress_custom
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_goals
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.goal_stages
  for each row execute function public.set_updated_at();

alter table public.client_progress enable row level security;
alter table public.client_custom_metrics enable row level security;
alter table public.client_progress_custom enable row level security;
alter table public.client_goals enable row level security;
alter table public.goal_stages enable row level security;

create policy client_progress_read_accessible on public.client_progress
  for select to fit_api using (public.can_access_client(client_id));
create policy client_metrics_read_accessible on public.client_custom_metrics
  for select to fit_api using (public.can_access_client(client_id));
create policy progress_custom_read_accessible on public.client_progress_custom
  for select to fit_api using (public.can_access_client(client_id));
create policy client_goals_read_accessible on public.client_goals
  for select to fit_api using (public.can_access_client(client_id));
create policy goal_stages_read_accessible on public.goal_stages
  for select to fit_api using (public.can_access_client(client_id));

revoke all on public.client_progress, public.client_custom_metrics,
  public.client_progress_custom, public.client_goals, public.goal_stages from public;
grant select on public.client_progress, public.client_custom_metrics,
  public.client_progress_custom, public.client_goals, public.goal_stages to fit_api;

create or replace function app_private.progress_partition(p_client_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  root_id uuid;
begin
  select client.trainer_id into root_id
  from public.clients client
  where client.id = p_client_id and client.archived_at is null;
  if root_id is null or not public.can_access_client(p_client_id) then
    raise exception 'progress_forbidden' using errcode = 'PT403';
  end if;
  return root_id;
end;
$$;

revoke all on function app_private.progress_partition(uuid) from public;

create or replace function app_private.client_today(p_client_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare client_timezone text;
begin
  select coalesce(client_profile.timezone, trainer_profile.timezone, 'Europe/Moscow')
    into client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id;
  if not exists (select 1 from pg_catalog.pg_timezone_names zone
    where zone.name = client_timezone) then client_timezone := 'Europe/Moscow'; end if;
  return (now() at time zone client_timezone)::date;
end;
$$;

revoke all on function app_private.client_today(uuid) from public;

create or replace function public.get_client_progress_bundle(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'id', progress.id, 'clientId', progress.client_id,
      'createdBy', progress.created_by, 'recordedOn', progress.recorded_on,
      'weightKg', progress.weight_kg, 'chestCm', progress.chest_cm,
      'waistCm', progress.waist_cm, 'hipCm', progress.hip_cm,
      'notes', progress.notes, 'version', progress.version,
      'customMetrics', coalesce((select jsonb_agg(jsonb_build_object(
        'metricId', custom.metric_id, 'value', custom.value
      ) order by custom.metric_id) from public.client_progress_custom custom
        where custom.progress_id = progress.id), '[]'::jsonb)
    ) order by progress.recorded_on desc, progress.id desc)
      from public.client_progress progress
      where progress.client_id = p_client_id and progress.deleted_at is null), '[]'::jsonb),
    'customMetrics', coalesce((select jsonb_agg(jsonb_build_object(
      'id', metric.id, 'clientId', metric.client_id, 'createdBy', metric.created_by,
      'name', metric.name, 'unit', metric.unit, 'archivedAt', metric.archived_at,
      'version', metric.version
    ) order by metric.archived_at nulls first, lower(metric.name), metric.id)
      from public.client_custom_metrics metric where metric.client_id = p_client_id), '[]'::jsonb),
    'goal', (select jsonb_build_object(
      'id', goal.id, 'clientId', goal.client_id, 'createdBy', goal.created_by,
      'title', goal.title, 'targetDate', goal.target_date, 'status', goal.status,
      'version', goal.version,
      'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', stage.id, 'goalId', stage.goal_id, 'createdBy', stage.created_by,
        'title', stage.title, 'startsOn', stage.starts_on, 'endsOn', stage.ends_on,
        'position', stage.position, 'version', stage.version
      ) order by stage.position, stage.starts_on, stage.id)
        from public.goal_stages stage where stage.goal_id = goal.id), '[]'::jsonb)
    ) from public.client_goals goal
      where goal.client_id = p_client_id and goal.status = 'active')
  );
end;
$$;

create or replace function public.save_client_progress(
  p_progress jsonb,
  p_expected_version bigint default null
)
returns table (progress_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_progress->>'clientId')::uuid;
  progress_id_value uuid := nullif(p_progress->>'id', '')::uuid;
  root_id uuid;
  metric jsonb;
  next_version bigint;
begin
  root_id := app_private.progress_partition(client_id_value);
  if nullif(p_progress->>'recordedOn', '')::date is null
    or (p_progress->>'recordedOn')::date > app_private.client_today(client_id_value) then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  if progress_id_value is null then
    insert into public.client_progress (
      trainer_id, client_id, created_by, recorded_on, weight_kg,
      chest_cm, waist_cm, hip_cm, notes
    ) values (
      root_id, client_id_value, actor_id, (p_progress->>'recordedOn')::date,
      nullif(p_progress->>'weightKg', '')::numeric,
      nullif(p_progress->>'chestCm', '')::numeric,
      nullif(p_progress->>'waistCm', '')::numeric,
      nullif(p_progress->>'hipCm', '')::numeric,
      nullif(btrim(p_progress->>'notes'), '')
    ) returning id, public.client_progress.version
      into progress_id_value, next_version;
  else
    update public.client_progress progress set
      recorded_on = (p_progress->>'recordedOn')::date,
      weight_kg = nullif(p_progress->>'weightKg', '')::numeric,
      chest_cm = nullif(p_progress->>'chestCm', '')::numeric,
      waist_cm = nullif(p_progress->>'waistCm', '')::numeric,
      hip_cm = nullif(p_progress->>'hipCm', '')::numeric,
      notes = nullif(btrim(p_progress->>'notes'), ''),
      version = progress.version + 1
    where progress.id = progress_id_value
      and progress.client_id = client_id_value
      and progress.created_by = actor_id
      and progress.deleted_at is null
      and progress.version = p_expected_version
    returning progress.version into next_version;
    if next_version is null then
      if exists (select 1 from public.client_progress progress
        where progress.id = progress_id_value and progress.client_id = client_id_value
          and progress.created_by <> actor_id) then
        raise exception 'progress_forbidden' using errcode = 'PT403';
      end if;
      raise exception 'progress_conflict' using errcode = 'PT409';
    end if;
    delete from public.client_progress_custom custom
      where custom.progress_id = progress_id_value;
  end if;

  for metric in select value from jsonb_array_elements(
    coalesce(p_progress->'customMetrics', '[]'::jsonb)
  ) loop
    if not exists (select 1 from public.client_custom_metrics custom_metric
      where custom_metric.id = (metric->>'metricId')::uuid
        and custom_metric.client_id = client_id_value
        and custom_metric.archived_at is null) then
      raise exception 'progress_metric_not_found' using errcode = 'PT404';
    end if;
    insert into public.client_progress_custom (
      trainer_id, client_id, progress_id, metric_id, value
    ) values (
      root_id, client_id_value, progress_id_value,
      (metric->>'metricId')::uuid, (metric->>'value')::numeric
    );
  end loop;
  return query select progress_id_value, next_version;
exception
  when unique_violation then
    raise exception 'progress_conflict' using errcode = 'PT409';
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'progress_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.delete_client_progress(
  p_progress_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.client_progress progress set
    deleted_at = now(), version = progress.version + 1
  where progress.id = p_progress_id
    and progress.created_by = auth.uid()
    and progress.deleted_at is null
    and progress.version = p_expected_version
  returning progress.version into next_version;
  if next_version is null then
    if exists (select 1 from public.client_progress progress
      where progress.id = p_progress_id and progress.created_by <> auth.uid()) then
      raise exception 'progress_forbidden' using errcode = 'PT403';
    end if;
    raise exception 'progress_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.save_client_metric(
  p_metric jsonb,
  p_expected_version bigint default null
)
returns table (metric_id uuid, archived_at timestamptz, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_metric->>'clientId')::uuid;
  metric_id_value uuid := nullif(p_metric->>'id', '')::uuid;
  root_id uuid;
begin
  root_id := app_private.progress_partition(client_id_value);
  if not exists (select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'trainer') then
    raise exception 'metric_forbidden' using errcode = 'PT403';
  end if;
  if metric_id_value is null then
    return query insert into public.client_custom_metrics (
      trainer_id, client_id, created_by, name, unit
    ) values (
      root_id, client_id_value, actor_id, btrim(p_metric->>'name'),
      nullif(btrim(p_metric->>'unit'), '')
    ) returning id, public.client_custom_metrics.archived_at,
      public.client_custom_metrics.version;
    return;
  end if;
  return query update public.client_custom_metrics metric set
    name = btrim(p_metric->>'name'), unit = nullif(btrim(p_metric->>'unit'), ''),
    version = metric.version + 1
  where metric.id = metric_id_value and metric.client_id = client_id_value
    and metric.created_by = actor_id and metric.version = p_expected_version
  returning metric.id, metric.archived_at, metric.version;
  if not found then
    if exists (select 1 from public.client_custom_metrics metric
      where metric.id = metric_id_value and metric.created_by <> actor_id) then
      raise exception 'metric_forbidden' using errcode = 'PT403';
    end if;
    raise exception 'metric_conflict' using errcode = 'PT409';
  end if;
exception
  when unique_violation then raise exception 'metric_conflict' using errcode = 'PT409';
  when check_violation or invalid_text_representation then
    raise exception 'metric_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.set_client_metric_archived(
  p_metric_id uuid, p_archived boolean, p_expected_version bigint
)
returns table (metric_id uuid, archived_at timestamptz, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.account_role = 'trainer') then
    raise exception 'metric_forbidden' using errcode = 'PT403';
  end if;
  return query update public.client_custom_metrics metric set
    archived_at = case when p_archived then now() else null end,
    version = metric.version + 1
  where metric.id = p_metric_id and metric.created_by = auth.uid()
    and metric.version = p_expected_version
  returning metric.id, metric.archived_at, metric.version;
  if not found then
    if exists (select 1 from public.client_custom_metrics metric
      where metric.id = p_metric_id and metric.created_by <> auth.uid()) then
      raise exception 'metric_forbidden' using errcode = 'PT403';
    end if;
    raise exception 'metric_conflict' using errcode = 'PT409';
  end if;
exception when unique_violation then
  raise exception 'metric_conflict' using errcode = 'PT409';
end;
$$;

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
  client_id_value uuid := (p_goal->>'clientId')::uuid;
  goal_id_value uuid := nullif(p_goal->>'id', '')::uuid;
  root_id uuid;
begin
  root_id := app_private.progress_partition(client_id_value);
  if goal_id_value is null then
    return query insert into public.client_goals (
      client_id, trainer_id, created_by, title, target_date
    ) values (
      client_id_value, root_id, actor_id, btrim(p_goal->>'title'),
      nullif(p_goal->>'targetDate', '')::date
    ) returning id, public.client_goals.version;
    return;
  end if;
  return query update public.client_goals goal set
    title = btrim(p_goal->>'title'),
    target_date = nullif(p_goal->>'targetDate', '')::date,
    version = goal.version + 1
  where goal.id = goal_id_value and goal.client_id = client_id_value
    and public.can_access_client(goal.client_id)
    and goal.status = 'active' and goal.version = p_expected_version
  returning goal.id, goal.version;
  if not found then raise exception 'goal_conflict' using errcode = 'PT409'; end if;
exception
  when unique_violation then raise exception 'goal_conflict' using errcode = 'PT409';
  when check_violation or invalid_text_representation then
    raise exception 'goal_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.archive_client_goal(
  p_goal_id uuid, p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.client_goals goal set status = 'archived', archived_at = now(),
    version = goal.version + 1
  where goal.id = p_goal_id and public.can_access_client(goal.client_id)
    and goal.status = 'active' and goal.version = p_expected_version
  returning goal.version into next_version;
  if next_version is null then raise exception 'goal_conflict' using errcode = 'PT409'; end if;
  return next_version;
end;
$$;

create or replace function public.save_goal_stage(
  p_stage jsonb, p_expected_version bigint default null
)
returns table (stage_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  goal_id_value uuid := (p_stage->>'goalId')::uuid;
  stage_id_value uuid := nullif(p_stage->>'id', '')::uuid;
  goal_row public.client_goals%rowtype;
begin
  select goal.* into goal_row from public.client_goals goal
  where goal.id = goal_id_value and goal.status = 'active';
  if goal_row.id is null or not public.can_access_client(goal_row.client_id) then
    raise exception 'goal_forbidden' using errcode = 'PT403';
  end if;
  if (p_stage->>'endsOn')::date < (p_stage->>'startsOn')::date
    or (goal_row.target_date is not null
      and (p_stage->>'endsOn')::date > goal_row.target_date) then
    raise exception 'stage_invalid' using errcode = 'PT422';
  end if;
  if stage_id_value is null then
    return query insert into public.goal_stages (
      goal_id, trainer_id, client_id, created_by, title, starts_on, ends_on, position
    ) values (
      goal_row.id, goal_row.trainer_id, goal_row.client_id, actor_id,
      btrim(p_stage->>'title'), (p_stage->>'startsOn')::date,
      (p_stage->>'endsOn')::date, coalesce((p_stage->>'position')::smallint, 0)
    ) returning id, public.goal_stages.version;
    return;
  end if;
  return query update public.goal_stages stage set
    title = btrim(p_stage->>'title'), starts_on = (p_stage->>'startsOn')::date,
    ends_on = (p_stage->>'endsOn')::date,
    position = coalesce((p_stage->>'position')::smallint, 0),
    version = stage.version + 1
  where stage.id = stage_id_value and stage.goal_id = goal_id_value
    and stage.version = p_expected_version
  returning stage.id, stage.version;
  if not found then raise exception 'stage_conflict' using errcode = 'PT409'; end if;
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'stage_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.delete_goal_stage(
  p_stage_id uuid, p_expected_version bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.goal_stages stage
  where stage.id = p_stage_id and public.can_access_client(stage.client_id)
    and stage.version = p_expected_version;
  if not found then raise exception 'stage_conflict' using errcode = 'PT409'; end if;
end;
$$;

create or replace function public.list_running_progress(
  p_client_id uuid, p_period_start date, p_period_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  return coalesce((with confirmed as (
    select workout.id, workout.workout_date, workout.session_rpe,
      exercise.exercise_name, exercise.block_preset,
      workout_set.fact_distance_km,
      coalesce(workout_set.fact_duration_sec,
        round(workout_set.fact_duration_min * 60)::integer) as duration_sec,
      workout_set.fact_rpe
    from public.workouts workout
    join public.workout_exercises exercise on exercise.workout_id = workout.id
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id and workout.status = 'done'
      and workout.deleted_at is null
      and workout.workout_date between p_period_start and p_period_end
      and exercise.exercise_ref = 'running'
  ), normalized as (
    select confirmed.*,
      case
        when block_preset = 'interval' and lower(exercise_name) like '%восстанов%'
          then 'interval_active'
        when block_preset = 'interval' then 'interval'
        when lower(exercise_name) like 'лёгк%' or lower(exercise_name) like 'легк%' then 'easy'
        when lower(exercise_name) like 'длительн%' then 'long'
        when lower(exercise_name) like 'темпов%' then 'tempo'
        when lower(exercise_name) like 'восстановительн%' then 'recovery'
        else 'free'
      end format_key
    from confirmed
  ), sessions as (
    select id, workout_date,
      case when bool_or(format_key = 'interval_active') then 'interval_active'
        when bool_or(format_key = 'interval') then 'interval'
        when count(distinct format_key) = 1 then min(format_key) else 'mixed' end as format,
      sum(fact_distance_km) filter (where fact_distance_km is not null) as distance_km,
      sum(duration_sec) filter (where duration_sec is not null)::integer as duration_sec,
      coalesce(round(avg(fact_rpe) filter (where fact_rpe is not null), 1),
        max(session_rpe)::numeric) as rpe
    from normalized group by id, workout_date
  ) select jsonb_agg(jsonb_build_object(
    'workoutId', id, 'workoutDate', workout_date, 'format', format,
    'distanceKm', distance_km, 'durationSec', duration_sec,
    'paceSecPerKm', case when distance_km > 0 and duration_sec > 0
      then round(duration_sec / distance_km, 1) else null end,
    'rpe', rpe
  ) order by workout_date, id) from sessions), '[]'::jsonb);
end;
$$;

create or replace function public.get_workout_regularity(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  client_timezone text;
  today_value date;
begin
  perform app_private.progress_partition(p_client_id);
  select coalesce(client_profile.timezone, trainer_profile.timezone, 'Europe/Moscow')
    into client_timezone
  from public.clients client
  left join public.profiles client_profile on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile on trainer_profile.id = client.trainer_id
  where client.id = p_client_id;
  if not exists (select 1 from pg_catalog.pg_timezone_names zone
    where zone.name = client_timezone) then client_timezone := 'Europe/Moscow'; end if;
  today_value := (now() at time zone client_timezone)::date;
  return (with periods as (
    select 'week'::text period, today_value - (extract(isodow from today_value)::integer - 1) start_on
    union all select 'month', date_trunc('month', today_value)::date
  ), normalized as (
    select period, start_on,
      case when period = 'week' then start_on + 6
        else (start_on + interval '1 month - 1 day')::date end end_on
    from periods
  ) select jsonb_agg(jsonb_build_object(
    'period', period, 'periodStart', start_on, 'periodEnd', end_on,
    'plannedCount', planned_count, 'completedCount', completed_count,
    'completedPlannedCount', completed_planned_count, 'partialCount', partial_count,
    'skippedCount', skipped_count,
    'completionPercent', case when planned_count = 0 then null
      else round(completed_planned_count * 100.0 / planned_count)::integer end
  ) order by case period when 'week' then 1 else 2 end)
  from normalized cross join lateral (
    select
      count(*) filter (where workout.created_by is distinct from client.auth_user_id)::integer planned_count,
      count(*) filter (where workout.status = 'done')::integer completed_count,
      count(*) filter (where workout.status = 'done'
        and workout.created_by is distinct from client.auth_user_id)::integer completed_planned_count,
      count(*) filter (where workout.status = 'done' and facts.total_sets > 0
        and facts.confirmed_sets between 1 and facts.total_sets - 1)::integer partial_count,
      count(*) filter (where workout.created_by is distinct from client.auth_user_id
        and (workout.status = 'cancelled'
          or (workout.status = 'planned' and workout.workout_date < today_value)))::integer skipped_count
    from public.clients client
    join public.workouts workout on workout.client_id = client.id
      and workout.deleted_at is null and workout.workout_date between start_on and end_on
    left join lateral (select count(*)::integer total_sets,
      count(*) filter (where workout_set.confirmed_at is not null)::integer confirmed_sets
      from public.workout_exercises exercise
      join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      where exercise.workout_id = workout.id) facts on true
    where client.id = p_client_id
  ) counts);
end;
$$;

create or replace function public.list_exercise_progress(
  p_client_id uuid, p_exercise_ref text, p_limit integer default 20,
  p_before_completed_at timestamptz default null, p_before_workout_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  if nullif(btrim(p_exercise_ref), '') is null or p_limit < 1 or p_limit > 50
    or ((p_before_completed_at is null) is distinct from (p_before_workout_id is null)) then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  return (with aggregated as (
    select workout.id, workout.workout_date, workout.completed_at,
      min(exercise.exercise_name) exercise_name, min(exercise.input_kind) input_kind,
      count(workout_set.id)::integer confirmed_set_count,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) best_weight_kg,
      (array_agg(workout_set.fact_reps
        order by workout_set.fact_weight_kg desc nulls last,
          workout_set.fact_reps desc nulls last,
          exercise.position, workout_set.position)
        filter (where exercise.input_kind = 'strength'
          and workout_set.fact_weight_kg is not null))[1] reps_at_best_weight,
      max(workout_set.fact_weight_kg * workout_set.fact_reps) best_weight_reps,
      nullif(string_agg(distinct nullif(btrim(exercise.trainer_comment), ''), E'\n'), '') trainer_comment,
      jsonb_agg(jsonb_build_object('weightKg', workout_set.fact_weight_kg,
        'reps', workout_set.fact_reps,
        'durationSec', coalesce(workout_set.fact_duration_sec,
          round(workout_set.fact_duration_min * 60)::integer),
        'distanceKm', workout_set.fact_distance_km, 'rpe', workout_set.fact_rpe)
        order by exercise.position, workout_set.position) sets
    from public.workouts workout
    join public.workout_exercises exercise on exercise.workout_id = workout.id
      and exercise.exercise_ref = p_exercise_ref
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    where workout.client_id = p_client_id and workout.status = 'done'
      and workout.deleted_at is null
    group by workout.id, workout.workout_date, workout.completed_at
  ), compared as (
    select aggregated.*,
      lag(primary_value) over ordered previous_primary_value,
      max(primary_value) over prior prior_primary_best,
      max(best_weight_kg) over prior prior_weight_best,
      max(best_weight_reps) over prior prior_weight_reps_best,
      max(primary_value) over () all_time_primary_value,
      max(best_weight_kg) over () all_time_best_weight_kg,
      max(best_weight_reps) over () all_time_best_weight_reps,
      count(*) over () total_count
    from aggregated window
      ordered as (order by completed_at, id),
      prior as (order by completed_at, id rows between unbounded preceding and 1 preceding)
  ), page as (select * from compared
    where p_before_completed_at is null
      or (completed_at, id) < (p_before_completed_at, p_before_workout_id)
    order by completed_at desc, id desc limit p_limit + 1
  ) select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'workoutId', id, 'workoutDate', workout_date, 'completedAt', completed_at,
      'exerciseName', exercise_name, 'inputKind', input_kind,
      'confirmedSetCount', confirmed_set_count, 'primaryValue', primary_value,
      'previousPrimaryValue', previous_primary_value,
      'primaryChange', primary_value - previous_primary_value,
      'allTimePrimaryValue', all_time_primary_value,
      'bestWeightKg', best_weight_kg, 'bestWeightReps', best_weight_reps,
      'repsAtBestWeight', reps_at_best_weight, 'trainerComment', trainer_comment,
      'allTimeBestWeightKg', all_time_best_weight_kg,
      'allTimeBestWeightReps', all_time_best_weight_reps,
      'isPrimaryPr', primary_value is not null and (prior_primary_best is null or primary_value > prior_primary_best),
      'isWeightPr', best_weight_kg is not null and (prior_weight_best is null or best_weight_kg > prior_weight_best),
      'isWeightRepsPr', best_weight_reps is not null and (prior_weight_reps_best is null or best_weight_reps > prior_weight_reps_best),
      'sets', sets
    ) order by completed_at desc, id desc) filter (where row_number <= p_limit), '[]'::jsonb),
    'nextCursor', case when max(page_count) > p_limit then
      (jsonb_agg(jsonb_build_object('completedAt', completed_at, 'workoutId', id)
        order by row_number) filter (where row_number = p_limit))->0
      else null end,
    'totalCount', coalesce(max(total_count), 0)
  ) from (select page.*,
      row_number() over (order by completed_at desc, id desc) row_number,
      count(*) over () page_count from page) numbered);
end;
$$;

create or replace function app_private.workout_has_personal_record(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select workout.id, workout.client_id, workout.completed_at
    from public.workouts workout
    where workout.id = p_workout_id and workout.status = 'done'
      and workout.deleted_at is null
  ), current_results as (
    select exercise.exercise_ref, exercise.input_kind,
      max(case exercise.input_kind when 'strength' then workout_set.fact_weight_kg
        when 'reps' then workout_set.fact_reps::numeric
        when 'duration' then coalesce(workout_set.fact_duration_sec::numeric,
          round(workout_set.fact_duration_min * 60))
        when 'distance' then workout_set.fact_distance_km end) primary_value,
      max(workout_set.fact_weight_kg) filter (where exercise.input_kind = 'strength') best_weight_kg,
      max(workout_set.fact_weight_kg * workout_set.fact_reps)
        filter (where exercise.input_kind = 'strength') best_weight_reps
    from target
    join public.workout_exercises exercise on exercise.workout_id = target.id
    join public.workout_sets workout_set on workout_set.workout_exercise_id = exercise.id
      and workout_set.confirmed_at is not null
    group by exercise.exercise_ref, exercise.input_kind
  ), prior_results as (
    select current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps,
      max(case prior_exercise.input_kind when 'strength' then prior_set.fact_weight_kg
        when 'reps' then prior_set.fact_reps::numeric
        when 'duration' then coalesce(prior_set.fact_duration_sec::numeric,
          round(prior_set.fact_duration_min * 60))
        when 'distance' then prior_set.fact_distance_km end) prior_primary_value,
      max(prior_set.fact_weight_kg) filter (where prior_exercise.input_kind = 'strength') prior_weight_kg,
      max(prior_set.fact_weight_kg * prior_set.fact_reps)
        filter (where prior_exercise.input_kind = 'strength') prior_weight_reps
    from target join current_results current_result on true
    left join public.workouts prior_workout on prior_workout.client_id = target.client_id
      and prior_workout.status = 'done' and prior_workout.deleted_at is null
      and (prior_workout.completed_at, prior_workout.id) < (target.completed_at, target.id)
    left join public.workout_exercises prior_exercise
      on prior_exercise.workout_id = prior_workout.id
      and prior_exercise.exercise_ref = current_result.exercise_ref
      and prior_exercise.input_kind = current_result.input_kind
    left join public.workout_sets prior_set on prior_set.workout_exercise_id = prior_exercise.id
      and prior_set.confirmed_at is not null
    group by current_result.exercise_ref, current_result.input_kind,
      current_result.primary_value, current_result.best_weight_kg,
      current_result.best_weight_reps
  )
  select coalesce(bool_or(case when input_kind = 'strength' then
      (best_weight_kg is not null and (prior_weight_kg is null or best_weight_kg > prior_weight_kg))
      or (best_weight_reps is not null
        and (prior_weight_reps is null or best_weight_reps > prior_weight_reps))
    else primary_value is not null
      and (prior_primary_value is null or primary_value > prior_primary_value) end), false)
  from prior_results
$$;

revoke all on function app_private.workout_has_personal_record(uuid) from public;

create or replace function public.list_workout_chronicle(
  p_client_id uuid, p_limit integer default 20,
  p_before_completed_at timestamptz default null, p_before_workout_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.progress_partition(p_client_id);
  if p_limit < 1 or p_limit > 50
    or ((p_before_completed_at is null) is distinct from (p_before_workout_id is null)) then
    raise exception 'progress_invalid' using errcode = 'PT422';
  end if;
  return (with source as (
    select workout.id, workout.workout_date, workout.completed_at,
      workout.session_rpe, workout.wellbeing, workout.discomfort,
      workout.client_comment, workout.trainer_reaction, workout.trainer_review,
      case when workout.started_at is not null and workout.completed_at is not null
        then greatest(0, round(extract(epoch from workout.completed_at - workout.started_at))::integer)
        when workout.start_time is not null and workout.end_time is not null
        then greatest(0, round(extract(epoch from workout.end_time - workout.start_time))::integer)
        else null end duration_sec,
      app_private.workout_has_personal_record(workout.id) has_pr,
      facts.tonnage_kg, facts.confirmed_set_count,
      coalesce((select jsonb_agg(jsonb_build_object(
        'ref', exercise.exercise_ref, 'name', exercise.exercise_name,
        'inputKind', exercise.input_kind, 'confirmedSetCount',
          (select count(*) from public.workout_sets exercise_set
            where exercise_set.workout_exercise_id = exercise.id
              and exercise_set.confirmed_at is not null)
      ) order by exercise.position)
        from public.workout_exercises exercise
        where exercise.workout_id = workout.id
          and exists (select 1 from public.workout_sets exercise_set
            where exercise_set.workout_exercise_id = exercise.id
              and exercise_set.confirmed_at is not null)), '[]'::jsonb) exercises,
      count(*) over () total_count
    from public.workouts workout
    cross join lateral (select
      coalesce(sum(workout_set.fact_weight_kg * workout_set.fact_reps), 0) tonnage_kg,
      count(workout_set.id)::integer confirmed_set_count
      from public.workout_exercises fact_exercise
      join public.workout_sets workout_set
        on workout_set.workout_exercise_id = fact_exercise.id
        and workout_set.confirmed_at is not null
      where fact_exercise.workout_id = workout.id) facts
    where workout.client_id = p_client_id and workout.status = 'done'
      and workout.deleted_at is null
      and (p_before_completed_at is null
        or (workout.completed_at, workout.id) < (p_before_completed_at, p_before_workout_id))
    order by workout.completed_at desc, workout.id desc limit p_limit + 1
  ) select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'workoutId', id, 'workoutDate', workout_date, 'completedAt', completed_at,
      'sessionRpe', session_rpe, 'wellbeing', wellbeing, 'discomfort', discomfort,
      'clientComment', client_comment, 'trainerReaction', trainer_reaction,
      'trainerReview', trainer_review, 'tonnageKg', tonnage_kg,
      'durationSec', duration_sec, 'hasPr', has_pr,
      'confirmedSetCount', confirmed_set_count, 'exercises', exercises
    ) order by completed_at desc, id desc) filter (where row_number <= p_limit), '[]'::jsonb),
    'nextCursor', case when max(page_count) > p_limit then
      (jsonb_agg(jsonb_build_object('completedAt', completed_at, 'workoutId', id)
        order by row_number) filter (where row_number = p_limit))->0
      else null end,
    'totalCount', coalesce(max(total_count), 0)
  ) from (select source.*,
      row_number() over (order by completed_at desc, id desc) row_number,
      count(*) over () page_count from source) numbered);
end;
$$;

revoke all on function public.get_client_progress_bundle(uuid),
  public.save_client_progress(jsonb, bigint), public.delete_client_progress(uuid, bigint),
  public.save_client_metric(jsonb, bigint), public.set_client_metric_archived(uuid, boolean, bigint),
  public.save_client_goal(jsonb, bigint), public.archive_client_goal(uuid, bigint),
  public.save_goal_stage(jsonb, bigint), public.delete_goal_stage(uuid, bigint),
  public.list_running_progress(uuid, date, date), public.get_workout_regularity(uuid),
  public.list_exercise_progress(uuid, text, integer, timestamptz, uuid),
  public.list_workout_chronicle(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.get_client_progress_bundle(uuid),
  public.save_client_progress(jsonb, bigint), public.delete_client_progress(uuid, bigint),
  public.save_client_metric(jsonb, bigint), public.set_client_metric_archived(uuid, boolean, bigint),
  public.save_client_goal(jsonb, bigint), public.archive_client_goal(uuid, bigint),
  public.save_goal_stage(jsonb, bigint), public.delete_goal_stage(uuid, bigint),
  public.list_running_progress(uuid, date, date), public.get_workout_regularity(uuid),
  public.list_exercise_progress(uuid, text, integer, timestamptz, uuid),
  public.list_workout_chronicle(uuid, integer, timestamptz, uuid) to fit_api;

-- Down Migration

revoke execute on function public.get_client_progress_bundle(uuid),
  public.save_client_progress(jsonb, bigint), public.delete_client_progress(uuid, bigint),
  public.save_client_metric(jsonb, bigint), public.set_client_metric_archived(uuid, boolean, bigint),
  public.save_client_goal(jsonb, bigint), public.archive_client_goal(uuid, bigint),
  public.save_goal_stage(jsonb, bigint), public.delete_goal_stage(uuid, bigint),
  public.list_running_progress(uuid, date, date), public.get_workout_regularity(uuid),
  public.list_exercise_progress(uuid, text, integer, timestamptz, uuid),
  public.list_workout_chronicle(uuid, integer, timestamptz, uuid) from fit_api;
drop function public.list_workout_chronicle(uuid, integer, timestamptz, uuid);
drop function if exists app_private.workout_has_personal_record(uuid);
drop function public.list_exercise_progress(uuid, text, integer, timestamptz, uuid);
drop function public.get_workout_regularity(uuid);
drop function public.list_running_progress(uuid, date, date);
drop function public.delete_goal_stage(uuid, bigint);
drop function public.save_goal_stage(jsonb, bigint);
drop function public.archive_client_goal(uuid, bigint);
drop function public.save_client_goal(jsonb, bigint);
drop function public.set_client_metric_archived(uuid, boolean, bigint);
drop function public.save_client_metric(jsonb, bigint);
drop function public.delete_client_progress(uuid, bigint);
drop function public.save_client_progress(jsonb, bigint);
drop function public.get_client_progress_bundle(uuid);
drop function if exists app_private.client_today(uuid);
drop function app_private.progress_partition(uuid);
drop index if exists public.workouts_completed_client_cursor_idx;
drop index if exists public.workout_exercises_client_ref_workout_idx;
drop table public.goal_stages;
drop table public.client_goals;
drop table public.client_progress_custom;
drop table public.client_custom_metrics;
drop table public.client_progress;
