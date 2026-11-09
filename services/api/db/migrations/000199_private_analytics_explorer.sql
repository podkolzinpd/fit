-- Up Migration

-- Only metadata of successful operations; never messages, meals or health values.
create table if not exists app_private.analytics_observation_start (id boolean primary key default true check(id), started_at timestamptz not null default now());
insert into app_private.analytics_observation_start default values on conflict do nothing;
create table if not exists app_private.analytics_actions (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null,
  action text not null,
  entity_id text not null,
  client_id uuid,
  trainer_id uuid,
  occurred_at timestamptz not null default now(),
  transaction_id bigint not null default txid_current(),
  unique (actor_id, feature, action, entity_id, transaction_id)
);
create index if not exists analytics_actions_actor_time on app_private.analytics_actions(actor_id, occurred_at);
create index if not exists analytics_actions_time on app_private.analytics_actions(occurred_at);
alter table app_private.analytics_actions enable row level security;
revoke all on app_private.analytics_actions, app_private.analytics_observation_start from public, fit_api;

create function app_private.record_analytics_action() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(new); previous jsonb; actor uuid := auth.uid(); workout uuid;
begin
  if actor is null then return new; end if;
  if TG_OP = 'UPDATE' then
    previous := to_jsonb(old);
    if (r - array['updated_at','version','client_id','trainer_id']) = (previous - array['updated_at','version','client_id','trainer_id']) then return new; end if;
  end if;
  if TG_TABLE_NAME = 'workout_sets' then
    select e.workout_id into workout from public.workout_exercises e where e.id=new.workout_exercise_id;
  elsif TG_TABLE_NAME = 'workout_exercises' then
    workout := new.workout_id;
  end if;
  if workout is not null then
    select jsonb_build_object('id',w.id,'client_id',w.client_id,'trainer_id',w.trainer_id) into r from public.workouts w where w.id=workout;
  end if;
  if r->>'client_id' is not null and exists(select 1 from app_private.fit_lime_calendar_clients c where c.client_id=(r->>'client_id')::uuid) then return new; end if;
  insert into app_private.analytics_actions(actor_id,feature,action,entity_id,client_id,trainer_id)
  values(actor,TG_ARGV[0],case when TG_OP='INSERT' then 'created' else 'updated' end,
    r->>'id',nullif(r->>'client_id','')::uuid,nullif(r->>'trainer_id','')::uuid)
  on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.record_analytics_action() from public, fit_api;
create trigger analytics_action after insert or update on public.workouts for each row execute function app_private.record_analytics_action('workouts');
create trigger analytics_action after insert or update on public.workout_sets for each row execute function app_private.record_analytics_action('workouts');
create trigger analytics_action after insert or update on public.workout_exercises for each row execute function app_private.record_analytics_action('workouts');
create trigger analytics_action after insert or update on public.nutrition_entries for each row execute function app_private.record_analytics_action('nutrition');
create trigger analytics_action after insert or update on public.workout_templates for each row execute function app_private.record_analytics_action('templates');
create trigger analytics_action after insert or update on public.client_progress for each row execute function app_private.record_analytics_action('progress');
create trigger analytics_action after insert or update on public.client_goals for each row execute function app_private.record_analytics_action('goals');
create trigger analytics_action after insert or update on public.custom_exercises for each row execute function app_private.record_analytics_action('custom_exercises');
create trigger analytics_action after insert or update on public.trainer_finance_packages for each row execute function app_private.record_analytics_action('finance');
create trigger analytics_action after insert or update on public.trainer_finance_payments for each row execute function app_private.record_analytics_action('finance');

-- Called after the existing consent/access checks. One successful read per actor,
-- target and Moscow day, so refetches do not inflate usage.
create function app_private.record_nutrition_view(p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  select auth_user_id into target from public.clients where id=p_client and archived_at is null and merged_into_client_id is null;
  if target is null or not public.can_read_nutrition(target) or not exists(select 1 from public.profiles where id=auth.uid() and account_role='trainer') then
    raise exception using errcode='PT403', message='nutrition_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_client::text, 198));
  if not exists(select 1 from app_private.analytics_actions where actor_id=auth.uid() and feature='nutrition_views' and entity_id=p_client::text and occurred_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow') then
    insert into app_private.analytics_actions(actor_id,feature,action,entity_id,client_id,trainer_id)
    values(auth.uid(),'nutrition_views','viewed',p_client::text,p_client,auth.uid());
  end if;
end $$;
revoke all on function app_private.record_nutrition_view(uuid) from public;
grant execute on function app_private.record_nutrition_view(uuid) to fit_api;

create view app_private.analytics_people as
select p.id::text as id, p.id as profile_id,
  coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),'Без имени') as name,
  p.account_role as role, p.created_at as registered_at,
  case when p.account_role='trainer' then 'trainer' when exists(select 1 from public.clients c where c.auth_user_id=p.id and c.trainer_id=p.id) then 'self' else 'connected' end as registration
