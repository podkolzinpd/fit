-- Up Migration

alter function public.save_client_goal(jsonb,bigint) rename to save_client_goal_v2;
revoke execute on function public.save_client_goal_v2(jsonb,bigint) from fit_api;
alter function public.get_client_progress_bundle(uuid) rename to get_client_progress_bundle_v2;
revoke execute on function public.get_client_progress_bundle_v2(uuid) from fit_api;

drop trigger capture_standard_goal_baseline on public.goal_criteria;
alter table public.goal_criteria drop constraint goal_criteria_metric_allowed,
  drop constraint goal_criteria_values_valid, drop constraint goal_criteria_baseline_consistent,
  add column secondary_target_value numeric(12,3), add column secondary_unit text,
  add column exercise_source text, add column exercise_ref text, add column exercise_name text,
  add column custom_exercise_id uuid, add column custom_metric_id uuid, add column custom_metric_name text,
  add column regularity_period text, add column regularity_mode text,
  add constraint goal_criteria_custom_exercise_fk foreign key(custom_exercise_id,trainer_id) references public.custom_exercises(id,trainer_id) on delete restrict,
  add constraint goal_criteria_custom_metric_fk foreign key(custom_metric_id,trainer_id,client_id) references public.client_custom_metrics(id,trainer_id,client_id) on delete restrict,
  add constraint goal_criteria_metric_allowed check(metric in('weight','waist','chest','hips','exercise_working_weight','exercise_reps','exercise_volume','exercise_best_result','cardio_distance','cardio_duration','cardio_pace','cardio_distance_time','workout_regularity','custom')),
  add constraint goal_criteria_unit_consistent check((metric='weight' and unit='кг')or(metric in('waist','chest','hips') and unit='см')or(metric='exercise_working_weight' and unit='кг')or(metric='exercise_reps' and unit='повт.')or(metric='exercise_volume' and unit='кг·повт.')or metric='exercise_best_result'or(metric in('cardio_distance','cardio_distance_time')and unit='км')or(metric='cardio_duration' and unit='мин')or(metric='cardio_pace' and unit='мин/км')or(metric='workout_regularity' and unit='трен.')or metric='custom'),
  add constraint goal_criteria_values_valid check(
    (operation='track_only' and target_value is null and range_min is null and range_max is null)
    or(operation='maintain_range' and target_value is null and range_min is not null and range_max>=range_min and(metric='custom' or range_min>0))
    or(operation in('decrease_to','increase_to') and target_value is not null and range_min is null and range_max is null and(metric='custom' or target_value>0))
    or(operation='change_by' and metric in('weight','waist','chest','hips') and target_value<>0 and range_min is null and range_max is null)),
  add constraint goal_criteria_secondary_consistent check((metric='cardio_distance_time' and operation='increase_to' and secondary_target_value>0 and secondary_unit='мин') or(metric<>'cardio_distance_time' and secondary_target_value is null and secondary_unit is null)),
  add constraint goal_criteria_source_consistent check(
    (metric in('exercise_working_weight','exercise_reps','exercise_volume','exercise_best_result','cardio_distance','cardio_duration','cardio_pace','cardio_distance_time') and exercise_source in('system','custom') and btrim(exercise_ref)<>'' and btrim(exercise_name)<>'' and((exercise_source='custom' and custom_exercise_id is not null)or(exercise_source='system' and custom_exercise_id is null)) and custom_metric_id is null and custom_metric_name is null and regularity_period is null and regularity_mode is null)
    or(metric='custom' and custom_metric_id is not null and btrim(custom_metric_name)<>'' and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null and regularity_period is null and regularity_mode is null)
    or(metric='workout_regularity' and regularity_period in('week','month') and regularity_mode in('average','each_period') and(target_value is null or target_value=trunc(target_value)) and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null and custom_metric_id is null and custom_metric_name is null)
    or(metric in('weight','waist','chest','hips') and exercise_source is null and exercise_ref is null and exercise_name is null and custom_exercise_id is null and custom_metric_id is null and custom_metric_name is null and regularity_period is null and regularity_mode is null)),
  add constraint goal_criteria_baseline_consistent check((operation='change_by' and metric in('weight','waist','chest','hips') and((baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null)or(baseline_value>0 and baseline_recorded_on is not null and baseline_progress_id is not null)))or(operation<>'change_by' and baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null));
create trigger capture_standard_goal_baseline before insert or update of metric,operation on public.goal_criteria for each row execute function public.capture_standard_goal_baseline();

