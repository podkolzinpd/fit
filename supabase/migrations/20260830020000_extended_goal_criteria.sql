-- Progress 1.3: deterministic exercise, cardio, regularity and custom criteria,
-- composite goals, and persisted snapshots for user-confirmed LLM suggestions.

drop trigger capture_standard_goal_baseline on public.goal_criteria;

alter table public.goal_criteria
  drop constraint goal_criteria_metric_allowed,
  drop constraint goal_criteria_values_valid,
  drop constraint goal_criteria_baseline_consistent,
  add column secondary_target_value numeric(12, 3),
  add column secondary_unit text,
  add column exercise_source text,
  add column exercise_ref text,
  add column exercise_name text,
  add column custom_exercise_id uuid,
  add column custom_metric_id uuid,
  add column custom_metric_name text,
  add column regularity_period text,
  add column regularity_mode text,
  add constraint goal_criteria_custom_exercise_fk foreign key (custom_exercise_id, trainer_id)
    references public.custom_exercises(id, trainer_id) on delete restrict,
  add constraint goal_criteria_custom_metric_fk foreign key (custom_metric_id, trainer_id, client_id)
    references public.client_custom_metrics(id, trainer_id, client_id) on delete restrict,
  add constraint goal_criteria_metric_allowed check (metric in (
    'weight', 'waist', 'chest', 'hips',
    'exercise_working_weight', 'exercise_reps', 'exercise_volume', 'exercise_best_result',
    'cardio_distance', 'cardio_duration', 'cardio_pace', 'cardio_distance_time',
    'workout_regularity', 'custom'
  )),
  add constraint goal_criteria_unit_consistent check (
    (metric = 'weight' and unit = 'кг') or (metric in ('waist','chest','hips') and unit = 'см')
    or (metric = 'exercise_working_weight' and unit = 'кг') or (metric = 'exercise_reps' and unit = 'повт.')
    or (metric = 'exercise_volume' and unit = 'кг·повт.') or metric = 'exercise_best_result'
    or (metric in ('cardio_distance','cardio_distance_time') and unit = 'км') or (metric = 'cardio_duration' and unit = 'мин')
    or (metric = 'cardio_pace' and unit = 'мин/км') or (metric = 'workout_regularity' and unit = 'трен.') or metric = 'custom'
  ),
  add constraint goal_criteria_values_valid check (
    (operation = 'track_only' and target_value is null and range_min is null and range_max is null)
    or (operation = 'maintain_range' and target_value is null and range_min is not null and range_max >= range_min
      and (metric = 'custom' or range_min > 0))
    or (operation in ('decrease_to', 'increase_to') and target_value is not null
      and range_min is null and range_max is null and (metric = 'custom' or target_value > 0))
    or (operation = 'change_by' and metric in ('weight', 'waist', 'chest', 'hips')
      and target_value <> 0 and range_min is null and range_max is null)
  ),
  add constraint goal_criteria_secondary_consistent check (
    (metric = 'cardio_distance_time' and operation = 'increase_to'
      and secondary_target_value > 0 and secondary_unit = 'мин')
    or (metric <> 'cardio_distance_time' and secondary_target_value is null and secondary_unit is null)
  ),
  add constraint goal_criteria_source_consistent check (
    (metric in ('exercise_working_weight', 'exercise_reps', 'exercise_volume', 'exercise_best_result',
      'cardio_distance', 'cardio_duration', 'cardio_pace', 'cardio_distance_time')
      and exercise_source in ('system', 'custom') and btrim(exercise_ref) <> '' and btrim(exercise_name) <> ''
      and ((exercise_source = 'custom' and custom_exercise_id is not null)
        or (exercise_source = 'system' and custom_exercise_id is null))
      and custom_metric_id is null and custom_metric_name is null
      and regularity_period is null and regularity_mode is null)
    or (metric = 'custom' and custom_metric_id is not null and btrim(custom_metric_name) <> ''
      and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null
      and regularity_period is null and regularity_mode is null)
    or (metric = 'workout_regularity' and regularity_period in ('week', 'month')
      and regularity_mode in ('average', 'each_period') and (target_value is null or target_value = trunc(target_value))
      and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null
      and custom_metric_id is null and custom_metric_name is null)
    or (metric in ('weight', 'waist', 'chest', 'hips')
      and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null
      and custom_metric_id is null and custom_metric_name is null and regularity_period is null and regularity_mode is null)
  ),
  add constraint goal_criteria_baseline_consistent check (
    (operation = 'change_by' and metric in ('weight', 'waist', 'chest', 'hips') and (
      (baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null)
      or (baseline_value > 0 and baseline_recorded_on is not null and baseline_progress_id is not null)
    )) or (operation <> 'change_by' and baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null)
  );

create trigger capture_standard_goal_baseline
before insert or update of metric, operation on public.goal_criteria
for each row execute function public.capture_standard_goal_baseline();

