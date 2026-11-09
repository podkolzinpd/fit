-- Up Migration

-- Choices are private, actor/operation scoped receipts, never bearer tokens.
create table if not exists app_private.client_merge_choices (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_client_id uuid not null references public.clients(id) on delete cascade,
  preview_version text,
  choices jsonb not null,
  conflicts jsonb not null,
  original_values jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation_id)
);
alter table app_private.client_merge_choices enable row level security;
revoke all on app_private.client_merge_choices from public,fit_api;
create table if not exists app_private.merge_suspended_workouts (
  workout_id uuid primary key references public.workouts(id) on delete cascade,
  started_at timestamptz not null,
  started_by uuid,
  paused_since timestamptz not null,
  resumed_at timestamptz
);
alter table app_private.merge_suspended_workouts enable row level security;
revoke all on app_private.merge_suspended_workouts from public,fit_api;

-- Keep both reports verbatim; the athlete chooses which remains current.
alter table public.client_training_summaries add column if not exists merge_superseded_at timestamptz;
alter table public.client_published_training_summaries add column if not exists merge_superseded_at timestamptz;
alter table public.goal_criteria alter constraint goal_criteria_custom_metric_fk deferrable initially immediate;
alter table public.client_training_summaries drop constraint if exists training_summaries_identity_unique;
alter table public.client_published_training_summaries drop constraint if exists published_summaries_period_unique;
create unique index if not exists training_summaries_identity_unique on public.client_training_summaries
  (client_id,period_start,period_end,prompt_version) where merge_superseded_at is null;
create unique index if not exists published_summaries_period_unique on public.client_published_training_summaries
  (client_id,period_start,period_end) where merge_superseded_at is null;
alter table public.client_published_training_summaries drop constraint if exists client_published_training_summaries_source_summary_id_key;
create unique index if not exists published_summaries_current_source_uidx on public.client_published_training_summaries(source_summary_id)
  where merge_superseded_at is null;

