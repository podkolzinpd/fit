-- Up Migration

create or replace function app_private.private_analytics_explore(p jsonb) returns jsonb
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
      and (coalesce(p->>'cohort','') not in ('accounts','new','active') or person.role<>'offline')
      and (coalesce(p->>'cohort','')<>'new' or (person.registered_at at time zone 'Europe/Moscow')::date between date_from and date_to)
      and (coalesce(p->>'cohort','')<>'active' or exists (
        select 1 from app_private.analytics_activity a where a.actor_id=person.profile_id
          and (a.occurred_at at time zone 'Europe/Moscow')::date between date_from and date_to
          and (coalesce(p->>'feature','')='' or a.feature=p->>'feature')))

      and (coalesce(p->>'person','')='' or person.id=p->>'person')
      and (coalesce(p->>'registration','')='' or person.registration=p->>'registration')
      and (coalesce(p->>'trainer','')='' or person.id=p->>'trainer' or exists(
        select 1 from app_private.fit_lime_real_clients c where coalesce(c.auth_user_id::text,'card:'||c.id)=person.id and (c.trainer_id::text=p->>'trainer' or exists(select 1 from public.client_trainers m where m.client_id=c.id and m.trainer_id::text=p->>'trainer'))))
  ), records as materialized (
    select r.*,person.name as person,person.role,
      r.data||jsonb_build_object('person',person.name,'role',person.role,'trainer',trim(concat_ws(' ',coach.first_name,coach.last_name))) as row
    from app_private.analytics_records r join app_private.analytics_people person on person.id=r.person_id
    left join public.profiles coach on coach.id=r.trainer_id
    where (coalesce(p->>'cohort','') not in ('active','new','accounts') or exists(select 1 from scoped_people))
      and (r.dataset='packages' or r.day between least(date_from-(date_to-date_from+1),date_to-29) and date_to)
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

create or replace function app_private.private_analytics_explore(p jsonb) returns jsonb
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