from public.profiles p
where not exists(select 1 from public.clients c join app_private.fit_lime_calendar_clients f on f.client_id=c.id where c.auth_user_id=p.id)
union all
select 'card:'||c.id, null::uuid, c.full_name,'offline',c.created_at,'trainer'
from app_private.fit_lime_real_clients c where c.auth_user_id is null and c.merged_into_client_id is null;

-- Historical creation evidence is separate from the complete post-release audit.
-- Neither updated_at nor the owner of a workout establishes its acting author.
create view app_private.analytics_activity as
select 'audit:'||a.id as id,a.actor_id,a.feature,a.action,a.entity_id,a.client_id,a.trainer_id,a.occurred_at,'observed'::text as evidence
from app_private.analytics_actions a
where not exists(select 1 from app_private.fit_lime_calendar_clients f where f.client_id=a.client_id)
union all select 'workouts:'||w.id,w.created_by,'workouts','created',w.id::text,w.client_id,w.trainer_id,w.created_at,'historical_creation' from public.workouts w where w.created_by is not null and w.deleted_at is null and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'nutrition:'||w.id,w.owner_id,'nutrition','created',w.id::text,null::uuid,null::uuid,w.created_at,'historical_creation' from public.nutrition_entries w where w.owner_id is not null and w.deleted_at is null and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'templates:'||w.id,w.trainer_id,'templates','created',w.id::text,null::uuid,w.trainer_id,w.created_at,'historical_creation' from public.workout_templates w where w.trainer_id is not null and true and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'progress:'||w.id,w.created_by,'progress','created',w.id::text,w.client_id,w.trainer_id,w.created_at,'historical_creation' from public.client_progress w where w.created_by is not null and w.deleted_at is null and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'goals:'||w.id,w.created_by,'goals','created',w.id::text,w.client_id,w.trainer_id,w.created_at,'historical_creation' from public.client_goals w where w.created_by is not null and true and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'custom_exercises:'||w.id,w.created_by,'custom_exercises','created',w.id::text,null::uuid,w.trainer_id,w.created_at,'historical_creation' from public.custom_exercises w where w.created_by is not null and true and w.created_at < (select started_at from app_private.analytics_observation_start)
union all select 'assistant:'||m.id,c.owner_id,'assistant','sent',m.id::text,null::uuid,null::uuid,m.created_at,'source_record' from public.assistant_messages m join public.assistant_conversations c on c.id=m.conversation_id where m.author='user'
union all select 'chat:'||m.id,m.sender_id,'chat','sent',m.id::text,c.client_id,c.trainer_id,m.created_at,'source_record' from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id
union all select 'program:'||g.id,g.owner_id,'programs','requested',g.id::text,g.client_id,null::uuid,g.created_at,'source_record' from private.assistant_program_generations g
union all select 'feedback:'||f.id,f.user_id,'feedback','sent',f.id::text,null::uuid,null::uuid,f.created_at,'source_record' from public.app_feedback f;

-- Typed projection shared by totals, rankings, pages and export. Private bodies
-- of messages and health measurements are deliberately absent.
create view app_private.analytics_records as
select 'activities'::text as dataset,a.id,a.actor_id::text as person_id,a.client_id,a.trainer_id,
  (a.occurred_at at time zone 'Europe/Moscow')::date as day,a.feature,
  jsonb_build_object('id',a.id,'person_id',a.actor_id,'feature',a.feature,'action',a.action,'source_id',a.entity_id,'date',a.occurred_at,'evidence',a.evidence) as data
from app_private.analytics_activity a
where not exists(select 1 from app_private.fit_lime_calendar_clients f where f.client_id=a.client_id)
union all
select 'workouts',w.id::text,coalesce(c.auth_user_id::text,'card:'||c.id),w.client_id,w.trainer_id,w.workout_date,'workouts',
 jsonb_build_object('id',w.id,'person_id',coalesce(c.auth_user_id::text,'card:'||c.id),'date',w.workout_date,'status',w.status,'format',w.training_format,'trainer_id',w.trainer_id,'client',c.full_name,'created_by',w.created_by,'completed_at',w.completed_at)
