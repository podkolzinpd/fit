-- Progress 1.2: stable baselines for relative standard-measurement goals.

alter table public.goal_criteria
  add column baseline_value numeric(12, 3),
  add column baseline_recorded_on date,
  add column baseline_progress_id uuid,
  add constraint goal_criteria_baseline_progress_fk
    foreign key (baseline_progress_id, trainer_id, client_id)
    references public.client_progress(id, trainer_id, client_id) on delete set null (baseline_progress_id),
  add constraint goal_criteria_baseline_consistent check (
    (operation = 'change_by' and (
      (baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null)
      or (baseline_value > 0 and baseline_recorded_on is not null and baseline_progress_id is not null)
    ))
    or (operation <> 'change_by' and baseline_value is null
      and baseline_recorded_on is null and baseline_progress_id is null)
  );

create or replace function public.capture_standard_goal_baseline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.operation <> 'change_by' then
    new.baseline_value := null;
    new.baseline_recorded_on := null;
    new.baseline_progress_id := null;
    return new;
  end if;
  if tg_op = 'INSERT' or old.operation <> 'change_by' or old.metric <> new.metric then
    select case new.metric
        when 'weight' then progress.weight_kg
        when 'waist' then progress.waist_cm
        when 'chest' then progress.chest_cm
        when 'hips' then progress.hip_cm
      end,
      progress.recorded_on, progress.id
    into new.baseline_value, new.baseline_recorded_on, new.baseline_progress_id
    from public.client_progress progress
    where progress.client_id = new.client_id and progress.deleted_at is null
      and progress.recorded_on <= current_date
      and case new.metric
        when 'weight' then progress.weight_kg
        when 'waist' then progress.waist_cm
        when 'chest' then progress.chest_cm
        when 'hips' then progress.hip_cm
      end is not null
    order by progress.recorded_on desc, progress.created_at desc, progress.id desc
    limit 1;
  end if;
  return new;
end;
$$;

create trigger capture_standard_goal_baseline
before insert or update of metric, operation on public.goal_criteria
for each row execute function public.capture_standard_goal_baseline();

create or replace function public.refresh_standard_goal_baseline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed_id uuid := coalesce(new.id, old.id);
  changed_client_id uuid := coalesce(new.client_id, old.client_id);
  criterion record;
  next_value numeric;
  next_date date;
  next_id uuid;
  changed_value numeric;
begin
  for criterion in
    select stored.id, stored.metric, stored.baseline_progress_id, stored.baseline_recorded_on
    from public.goal_criteria stored
    where stored.client_id = changed_client_id and stored.operation = 'change_by'
      and stored.archived_at is null
      and (stored.baseline_progress_id = changed_id or stored.baseline_progress_id is null)
  loop
    changed_value := case criterion.metric
      when 'weight' then new.weight_kg
      when 'waist' then new.waist_cm
      when 'chest' then new.chest_cm
      when 'hips' then new.hip_cm
    end;
    if criterion.baseline_progress_id = changed_id and new.deleted_at is null and changed_value is not null then
      next_value := changed_value;
      next_date := new.recorded_on;
      next_id := new.id;
    else
      select case criterion.metric
          when 'weight' then progress.weight_kg
          when 'waist' then progress.waist_cm
          when 'chest' then progress.chest_cm
          when 'hips' then progress.hip_cm
        end,
        progress.recorded_on, progress.id
      into next_value, next_date, next_id
      from public.client_progress progress
      where progress.client_id = changed_client_id and progress.deleted_at is null
        and progress.id <> changed_id
        and (criterion.baseline_progress_id is null
          or progress.recorded_on <= criterion.baseline_recorded_on)
        and case criterion.metric
          when 'weight' then progress.weight_kg
          when 'waist' then progress.waist_cm
          when 'chest' then progress.chest_cm
          when 'hips' then progress.hip_cm
        end is not null
      order by progress.recorded_on desc, progress.created_at desc, progress.id desc
      limit 1;
      if criterion.baseline_progress_id is null and new.deleted_at is null and changed_value is not null
        and (next_date is null or new.recorded_on >= next_date) then
        next_value := changed_value;
        next_date := new.recorded_on;
        next_id := new.id;
      end if;
    end if;
    update public.goal_criteria stored set
      baseline_value = next_value, baseline_recorded_on = next_date,
      baseline_progress_id = next_id, version = stored.version + 1,
      updated_at = now()
    where stored.id = criterion.id
      and (stored.baseline_value, stored.baseline_recorded_on, stored.baseline_progress_id)
        is distinct from (next_value, next_date, next_id);
  end loop;
  return new;