create function public.goal_criterion_payload_valid_v1(p_criterion jsonb,p_client_id uuid,p_trainer_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare metric_value text:=p_criterion->>'metric'; source_value text:=nullif(p_criterion->>'exerciseSource','');
  custom_exercise_value uuid:=nullif(p_criterion->>'customExerciseId','')::uuid; custom_metric_value uuid:=nullif(p_criterion->>'customMetricId','')::uuid;
begin
  if metric_value like 'exercise_%' or metric_value like 'cardio_%' then
    if source_value not in('system','custom') or nullif(btrim(p_criterion->>'exerciseRef'),'') is null or nullif(btrim(p_criterion->>'exerciseName'),'') is null then return false; end if;
    if source_value='custom' and not exists(select 1 from public.custom_exercises where id=custom_exercise_value and trainer_id=p_trainer_id and archived_at is null) then return false; end if;
    if source_value='system' and custom_exercise_value is not null then return false; end if;
  end if;
  if metric_value='custom' and not exists(select 1 from public.client_custom_metrics where id=custom_metric_value and client_id=p_client_id and trainer_id=p_trainer_id and archived_at is null) then return false; end if;
  return true;
exception when invalid_text_representation then return false;
end; $$;

create or replace function public.save_client_goal(p_goal jsonb,p_expected_version bigint default null)
returns table(goal_id uuid,version bigint) language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); prior_title text; result_goal_id uuid; result_version bigint; root_id uuid; client_id_value uuid;
  criteria_value jsonb; criterion jsonb; criterion_id uuid; criterion_version bigint; position_value smallint;
begin
  if nullif(p_goal->>'id','') is not null then select title into prior_title from public.client_goals where id=(p_goal->>'id')::uuid; end if;
  select saved.goal_id,saved.version into result_goal_id,result_version from public.save_client_goal_v1(p_goal,p_expected_version) saved;
  select trainer_id,client_id into root_id,client_id_value from public.client_goals where id=result_goal_id;
  if p_goal?'criteria' then criteria_value:=p_goal->'criteria'; elsif p_goal?'criterion' then criteria_value:=case when p_goal->'criterion'='null'::jsonb then '[]'::jsonb else jsonb_build_array(p_goal->'criterion') end; else criteria_value:=null; end if;
  if criteria_value is null then
    if prior_title is distinct from btrim(p_goal->>'title') then update public.goal_criteria set confirmation_status='needs_review',confirmed_by=null,confirmed_at=null,version=public.goal_criteria.version+1 where public.goal_criteria.goal_id=result_goal_id and archived_at is null; end if;
    return query select result_goal_id,result_version; return;
  end if;
  if jsonb_typeof(criteria_value)<>'array' or jsonb_array_length(criteria_value)>10 then raise exception 'goal_criterion_invalid' using errcode='PT422'; end if;
  update public.goal_criteria set position=position+1000 where public.goal_criteria.goal_id=result_goal_id and archived_at is null;
  for criterion in select value from jsonb_array_elements(criteria_value) loop
    position_value:=coalesce(nullif(criterion->>'position','')::smallint,0); criterion_id:=nullif(criterion->>'id','')::uuid; criterion_version:=nullif(criterion->>'version','')::bigint;
    if position_value<0 or coalesce(criterion->>'confirmationStatus','')<>'confirmed'
      or not public.goal_criterion_payload_valid_v1(criterion,client_id_value,root_id) then raise exception 'goal_criterion_invalid' using errcode='PT422'; end if;
    if criterion_id is null then
      insert into public.goal_criteria(goal_id,trainer_id,client_id,created_by,metric,operation,target_value,range_min,range_max,unit,secondary_target_value,secondary_unit,exercise_source,exercise_ref,exercise_name,custom_exercise_id,custom_metric_id,custom_metric_name,regularity_period,regularity_mode,confirmation_status,confirmed_by,confirmed_at,position)
      values(result_goal_id,root_id,client_id_value,actor_id,criterion->>'metric',criterion->>'operation',nullif(criterion->>'targetValue','')::numeric,nullif(criterion->>'rangeMin','')::numeric,nullif(criterion->>'rangeMax','')::numeric,btrim(criterion->>'unit'),nullif(criterion->>'secondaryTargetValue','')::numeric,nullif(criterion->>'secondaryUnit',''),nullif(criterion->>'exerciseSource',''),nullif(btrim(criterion->>'exerciseRef'),''),nullif(btrim(criterion->>'exerciseName'),''),nullif(criterion->>'customExerciseId','')::uuid,nullif(criterion->>'customMetricId','')::uuid,nullif(btrim(criterion->>'customMetricName'),''),nullif(criterion->>'regularityPeriod',''),nullif(criterion->>'regularityMode',''),'confirmed',actor_id,now(),position_value);
    else
      update public.goal_criteria stored set metric=criterion->>'metric',operation=criterion->>'operation',target_value=nullif(criterion->>'targetValue','')::numeric,range_min=nullif(criterion->>'rangeMin','')::numeric,range_max=nullif(criterion->>'rangeMax','')::numeric,unit=btrim(criterion->>'unit'),secondary_target_value=nullif(criterion->>'secondaryTargetValue','')::numeric,secondary_unit=nullif(criterion->>'secondaryUnit',''),exercise_source=nullif(criterion->>'exerciseSource',''),exercise_ref=nullif(btrim(criterion->>'exerciseRef'),''),exercise_name=nullif(btrim(criterion->>'exerciseName'),''),custom_exercise_id=nullif(criterion->>'customExerciseId','')::uuid,custom_metric_id=nullif(criterion->>'customMetricId','')::uuid,custom_metric_name=nullif(btrim(criterion->>'customMetricName'),''),regularity_period=nullif(criterion->>'regularityPeriod',''),regularity_mode=nullif(criterion->>'regularityMode',''),confirmation_status='confirmed',confirmed_by=actor_id,confirmed_at=now(),position=position_value,version=stored.version+1
      where stored.id=criterion_id and stored.goal_id=result_goal_id and stored.archived_at is null and stored.version=criterion_version;
      if not found then raise exception 'goal_criterion_conflict' using errcode='PT409'; end if;
    end if;
  end loop;
  update public.goal_criteria set archived_at=now(),version=public.goal_criteria.version+1 where public.goal_criteria.goal_id=result_goal_id and archived_at is null and position>=1000;
  return query select result_goal_id,result_version;