from app_private.fit_lime_real_workouts w join public.clients c on c.id=w.client_id where w.deleted_at is null
union all
select 'nutrition',n.id::text,n.owner_id::text,null::uuid,null::uuid,n.day,'nutrition',
 jsonb_build_object('id',n.id,'person_id',n.owner_id,'date',n.day,'created_at',n.created_at,'meal',n.meal,'name',n.name,'calories',n.calories * case when n.basis='100g' then n.grams/100 else 1 end)
from public.nutrition_entries n where n.deleted_at is null
union all
select 'payments',p.id::text,p.trainer_id::text,p.client_id,p.trainer_id,p.received_on,'finance',
 jsonb_build_object('id',p.id,'person_id',p.trainer_id,'date',p.received_on,'client',c.full_name,'client_person_id',coalesce(c.auth_user_id::text,'card:'||c.id),'amount',p.amount_cents/100.0,'source',p.source,'package_id',p.package_id)
from public.trainer_finance_payments p join app_private.fit_lime_real_clients c on c.id=p.client_id where p.voided_at is null
union all
select 'packages',p.id::text,p.trainer_id::text,p.client_id,p.trainer_id,p.starts_on,'finance',
 jsonb_build_object('id',p.id,'person_id',p.trainer_id,'date',p.starts_on,'name',p.title,'client',c.full_name,'price',p.price_cents/100.0,'paid',paid.amount/100.0,
 'due',case when p.closed_at is null then greatest(p.price_cents-paid.amount,0)/100.0 else 0 end,
 'overdue',case when p.closed_at is null and p.payment_due_on < (now() at time zone tz.timezone)::date then greatest(p.price_cents-paid.amount,0)/100.0 else 0 end,
 'remaining',case when p.kind='session_pack' then greatest(p.sessions_total-p.opening_used_sessions-used.n,0) else null end,'status',case when p.closed_at is null then 'open' else 'closed' end,'payment_due_on',p.payment_due_on)
from public.trainer_finance_packages p join app_private.fit_lime_real_clients c on c.id=p.client_id join public.profiles tz on tz.id=p.trainer_id
cross join lateral(select coalesce(sum(amount_cents),0) amount from public.trainer_finance_payments x where x.package_id=p.id and x.voided_at is null) paid
cross join lateral(select count(*) n from public.trainer_finance_sessions x where x.package_id=p.id and x.disposition='charged' and x.voided_at is null) used
union all
select 'exercises',e.id::text,coalesce(c.auth_user_id::text,'card:'||c.id),w.client_id,w.trainer_id,w.workout_date,'exercises',
 jsonb_build_object('id',e.id,'person_id',coalesce(c.auth_user_id::text,'card:'||c.id),'date',w.workout_date,'name',e.exercise_name,'exercise_key',e.exercise_source||':'||coalesce(e.custom_exercise_id::text,e.exercise_ref),'source',e.exercise_source,'workout_id',w.id,'sets',sets.n)
from public.workout_exercises e join app_private.fit_lime_real_workouts w on w.id=e.workout_id join public.clients c on c.id=w.client_id
cross join lateral(select count(*) n from public.workout_sets x where x.workout_exercise_id=e.id and x.confirmed_at is not null) sets
where w.status='done' and w.deleted_at is null
union all
select 'sets',x.id::text,coalesce(c.auth_user_id::text,'card:'||c.id),w.client_id,w.trainer_id,w.workout_date,'workouts',
 jsonb_build_object('id',x.id,'person_id',coalesce(c.auth_user_id::text,'card:'||c.id),'date',w.workout_date,'name',e.exercise_name,'workout_id',w.id,'position',x.position+1,'plan_weight',x.plan_weight_kg,'fact_weight',x.fact_weight_kg,'plan_reps',x.plan_reps,'fact_reps',x.fact_reps,'plan_duration',coalesce(x.plan_duration_sec,x.plan_duration_min*60),'fact_duration',coalesce(x.fact_duration_sec,x.fact_duration_min*60),'plan_distance',x.plan_distance_km,'fact_distance',x.fact_distance_km,'confirmed_at',x.confirmed_at,'status',w.status)