end;
$$;

create trigger refresh_standard_goal_baseline
after insert or update of recorded_on, weight_kg, chest_cm, waist_cm, hip_cm, deleted_at
on public.client_progress
for each row execute function public.refresh_standard_goal_baseline();

-- Backfill only explicit relative criteria; legacy free-text goals remain untouched.
with baselines as (
  select criterion.id as criterion_id, baseline.value, baseline.recorded_on, baseline.id
  from public.goal_criteria criterion
  cross join lateral (
    select case criterion.metric
      when 'weight' then progress.weight_kg
      when 'waist' then progress.waist_cm
      when 'chest' then progress.chest_cm
      when 'hips' then progress.hip_cm
    end as value,
    progress.recorded_on, progress.id
  from public.client_progress progress
  where progress.client_id = criterion.client_id and progress.deleted_at is null
    and progress.recorded_on <= criterion.created_at::date
    and case criterion.metric
      when 'weight' then progress.weight_kg
      when 'waist' then progress.waist_cm
      when 'chest' then progress.chest_cm
      when 'hips' then progress.hip_cm
    end is not null
  order by progress.recorded_on desc, progress.created_at desc, progress.id desc
    limit 1
  ) baseline
  where criterion.operation = 'change_by' and criterion.baseline_value is null
)
update public.goal_criteria criterion set
  baseline_value = baseline.value,
  baseline_recorded_on = baseline.recorded_on,
  baseline_progress_id = baseline.id
from baselines baseline where criterion.id = baseline.criterion_id;

create or replace function public.get_client_goal(p_client_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when goal.id is null then null else jsonb_build_object(
    'id', goal.id, 'clientId', goal.client_id, 'title', goal.title,
    'targetDate', goal.target_date, 'status', goal.status, 'version', goal.version,
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', stage.id, 'goalId', stage.goal_id, 'title', stage.title,
      'startsOn', stage.starts_on, 'endsOn', stage.ends_on,
      'position', stage.position, 'version', stage.version
    ) order by stage.position, stage.starts_on) from public.goal_stages stage
      where stage.goal_id = goal.id), '[]'::jsonb),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object(
      'id', criterion.id, 'goalId', criterion.goal_id,
      'metric', criterion.metric, 'operation', criterion.operation,
      'targetValue', criterion.target_value, 'rangeMin', criterion.range_min,
      'rangeMax', criterion.range_max, 'unit', criterion.unit,
      'baselineValue', criterion.baseline_value,
      'baselineRecordedOn', criterion.baseline_recorded_on,
      'confirmationStatus', criterion.confirmation_status,
      'position', criterion.position, 'version', criterion.version
    ) order by criterion.position, criterion.id) from public.goal_criteria criterion
      where criterion.goal_id = goal.id and criterion.archived_at is null), '[]'::jsonb)
  ) end
  from public.clients client
  left join public.client_goals goal on goal.client_id = client.id and goal.status = 'active'
  where client.id = p_client_id and (
    client.trainer_id = auth.uid() or client.auth_user_id = auth.uid()
    or exists (select 1 from public.client_trainers membership
      where membership.client_id = client.id and membership.trainer_id = auth.uid())
  );
$$;

revoke all on function public.capture_standard_goal_baseline(),
  public.refresh_standard_goal_baseline() from public, anon;