exception when check_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'goal_criterion_invalid' using errcode='PT422'; when unique_violation then raise exception 'goal_criterion_conflict' using errcode='PT409';
end; $$;

create or replace function public.get_client_progress_bundle(p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare bundle jsonb; goal_id_value uuid; begin bundle:=public.get_client_progress_bundle_v2(p_client_id); goal_id_value:=nullif(bundle->'goal'->>'id','')::uuid;
if goal_id_value is not null then bundle:=jsonb_set(bundle,'{goal,criteria}',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'goalId',c.goal_id,'metric',c.metric,'operation',c.operation,'targetValue',c.target_value,'rangeMin',c.range_min,'rangeMax',c.range_max,'unit',c.unit,'baselineValue',c.baseline_value,'baselineRecordedOn',c.baseline_recorded_on,'secondaryTargetValue',c.secondary_target_value,'secondaryUnit',c.secondary_unit,'exerciseSource',c.exercise_source,'exerciseRef',c.exercise_ref,'exerciseName',c.exercise_name,'customExerciseId',c.custom_exercise_id,'customMetricId',c.custom_metric_id,'customMetricName',c.custom_metric_name,'regularityPeriod',c.regularity_period,'regularityMode',c.regularity_mode,'confirmationStatus',c.confirmation_status,'position',c.position,'version',c.version)order by c.position,c.id)from public.goal_criteria c where c.goal_id=goal_id_value and c.archived_at is null),'[]'::jsonb),true); end if; return bundle; end; $$;
revoke all on function public.save_client_goal(jsonb,bigint),public.get_client_progress_bundle(uuid) from public;
grant execute on function public.save_client_goal(jsonb,bigint),public.get_client_progress_bundle(uuid) to fit_api;

-- Down Migration

drop function public.save_client_goal(jsonb,bigint);
alter function public.save_client_goal_v2(jsonb,bigint) rename to save_client_goal;
grant execute on function public.save_client_goal(jsonb,bigint) to fit_api;
drop function public.get_client_progress_bundle(uuid);
alter function public.get_client_progress_bundle_v2(uuid) rename to get_client_progress_bundle;
grant execute on function public.get_client_progress_bundle(uuid) to fit_api;
drop function public.goal_criterion_payload_valid_v1(jsonb,uuid,uuid);
drop trigger capture_standard_goal_baseline on public.goal_criteria;
alter table public.goal_criteria drop constraint goal_criteria_custom_exercise_fk,drop constraint goal_criteria_custom_metric_fk,drop constraint goal_criteria_metric_allowed,drop constraint goal_criteria_unit_consistent,drop constraint goal_criteria_values_valid,drop constraint goal_criteria_secondary_consistent,drop constraint goal_criteria_source_consistent,drop constraint goal_criteria_baseline_consistent,
  drop column secondary_target_value,drop column secondary_unit,drop column exercise_source,drop column exercise_ref,drop column exercise_name,drop column custom_exercise_id,drop column custom_metric_id,drop column custom_metric_name,drop column regularity_period,drop column regularity_mode,
  add constraint goal_criteria_metric_allowed check(metric in('weight','waist','chest','hips')),
  add constraint goal_criteria_values_valid check((operation='track_only' and target_value is null and range_min is null and range_max is null)or(operation='maintain_range' and target_value is null and range_min>0 and range_max>=range_min)or(operation in('decrease_to','increase_to') and target_value>0 and range_min is null and range_max is null)or(operation='change_by' and target_value<>0 and range_min is null and range_max is null)),
  add constraint goal_criteria_baseline_consistent check((operation='change_by' and((baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null)or(baseline_value>0 and baseline_recorded_on is not null and baseline_progress_id is not null)))or(operation<>'change_by' and baseline_value is null and baseline_recorded_on is null and baseline_progress_id is null));
create trigger capture_standard_goal_baseline before insert or update of metric,operation on public.goal_criteria for each row execute function public.capture_standard_goal_baseline();