create or replace function public.goal_criterion_payload_valid(p_criterion jsonb, p_client_id uuid, p_trainer_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  metric_value text := p_criterion->>'metric';
  operation_value text := p_criterion->>'operation';
  source_value text := nullif(p_criterion->>'exerciseSource', '');
  exercise_ref_value text := nullif(btrim(p_criterion->>'exerciseRef'), '');
  custom_exercise_value uuid := nullif(p_criterion->>'customExerciseId', '')::uuid;
  custom_metric_value uuid := nullif(p_criterion->>'customMetricId', '')::uuid;
begin
  if coalesce(p_criterion->>'confirmationStatus', '') <> 'confirmed'
    or metric_value not in ('weight', 'waist', 'chest', 'hips', 'exercise_working_weight', 'exercise_reps', 'exercise_volume', 'exercise_best_result', 'cardio_distance', 'cardio_duration', 'cardio_pace', 'cardio_distance_time', 'workout_regularity', 'custom')
    or operation_value not in ('decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only') then return false; end if;
  if metric_value like 'exercise_%' or metric_value like 'cardio_%' then
    if source_value not in ('system', 'custom') or exercise_ref_value is null or nullif(btrim(p_criterion->>'exerciseName'), '') is null then return false; end if;
    if source_value = 'custom' and not exists (select 1 from public.custom_exercises where id = custom_exercise_value and trainer_id = p_trainer_id and archived_at is null) then return false; end if;
    if source_value = 'system' and custom_exercise_value is not null then return false; end if;
  end if;
  if metric_value = 'custom' and not exists (select 1 from public.client_custom_metrics where id = custom_metric_value and client_id = p_client_id and trainer_id = p_trainer_id and archived_at is null) then return false; end if;
  return true;
exception when invalid_text_representation then return false;
end; $$;

create or replace function public.save_client_goal(p_goal jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); client_id_value uuid := (p_goal->>'clientId')::uuid; root_trainer uuid;
  title_value text := btrim(p_goal->>'title'); target_date_value date := nullif(p_goal->>'targetDate', '')::date;
  goal_id_value uuid := nullif(p_goal->>'id', '')::uuid; next_version bigint; previous_title text;
  criteria_value jsonb; criterion jsonb; criterion_id uuid; criterion_version bigint; position_value smallint;
begin
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  if not exists (select 1 from public.clients where id = client_id_value and trainer_id = root_trainer) then raise exception 'client_access_denied' using errcode = 'PT403'; end if;
  if title_value is null or title_value = '' or char_length(title_value) > 200 then raise exception 'invalid_goal' using errcode = 'PT422'; end if;
  if goal_id_value is null then
    insert into public.client_goals(client_id, trainer_id, created_by, title, target_date) values(client_id_value, root_trainer, actor_id, title_value, target_date_value) returning id into goal_id_value;
  else
    select title into previous_title from public.client_goals where id = goal_id_value and client_id = client_id_value and trainer_id = root_trainer and status = 'active';
    update public.client_goals set title = title_value, target_date = target_date_value, version = version + 1, updated_at = now()
      where id = goal_id_value and client_id = client_id_value and trainer_id = root_trainer and status = 'active'
        and (p_expected_version is null or version = p_expected_version) returning version into next_version;
    if next_version is null then raise exception 'goal_conflict' using errcode = 'PT409'; end if;
  end if;

  if p_goal ? 'criteria' then criteria_value := p_goal->'criteria';
  elsif p_goal ? 'criterion' then criteria_value := case when p_goal->'criterion' = 'null'::jsonb then '[]'::jsonb else jsonb_build_array(p_goal->'criterion') end;
  else criteria_value := null; end if;

  if criteria_value is null then
    if previous_title is distinct from title_value then update public.goal_criteria set confirmation_status = 'needs_review', confirmed_by = null, confirmed_at = null, version = version + 1, updated_at = now() where goal_id = goal_id_value and archived_at is null; end if;
    return goal_id_value;
  end if;
  if jsonb_typeof(criteria_value) <> 'array' or jsonb_array_length(criteria_value) > 10 then raise exception 'invalid_goal_criterion' using errcode = 'PT422'; end if;

  update public.goal_criteria set position = position + 1000 where goal_id = goal_id_value and archived_at is null;
  for criterion in select value from jsonb_array_elements(criteria_value) loop
    position_value := coalesce(nullif(criterion->>'position', '')::smallint, 0);
    if position_value < 0 or not public.goal_criterion_payload_valid(criterion, client_id_value, root_trainer) then raise exception 'invalid_goal_criterion' using errcode = 'PT422'; end if;
    criterion_id := nullif(criterion->>'id', '')::uuid; criterion_version := nullif(criterion->>'version', '')::bigint;
    if criterion_id is null then
      insert into public.goal_criteria(goal_id, trainer_id, client_id, created_by, metric, operation, target_value, range_min, range_max, unit,
        secondary_target_value, secondary_unit, exercise_source, exercise_ref, exercise_name, custom_exercise_id,
        custom_metric_id, custom_metric_name, regularity_period, regularity_mode, confirmation_status, confirmed_by, confirmed_at, position)
      values(goal_id_value, root_trainer, client_id_value, actor_id, criterion->>'metric', criterion->>'operation', nullif(criterion->>'targetValue','')::numeric,
        nullif(criterion->>'rangeMin','')::numeric, nullif(criterion->>'rangeMax','')::numeric, btrim(criterion->>'unit'),
        nullif(criterion->>'secondaryTargetValue','')::numeric, nullif(criterion->>'secondaryUnit',''), nullif(criterion->>'exerciseSource',''),
        nullif(btrim(criterion->>'exerciseRef'),''), nullif(btrim(criterion->>'exerciseName'),''), nullif(criterion->>'customExerciseId','')::uuid,
        nullif(criterion->>'customMetricId','')::uuid, nullif(btrim(criterion->>'customMetricName'),''), nullif(criterion->>'regularityPeriod',''),
        nullif(criterion->>'regularityMode',''), 'confirmed', actor_id, now(), position_value);
    else
      if criterion_version is null then raise exception 'goal_criterion_conflict' using errcode = 'PT409'; end if;
      update public.goal_criteria set metric=criterion->>'metric', operation=criterion->>'operation', target_value=nullif(criterion->>'targetValue','')::numeric,
        range_min=nullif(criterion->>'rangeMin','')::numeric, range_max=nullif(criterion->>'rangeMax','')::numeric, unit=btrim(criterion->>'unit'),
        secondary_target_value=nullif(criterion->>'secondaryTargetValue','')::numeric, secondary_unit=nullif(criterion->>'secondaryUnit',''),
        exercise_source=nullif(criterion->>'exerciseSource',''), exercise_ref=nullif(btrim(criterion->>'exerciseRef'),''), exercise_name=nullif(btrim(criterion->>'exerciseName'),''),
        custom_exercise_id=nullif(criterion->>'customExerciseId','')::uuid, custom_metric_id=nullif(criterion->>'customMetricId','')::uuid,
        custom_metric_name=nullif(btrim(criterion->>'customMetricName'),''), regularity_period=nullif(criterion->>'regularityPeriod',''), regularity_mode=nullif(criterion->>'regularityMode',''),
        confirmation_status='confirmed', confirmed_by=actor_id, confirmed_at=now(), position=position_value, version=version+1, updated_at=now()
      where id=criterion_id and goal_id=goal_id_value and archived_at is null and version=criterion_version;
      if not found then raise exception 'goal_criterion_conflict' using errcode = 'PT409'; end if;
    end if;
  end loop;
  update public.goal_criteria set archived_at=now(), version=version+1, updated_at=now()
    where goal_id=goal_id_value and archived_at is null and position >= 1000;
  return goal_id_value;
exception when check_violation or foreign_key_violation or invalid_text_representation then raise exception 'invalid_goal_criterion' using errcode = 'PT422';
end; $$;

create or replace function public.get_client_goal(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
select case when goal.id is null then null else jsonb_build_object('id',goal.id,'clientId',goal.client_id,'title',goal.title,'targetDate',goal.target_date,'status',goal.status,'version',goal.version,
  'stages',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'goalId',s.goal_id,'title',s.title,'startsOn',s.starts_on,'endsOn',s.ends_on,'position',s.position,'version',s.version) order by s.position,s.starts_on) from public.goal_stages s where s.goal_id=goal.id),'[]'::jsonb),
  'criteria',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'goalId',c.goal_id,'metric',c.metric,'operation',c.operation,'targetValue',c.target_value,'rangeMin',c.range_min,'rangeMax',c.range_max,'unit',c.unit,
    'baselineValue',c.baseline_value,'baselineRecordedOn',c.baseline_recorded_on,'secondaryTargetValue',c.secondary_target_value,'secondaryUnit',c.secondary_unit,
    'exerciseSource',c.exercise_source,'exerciseRef',c.exercise_ref,'exerciseName',c.exercise_name,'customExerciseId',c.custom_exercise_id,
    'customMetricId',c.custom_metric_id,'customMetricName',c.custom_metric_name,'regularityPeriod',c.regularity_period,'regularityMode',c.regularity_mode,
    'confirmationStatus',c.confirmation_status,'position',c.position,'version',c.version) order by c.position,c.id) from public.goal_criteria c where c.goal_id=goal.id and c.archived_at is null),'[]'::jsonb)) end
from public.clients client left join public.client_goals goal on goal.client_id=client.id and goal.status='active'
where client.id=p_client_id and (client.trainer_id=auth.uid() or client.auth_user_id=auth.uid() or exists(select 1 from public.client_trainers m where m.client_id=client.id and m.trainer_id=auth.uid())); $$;

revoke all on function public.goal_criterion_payload_valid(jsonb,uuid,uuid) from public, anon;