from public.workout_sets x join public.workout_exercises e on e.id=x.workout_exercise_id join app_private.fit_lime_real_workouts w on w.id=e.workout_id join public.clients c on c.id=w.client_id where w.deleted_at is null
union all
select 'feedback',f.id::text,f.user_id::text,null::uuid,null::uuid,(f.created_at at time zone 'Europe/Moscow')::date,'feedback',
 jsonb_build_object('id',f.id,'person_id',f.user_id,'date',f.created_at,'message',f.message,'kind',f.kind,'screen_path',f.screen_path)
from public.app_feedback f;
revoke all on app_private.analytics_people,app_private.analytics_activity,app_private.analytics_records from public,fit_api;

create function app_private.private_analytics_explore(p jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  date_from date := (p->>'from')::date; date_to date := (p->>'to')::date;
  section text := coalesce(p->>'section','people'); sort_key text := coalesce(p->>'sort','name');
  page_number integer := coalesce((p->>'page')::integer,1); page_size integer := coalesce((p->>'pageSize')::integer,50);
  regular_days integer := coalesce((p->>'regularDays')::integer,2); result jsonb;
begin
  if not app_private.is_private_analytics_allowed() then raise exception using errcode='PT403',message='analytics_forbidden'; end if;
  if date_from is null or date_to is null or date_to<date_from or date_to-date_from>1095 or page_number<1 or page_size not between 1 and 500 or regular_days not between 1 and 7
    or section not in ('people','activities','workouts','nutrition','payments','packages','exercises','exercise_detail','features','feedback','sets')
    or coalesce(p->>'group','day') not in ('day','week','month') then
    raise exception using errcode='PT422',message='analytics_invalid';
  end if;
  with scoped_people as materialized (
    select person.* from app_private.analytics_people person where
      (coalesce(p->>'role','')='' or person.role=p->>'role')
      and (coalesce(p->>'person','')='' or person.id=p->>'person')
      and (coalesce(p->>'registration','')='' or person.registration=p->>'registration')
      and (coalesce(p->>'trainer','')='' or person.id=p->>'trainer' or exists(
        select 1 from app_private.fit_lime_real_clients c where coalesce(c.auth_user_id::text,'card:'||c.id)=person.id and (c.trainer_id::text=p->>'trainer' or exists(select 1 from public.client_trainers m where m.client_id=c.id and m.trainer_id::text=p->>'trainer'))))
  ), records as materialized (
    select r.*,person.name as person,person.role,
      r.data||jsonb_build_object('person',person.name,'role',person.role,'trainer',trim(concat_ws(' ',coach.first_name,coach.last_name))) as row
    from app_private.analytics_records r join app_private.analytics_people person on person.id=r.person_id
    left join public.profiles coach on coach.id=r.trainer_id
    where (r.dataset='packages' or r.day between least(date_from-(date_to-date_from+1),date_to-29) and date_to)
      and (r.dataset<>'sets' or section='sets')
      and (r.dataset<>'exercises' or section in ('exercises','exercise_detail'))
      and (r.dataset<>'feedback' or section='feedback')
      and (person.id in (select id from scoped_people) or (r.dataset<>'activities' and r.trainer_id::text in (select id from scoped_people where role='trainer')) or (coalesce(p->>'person','')<>'' and r.dataset<>'activities' and
      (r.trainer_id::text=p->>'person' or exists(select 1 from public.clients subject where subject.id=r.client_id and coalesce(subject.auth_user_id::text,'card:'||subject.id)=p->>'person'))))
      and (coalesce(p->>'feature','')='' or r.feature=p->>'feature')
      and (coalesce(p->>'trainer','')='' or r.person_id=p->>'trainer' or r.trainer_id::text=p->>'trainer' or exists(select 1 from app_private.fit_lime_real_clients c where c.auth_user_id::text=r.person_id and exists(select 1 from public.client_trainers m where m.client_id=c.id and m.trainer_id::text=p->>'trainer')))
  ), period as materialized (
    select * from records where day between date_from and date_to
  ), activity as materialized (
    select * from period where dataset='activities'
  ), people_rows as (
    select jsonb_build_object('id',person.id,'person_id',person.id,'person',person.name,'name',person.name,'role',person.role,'date',person.registered_at,'registration',person.registration,
      'new', (person.registered_at at time zone 'Europe/Moscow')::date between date_from and date_to,
      'actions',count(a.id),'active_days',count(distinct a.day),'last_active_at',max(a.data->>'date'),
      'days7',(select count(distinct x.day) from records x where x.dataset='activities' and x.person_id=person.id and x.day between date_to-6 and date_to),
      'workouts',(select count(*) from period w where w.dataset='workouts' and w.person_id=person.id and w.data->>'status'='done'),
      'authored_workouts',(select count(*) from period w where w.dataset='workouts' and w.data->>'created_by'=person.id and w.data->>'status'='done'),
      'clients_total',(select count(distinct c.id) from app_private.fit_lime_real_clients c where c.merged_into_client_id is null and c.auth_user_id is distinct from person.profile_id and (c.trainer_id=person.profile_id or exists(select 1 from public.client_trainers m where m.client_id=c.id and m.trainer_id=person.profile_id))),
      'meals',(select count(*) from period n where n.dataset='nutrition' and n.person_id=person.id),
      'received',(select coalesce(sum((n.data->>'amount')::numeric),0) from period n where n.dataset='payments' and n.person_id=person.id and n.data->>'source'<>'opening')
    ) as row from scoped_people person left join activity a on a.person_id=person.id group by person.id,person.name,person.role,person.registered_at,person.registration,person.profile_id
  ), feature_rows as (
    select jsonb_build_object('id',f.feature,'name',f.feature,'feature',f.feature,'actions',count(a.id),'users',count(distinct a.person_id),'trainers',count(distinct a.person_id) filter(where a.role='trainer'),'clients',count(distinct a.person_id) filter(where a.role='client'),'active_days',count(distinct a.day)) as row
    from (values ('workouts'),('nutrition'),('nutrition_views'),('templates'),('progress'),('goals'),('custom_exercises'),('assistant'),('chat'),('programs'),('feedback'),('finance')) f(feature)
    left join activity a on a.feature=f.feature where coalesce(p->>'feature','')='' or f.feature=p->>'feature' group by f.feature
  ), exercise_rows as (
    select jsonb_build_object('id',data->>'exercise_key','exercise_key',data->>'exercise_key','name',max(data->>'name'),'source',max(data->>'source'),'workouts',count(distinct data->>'workout_id'),'users',count(distinct person_id),'sets',sum((data->>'sets')::bigint)) as row from period where dataset='exercises' group by data->>'exercise_key'
  ), selected as (
    select row from people_rows where section='people' and (coalesce(p->>'cohort','')='' or (p->>'cohort'='accounts' and row->>'role'<>'offline') or (p->>'cohort'='new' and (row->>'new')::boolean and row->>'role'<>'offline') or (p->>'cohort'='active' and (row->>'actions')::int>0))
    union all select row from feature_rows where section='features'
    union all select row from exercise_rows where section='exercises'
    union all select row from period where dataset=section and (coalesce(p->>'status','')='' or data->>'status'=p->>'status') and section not in ('people','features','exercises','packages')
    union all select row from period where section='exercise_detail' and dataset='exercises' and data->>'exercise_key'=p->>'exercise'
    union all select row from records where section='packages' and dataset='packages'
  ), searched as materialized (
    select row from selected where (coalesce(p->>'search','')='' or strpos(lower(row::text),lower(p->>'search'))>0) and (coalesce(p->>'entity','')='' or row->>'id'=p->>'entity') and (coalesce(p->>'workout','')='' or row->>'workout_id'=p->>'workout')
  ), paged as (
    select row from searched order by
      case when p->>'direction'='desc' then nullif(row->sort_key,'null'::jsonb) end desc nulls last,
      case when coalesce(p->>'direction','asc')='asc' then nullif(row->sort_key,'null'::jsonb) end asc nulls last,
      row->>'id' limit page_size offset (page_number-1)::bigint*page_size
  ), days as (
    select generate_series(date_from::timestamp,date_to::timestamp,interval '1 day')::date as day
  ), buckets as (
    select distinct date_trunc(coalesce(p->>'group','day'),days.day)::date as date from days
  ), trend as (
    select b.date,
      (select count(*) from activity a where date_trunc(coalesce(p->>'group','day'),a.day)::date=b.date) as actions,
      (select count(distinct a.person_id) from activity a where date_trunc(coalesce(p->>'group','day'),a.day)::date=b.date) as users,
      (select count(*) from scoped_people person where person.role<>'offline' and (person.registered_at at time zone 'Europe/Moscow')::date between date_from and date_to and date_trunc(coalesce(p->>'group','day'),person.registered_at at time zone 'Europe/Moscow')::date=b.date) as registrations
    from buckets b
  )
  select jsonb_build_object(
    'retentionMeasured',date_to <= (now() at time zone 'Europe/Moscow')::date and date_to-13 > (select (started_at at time zone 'Europe/Moscow')::date from app_private.analytics_observation_start),
    'computedAt',now(),'observationStartedAt',(select started_at from app_private.analytics_observation_start),
    'revision',(select md5(coalesce(string_agg(row::text,'' order by row->>'id'),'')) from searched),
    'total',(select count(*) from searched),'rows',coalesce((select jsonb_agg(row) from paged),'[]'::jsonb),
    'summary',jsonb_build_object(
      'previousActive',(select count(distinct person_id) from records where dataset='activities' and day between date_from-(date_to-date_from+1) and date_from-1),
      'previousNew',(select count(*) from scoped_people where role<>'offline' and (registered_at at time zone 'Europe/Moscow')::date between date_from-(date_to-date_from+1) and date_from-1),
      'previousWorkouts',(select count(*) from records where dataset='workouts' and data->>'status'='done' and day between date_from-(date_to-date_from+1) and date_from-1),
      'previousReceived',(select coalesce(sum((data->>'amount')::numeric),0) from records where dataset='payments' and data->>'source'<>'opening' and day between date_from-(date_to-date_from+1) and date_from-1),
      'retentionBase',(select count(distinct person_id) from records where dataset='activities' and day between date_to-13 and date_to-7),
      'retained',(select count(distinct r.person_id) from records r where r.dataset='activities' and r.day between date_to-13 and date_to-7 and exists(select 1 from records recent where recent.dataset='activities' and recent.person_id=r.person_id and recent.day between date_to-6 and date_to)),
      'accounts',(select count(*) from scoped_people where role<>'offline'),
      'offline',(select count(*) from scoped_people where role='offline'),
      'new',(select count(*) from scoped_people where role<>'offline' and (registered_at at time zone 'Europe/Moscow')::date between date_from and date_to),
      'active',(select count(distinct person_id) from activity),
      'active1',(select count(distinct person_id) from records where dataset='activities' and day=date_to),
      'active7',(select count(distinct person_id) from records where dataset='activities' and day between date_to-6 and date_to),
      'active30',(select count(distinct person_id) from records where dataset='activities' and day between date_to-29 and date_to),
      'regular',(select count(*) from (select person_id from records where dataset='activities' and day between date_to-6 and date_to group by person_id having count(distinct day)>=regular_days) r),
      'workouts',(select count(*) from period where dataset='workouts' and data->>'status'='done'),
      'nutritionUsers',(select count(distinct person_id) from period where dataset='nutrition'),
      'nutritionDays',(select count(distinct (person_id,day)) from period where dataset='nutrition'),
      'nutritionViews',(select count(distinct person_id) from activity where feature='nutrition_views'),
      'received',(select coalesce(sum((data->>'amount')::numeric),0) from period where dataset='payments' and data->>'source'<>'opening'),
      'opening',(select coalesce(sum((data->>'amount')::numeric),0) from period where dataset='payments' and data->>'source'='opening'),
      'due',(select coalesce(sum((data->>'due')::numeric),0) from records where dataset='packages'),
      'overdue',(select coalesce(sum((data->>'overdue')::numeric),0) from records where dataset='packages')
    ),
    'trend',coalesce((select jsonb_agg(to_jsonb(trend) order by date) from trend),'[]'::jsonb),
    'features',coalesce((select jsonb_agg(row order by row->>'id') from feature_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function app_private.private_analytics_explore(jsonb) from public;
grant execute on function app_private.private_analytics_explore(jsonb) to fit_api;

-- Down Migration
-- Preserve observed metadata on rollback; never erase the new history implicitly.
drop function app_private.private_analytics_explore(jsonb);
drop view app_private.analytics_records;
drop view app_private.analytics_activity;
drop view app_private.analytics_people;
drop trigger analytics_action on public.workouts;
drop trigger analytics_action on public.workout_sets;
drop trigger analytics_action on public.workout_exercises;
drop trigger analytics_action on public.nutrition_entries;
drop trigger analytics_action on public.workout_templates;
drop trigger analytics_action on public.client_progress;
drop trigger analytics_action on public.client_goals;
drop trigger analytics_action on public.custom_exercises;
drop trigger analytics_action on public.trainer_finance_packages;
drop trigger analytics_action on public.trainer_finance_payments;
drop function app_private.record_analytics_action();
drop function app_private.record_nutrition_view(uuid);