create or replace function app_private.client_merge_conflicts(p_source uuid,p_target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with conflicts as (
    select 'profile:'||field.key as key, labels.label,
      field.value as account, to_jsonb(s)->field.key as card,
      'profile'::text as kind, t.id as account_id,s.id as card_id,field.key as field
    from public.clients s cross join public.clients t
    cross join lateral jsonb_each(to_jsonb(t)) field
    join (values ('full_name','Имя'),('gender','Пол'),('age_years','Возраст'),
      ('height_cm','Рост, см'),('goal','Цель в карточке')) labels(name,label) on labels.name=field.key
    where s.id=p_source and t.id=p_target and field.value<>'null'::jsonb
      and to_jsonb(s)->field.key<>'null'::jsonb and field.value is distinct from to_jsonb(s)->field.key
    union all
    select 'profile:profile_photo','Фотография',
      jsonb_build_object('Описание','Фото из моего аккаунта','revision',t.profile_photo->>'sha256'),
      jsonb_build_object('Описание','Фото из карточки тренера','revision',s.profile_photo->>'sha256'),
      'profile',t.id,s.id,'profile_photo'
    from public.clients s cross join public.clients t where s.id=p_source and t.id=p_target
      and s.profile_photo is not null and t.profile_photo is not null
      and s.profile_photo->>'sha256' is distinct from t.profile_photo->>'sha256'
    union all
    select 'progress:'||s.id||':'||field.key,labels.label||' · '||s.recorded_on,
      field.value,to_jsonb(s)->field.key,'progress',t.id,s.id,field.key
    from public.client_progress s join public.client_progress t on t.recorded_on=s.recorded_on
    cross join lateral jsonb_each(to_jsonb(t)) field
    join (values ('weight_kg','Вес, кг'),('chest_cm','Грудь, см'),('waist_cm','Талия, см'),
      ('hip_cm','Бёдра, см'),('notes','Заметка к замеру'),('inbody_data','InBody')) labels(name,label) on labels.name=field.key
    where s.client_id=p_source and t.client_id=p_target and s.deleted_at is null and t.deleted_at is null
      and field.value<>'null'::jsonb and to_jsonb(s)->field.key<>'null'::jsonb
      and field.value is distinct from to_jsonb(s)->field.key
    union all
    select 'metric:'||s.id,'Единица показателя «'||s.name||'»',to_jsonb(t.unit),to_jsonb(s.unit),'metric',t.id,s.id,'unit'
    from public.client_custom_metrics s join public.client_custom_metrics t on lower(btrim(t.name))=lower(btrim(s.name))
    where s.client_id=p_source and t.client_id=p_target and s.archived_at is null and t.archived_at is null
      and nullif(lower(btrim(s.unit)),'') is distinct from nullif(lower(btrim(t.unit)),'')
    union all
    select 'custom:'||sv.id,sm.name||' · '||sp.recorded_on||coalesce(' · '||sm.unit,''),
      to_jsonb(tv.value),to_jsonb(sv.value),'custom',tv.id,sv.id,'value'
    from public.client_progress sp join public.client_progress tp on tp.recorded_on=sp.recorded_on
    join public.client_progress_custom sv on sv.progress_id=sp.id
    join public.client_custom_metrics sm on sm.id=sv.metric_id
    join public.client_custom_metrics tm on lower(btrim(tm.name))=lower(btrim(sm.name))
      and nullif(lower(btrim(tm.unit)),'') is not distinct from nullif(lower(btrim(sm.unit)),'')
    join public.client_progress_custom tv on tv.progress_id=tp.id and tv.metric_id=tm.id
    where sp.client_id=p_source and tp.client_id=p_target and sp.deleted_at is null and tp.deleted_at is null
      and tm.client_id=p_target and sv.value<>tv.value
    union all
    select 'goal:'||s.id,'Текущая цель',
      jsonb_build_object('Название',t.title,'Срок',t.target_date,
        'Этапы',(select jsonb_agg(jsonb_build_object('Название',g.title,'С',g.starts_on,'По',g.ends_on) order by g.position,g.id) from public.goal_stages g where g.goal_id=t.id),
        'Критерии',(select jsonb_agg(jsonb_build_object('Показатель',coalesce(c.custom_metric_name,c.exercise_name,c.metric),'Условие',c.operation,'Цель',c.target_value,'От',c.range_min,'До',c.range_max,'Единица',c.unit) order by c.position,c.id) from public.goal_criteria c where c.goal_id=t.id and c.archived_at is null)),
      jsonb_build_object('Название',s.title,'Срок',s.target_date,
        'Этапы',(select jsonb_agg(jsonb_build_object('Название',g.title,'С',g.starts_on,'По',g.ends_on) order by g.position,g.id) from public.goal_stages g where g.goal_id=s.id),
        'Критерии',(select jsonb_agg(jsonb_build_object('Показатель',coalesce(c.custom_metric_name,c.exercise_name,c.metric),'Условие',c.operation,'Цель',c.target_value,'От',c.range_min,'До',c.range_max,'Единица',c.unit) order by c.position,c.id) from public.goal_criteria c where c.goal_id=s.id and c.archived_at is null)),
      'goal',t.id,s.id,'status'
    from public.client_goals s cross join public.client_goals t
    where s.client_id=p_source and t.client_id=p_target and s.status='active' and t.status='active'
    union all
    select 'workout:'||s.id,'Текущая тренировка',
      jsonb_build_object('date',t.workout_date,'startedAt',t.started_at,'title',to_jsonb(t)->'title',
        'Упражнения',(select jsonb_agg(jsonb_build_object('Название',e.exercise_name,'Подходы',
          (select jsonb_agg(jsonb_build_object('Вес, кг',v.fact_weight_kg,'Повторы',v.fact_reps,'Дистанция, км',v.fact_distance_km,'Время, сек',v.fact_duration_sec,'Время, мин',v.fact_duration_min,'Подтверждён',v.confirmed_at is not null) order by v.position,v.id) from public.workout_sets v where v.workout_exercise_id=e.id)) order by e.position,e.id) from public.workout_exercises e where e.workout_id=t.id)),
      jsonb_build_object('date',s.workout_date,'startedAt',s.started_at,'title',to_jsonb(s)->'title',
        'Упражнения',(select jsonb_agg(jsonb_build_object('Название',e.exercise_name,'Подходы',
          (select jsonb_agg(jsonb_build_object('Вес, кг',v.fact_weight_kg,'Повторы',v.fact_reps,'Дистанция, км',v.fact_distance_km,'Время, сек',v.fact_duration_sec,'Время, мин',v.fact_duration_min,'Подтверждён',v.confirmed_at is not null) order by v.position,v.id) from public.workout_sets v where v.workout_exercise_id=e.id)) order by e.position,e.id) from public.workout_exercises e where e.workout_id=s.id)),
      'workout',t.id,s.id,'status'
    from public.workouts s cross join public.workouts t
    where s.client_id=p_source and t.client_id=p_target and s.status='in_progress' and t.status='in_progress'
      and s.deleted_at is null and t.deleted_at is null
    union all
    select 'summary:'||s.id,'Отчёт · '||s.period_start||' — '||s.period_end,
      to_jsonb(t.client_summary),to_jsonb(s.client_summary),'summary',t.id,s.id,'summary'
    from public.client_training_summaries s join public.client_training_summaries t
      on t.period_start=s.period_start and t.period_end=s.period_end and t.prompt_version=s.prompt_version
    where s.client_id=p_source and t.client_id=p_target and s.merge_superseded_at is null and t.merge_superseded_at is null
    union all
    select 'published:'||s.id,'Опубликованный отчёт · '||s.period_start||' — '||s.period_end,
      to_jsonb(t.summary),to_jsonb(s.summary),'published',t.id,s.id,'summary'
    from public.client_published_training_summaries s join public.client_published_training_summaries t
      on t.period_start=s.period_start and t.period_end=s.period_end
    where s.client_id=p_source and t.client_id=p_target and s.merge_superseded_at is null and t.merge_superseded_at is null
  ) select coalesce(jsonb_agg(to_jsonb(conflicts) order by key),'[]') from conflicts;
$$;
revoke all on function app_private.client_merge_conflicts(uuid,uuid) from public,fit_api;

do $$ begin
  if to_regprocedure('app_private.preview_trainer_connection_before_merge_choices(text,text)') is null then
    alter function app_private.preview_trainer_connection(text,text) rename to preview_trainer_connection_before_merge_choices;
  end if;
end $$;
revoke all on function app_private.preview_trainer_connection_before_merge_choices(text,text) from public,fit_api;
create or replace function app_private.preview_trainer_connection(p_source text,p_locator text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; source_id uuid; conflicts jsonb;
begin
  result:=app_private.preview_trainer_connection_before_merge_choices(p_source,p_locator);
  if p_source in ('link','code') then
    select client_id into source_id from public.client_invitations where id=(result->>'offerVersion')::uuid;
    if exists(select 1 from public.client_trainer_relationships where client_id=source_id) then
      raise exception 'connection_offer_unavailable' using errcode='PT409';
    end if;
    if source_id is distinct from (result->>'clientId')::uuid then
      conflicts:=app_private.client_merge_conflicts(source_id,(result->>'clientId')::uuid);
      result:=result||jsonb_build_object('mergeVersion',encode(sha256(convert_to(conflicts::text,'UTF8')),'hex'),
        'mergeConflicts',conflicts);
    end if;
  end if;
  return result;
end $$;
revoke all on function app_private.preview_trainer_connection(text,text) from public;
grant execute on function app_private.preview_trainer_connection(text,text) to fit_api;

-- Extend only the two report collision checks; all legacy identity,
-- membership, authored-workout and dependency guards remain unchanged.
do $$
declare definition text:=pg_get_functiondef('public.claim_client_invitation(text)'::regprocedure);
  needle text:='where source_summary.client_id = source_client.id';
begin
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
    raise exception 'client_merge_report_guard_definition_changed';
  end if;
  if position('source_summary.merge_superseded_at' in definition)=0 then
    execute replace(definition,needle,needle||' and source_summary.merge_superseded_at is null and target_summary.merge_superseded_at is null');
  end if;
end $$;

-- Existing report writers target only the current version of a period.
do $$
declare target regprocedure; definition text;
begin
  for target in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('save_generated_training_summary','publish_training_summary','publish_cached_training_summary_for_client')
  loop
    definition:=pg_get_functiondef(target);
    if position('on conflict (client_id, period_start, period_end, prompt_version) where merge_superseded_at is null' in definition)=0 then
      definition:=replace(definition,'on conflict (client_id, period_start, period_end, prompt_version)',
      'on conflict (client_id, period_start, period_end, prompt_version) where merge_superseded_at is null');
    end if;
    if position('on conflict (client_id, period_start, period_end) where merge_superseded_at is null' in definition)=0 then
      definition:=replace(definition,'on conflict (client_id, period_start, period_end)',
      'on conflict (client_id, period_start, period_end) where merge_superseded_at is null');
    end if;
    if position('where merge_superseded_at is null and id = p_summary_id' in definition)=0 then
      definition:=replace(definition,'where id = p_summary_id','where merge_superseded_at is null and id = p_summary_id');
    end if;
    if position('where summary.merge_superseded_at is null and summary.client_id = p_client_id' in definition)=0 then
      definition:=replace(definition,'where summary.client_id = p_client_id',
        'where summary.merge_superseded_at is null and summary.client_id = p_client_id');
    end if;
    execute definition;
  end loop;
end $$;

create or replace function app_private.resolve_client_merge(p_source uuid,p_target uuid,p_conflicts jsonb,p_choices jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare conflict jsonb; keep_card boolean; loser uuid; custom_row record;
begin
  set constraints all deferred;
  for conflict in select value from jsonb_array_elements(p_conflicts) loop
    keep_card:=p_choices->>(conflict->>'key')='card';
    loser:=(case when keep_card then conflict->>'account_id' else conflict->>'card_id' end)::uuid;
    case conflict->>'kind'
      when 'profile' then
        if keep_card then execute format('update public.clients t set %1$I=s.%1$I, version=t.version+1 from public.clients s where t.id=$1 and s.id=$2',conflict->>'field') using p_target,p_source; end if;
        if keep_card and conflict->>'field'='age_years' then update public.clients t set age_updated_at=s.age_updated_at from public.clients s where t.id=p_target and s.id=p_source; end if;
      when 'progress' then
        if keep_card then execute format('update public.client_progress t set %1$I=s.%1$I,version=t.version+1 from public.client_progress s where t.id=$1 and s.id=$2',conflict->>'field') using (conflict->>'account_id')::uuid,(conflict->>'card_id')::uuid; end if;
      when 'custom' then
        if keep_card then update public.client_progress_custom t set value=s.value from public.client_progress_custom s where t.id=(conflict->>'account_id')::uuid and s.id=(conflict->>'card_id')::uuid; end if;
      when 'metric' then update public.client_custom_metrics set archived_at=now(),version=version+1 where id=loser;
      when 'goal' then update public.client_goals set status='archived',archived_at=now(),version=version+1 where id=loser;
      when 'workout' then
        -- Preserve original timing privately while the single-current-session
        -- invariant makes the other workout available for a later resume.
        insert into app_private.merge_suspended_workouts(workout_id,started_at,started_by,paused_since)
          select id,started_at,started_by,coalesce(paused_at,now()) from public.workouts where id=loser
          on conflict(workout_id) do update set started_at=excluded.started_at,started_by=excluded.started_by,
            paused_since=excluded.paused_since,resumed_at=null;
        update public.workouts set status='planned',started_at=null,paused_at=null,version=version+1 where id=loser;
      when 'summary' then update public.client_training_summaries set merge_superseded_at=now() where id=loser;
      when 'published' then update public.client_published_training_summaries set merge_superseded_at=now() where id=loser;
      else raise exception 'connection_changed' using errcode='PT409';
    end case;
  end loop;

  -- Missing values are not conflicts and must not disappear behind the chosen base.
  update public.clients t set gender=coalesce(t.gender,s.gender),age_years=coalesce(t.age_years,s.age_years),
    age_updated_at=case when t.age_years is null then s.age_updated_at else t.age_updated_at end,height_cm=coalesce(t.height_cm,s.height_cm),
    goal=coalesce(t.goal,s.goal),version=t.version+1
    from public.clients s where t.id=p_target and s.id=p_source;

  -- Same name and unit are one metric. Keep the original metric row archived,
  -- reusing its canonical counterpart for values without deleting any value row.
  for custom_row in select s.id source_id,t.id target_id
    from public.client_custom_metrics s join public.client_custom_metrics t
      on lower(btrim(s.name))=lower(btrim(t.name))
      and nullif(lower(btrim(s.unit)),'') is not distinct from nullif(lower(btrim(t.unit)),'')
    where s.client_id=p_source and t.client_id=p_target and s.archived_at is null and t.archived_at is null
  loop
    update public.client_progress_custom set metric_id=custom_row.target_id where metric_id=custom_row.source_id;
    update public.goal_criteria set custom_metric_id=custom_row.target_id where custom_metric_id=custom_row.source_id;
    update public.client_custom_metrics set archived_at=now(),version=version+1 where id=custom_row.source_id;
  end loop;

  -- Consolidate each date field by field, retaining the complete source row as
  -- a superseded measurement. All distinct custom values remain stored.
  for custom_row in select s.id source_id,t.id target_id from public.client_progress s
    join public.client_progress t on t.recorded_on=s.recorded_on
    where s.client_id=p_source and t.client_id=p_target and s.deleted_at is null and t.deleted_at is null
  loop
    update public.client_progress t set weight_kg=coalesce(t.weight_kg,s.weight_kg),chest_cm=coalesce(t.chest_cm,s.chest_cm),
      waist_cm=coalesce(t.waist_cm,s.waist_cm),hip_cm=coalesce(t.hip_cm,s.hip_cm),
      notes=coalesce(t.notes,s.notes),inbody_data=coalesce(t.inbody_data,s.inbody_data),version=t.version+1
      from public.client_progress s where t.id=custom_row.target_id and s.id=custom_row.source_id;
    update public.client_progress_custom s set progress_id=custom_row.target_id
      where s.progress_id=custom_row.source_id and not exists(select 1 from public.client_progress_custom t
        where t.progress_id=custom_row.target_id and t.metric_id=s.metric_id);
    update public.client_progress set deleted_at=now(),version=version+1 where id=custom_row.source_id;
  end loop;
end $$;
revoke all on function app_private.resolve_client_merge(uuid,uuid,jsonb,jsonb) from public,fit_api;

create or replace function app_private.confirm_trainer_connection(p_source text,p_locator text,
  p_expected_relationship uuid,p_offer_version text,p_operation_id uuid,p_share_history boolean,p_share_solo_history boolean,
  p_merge_version text,p_merge_choices jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare preview jsonb; conflicts jsonb; source_id uuid; target_id uuid; result_id uuid;
  receipt app_private.client_merge_choices%rowtype; choices jsonb:=coalesce(p_merge_choices,'{}');
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_role='client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  if jsonb_typeof(choices)<>'object' then raise exception 'connection_invalid' using errcode='PT422'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||auth.uid()::text,0));
  select * into receipt from app_private.client_merge_choices where actor_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.choices<>choices or receipt.preview_version is distinct from p_merge_version then
      raise exception 'connection_changed' using errcode='PT409';
    end if;
    return app_private.confirm_trainer_connection(p_source,p_locator,p_expected_relationship,p_offer_version,p_operation_id,p_share_history,p_share_solo_history);
  end if;
  if exists(select 1 from app_private.trainer_connection_receipts where actor_id=auth.uid() and operation_id=p_operation_id) then
    if choices<>'{}'::jsonb or p_merge_version is not null then raise exception 'connection_changed' using errcode='PT409'; end if;
    return app_private.confirm_trainer_connection(p_source,p_locator,p_expected_relationship,p_offer_version,p_operation_id,p_share_history,p_share_solo_history);
  end if;
  -- Serialize the short comparison/apply transaction with writes, including new
  -- rows on a previously empty date. Never accept a stale per-field decision.
  lock table public.clients,public.client_progress,public.client_progress_custom,public.client_custom_metrics,
    public.client_goals,public.goal_criteria,public.goal_stages,public.workouts,public.workout_exercises,public.workout_sets,public.client_training_summaries,
    public.client_published_training_summaries in share row exclusive mode;
  preview:=app_private.preview_trainer_connection(p_source,p_locator);
  if (preview->>'currentRelationshipId')::uuid is distinct from p_expected_relationship
    or preview->>'offerVersion' is distinct from p_offer_version then
    raise exception 'connection_changed' using errcode='PT409';
  end if;
  conflicts:=coalesce(preview->'mergeConflicts','[]');
  if jsonb_array_length(conflicts)>0 and preview->>'mergeVersion' is distinct from p_merge_version
    or p_merge_version is not null and preview->>'mergeVersion' is distinct from p_merge_version then
    raise exception 'connection_changed' using errcode='PT409';
  end if;
  if exists(select 1 from jsonb_array_elements(conflicts) c where coalesce(choices->>(c->>'key'),'') not in ('account','card'))
    or exists(select 1 from jsonb_object_keys(choices) k where not exists(select 1 from jsonb_array_elements(conflicts) c where c->>'key'=k)) then
    raise exception 'merge_choices_required' using errcode='PT409';
  end if;
  target_id:=(preview->>'clientId')::uuid;
  if p_source in ('link','code') then
    select client_id into source_id from public.client_invitations where id=p_offer_version::uuid;
    if source_id is distinct from target_id then
      insert into app_private.client_merge_choices(actor_id,operation_id,client_id,source_client_id,preview_version,choices,conflicts,original_values)
        values(auth.uid(),p_operation_id,target_id,source_id,p_merge_version,choices,conflicts,jsonb_build_object(
          'clients',(select jsonb_agg(to_jsonb(r) order by r.id) from public.clients r where r.id in (target_id,source_id)),
          'progress',(select jsonb_agg(to_jsonb(r) order by r.id) from public.client_progress r where r.client_id in (target_id,source_id)),
          'customValues',(select jsonb_agg(to_jsonb(r) order by r.id) from public.client_progress_custom r where r.client_id in (target_id,source_id)),
          'metrics',(select jsonb_agg(to_jsonb(r) order by r.id) from public.client_custom_metrics r where r.client_id in (target_id,source_id)),
          'goals',(select jsonb_agg(to_jsonb(r) order by r.id) from public.client_goals r where r.client_id in (target_id,source_id)),
          'currentWorkouts',(select jsonb_agg(to_jsonb(r) order by r.id) from public.workouts r where r.client_id in (target_id,source_id) and r.status='in_progress')
        ));
      perform app_private.resolve_client_merge(source_id,target_id,conflicts,choices);
    end if;
  end if;
  result_id:=app_private.confirm_trainer_connection(p_source,p_locator,p_expected_relationship,p_offer_version,p_operation_id,p_share_history,p_share_solo_history);
  return result_id;
end $$;
revoke all on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean,boolean,text,jsonb) from public;
grant execute on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean,boolean,text,jsonb) to fit_api;

do $$ begin
  if to_regprocedure('app_private.start_live_workout_before_merge_resume(uuid,bigint,uuid)') is null then
    alter function public.start_live_workout(uuid,bigint,uuid) rename to start_live_workout_before_merge_resume;
    alter function public.start_live_workout_before_merge_resume(uuid,bigint,uuid) set schema app_private;
  end if;
end $$;
revoke all on function app_private.start_live_workout_before_merge_resume(uuid,bigint,uuid) from public,fit_api;
create or replace function public.start_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid)
returns table(version bigint,replayed boolean) language plpgsql security definer set search_path='' as $$
declare result record; timing app_private.merge_suspended_workouts%rowtype;
begin
  select * into result from app_private.start_live_workout_before_merge_resume(p_workout_id,p_expected_version,p_operation_id);
  if not result.replayed then
    select * into timing from app_private.merge_suspended_workouts where workout_id=p_workout_id and resumed_at is null for update;
    if found then
      update public.workouts w set started_at=timing.started_at,started_by=timing.started_by,
        paused_seconds=w.paused_seconds+greatest(0,round(extract(epoch from now()-timing.paused_since)))::integer
        where w.id=p_workout_id;
      update app_private.merge_suspended_workouts set resumed_at=now() where workout_id=p_workout_id;
    end if;
  end if;
  return query select result.version::bigint,result.replayed::boolean;
end $$;
revoke all on function public.start_live_workout(uuid,bigint,uuid) from public;
grant execute on function public.start_live_workout(uuid,bigint,uuid) to fit_api;

-- Down Migration
-- Forward-only: chosen and superseded data and choice receipts are retained.
