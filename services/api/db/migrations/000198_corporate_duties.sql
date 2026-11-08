-- Up Migration
-- Kept separate from office rows: legacy office commands omit timezone and must
-- neither clear it nor break their existing composite row contract.
create table app_private.corporate_office_time_zones (
  office_id uuid primary key references public.corporate_offices(id),
  time_zone text not null,
  version bigint not null check(version>0)
);
create table app_private.corporate_duty_pilot_trainers (
  profile_id uuid primary key references public.trainers(profile_id),
  enabled boolean not null default false
);
create table app_private.corporate_duties (
  id uuid primary key,
  trainer_id uuid not null references public.profiles(id),
  office_id uuid not null references public.corporate_offices(id),
  office_name text not null, office_city text not null, time_zone text not null,
  started_at timestamptz not null, ended_at timestamptz,
  voided boolean not null default false,
  long_confirmed boolean not null default false,
  version bigint not null default 1 check(version>0),
  check(ended_at is null or ended_at>started_at)
);
create unique index corporate_duty_one_active on app_private.corporate_duties(trainer_id) where ended_at is null and not voided;
create index corporate_duty_history on app_private.corporate_duties(trainer_id,started_at desc,id desc);
create table app_private.corporate_duty_commands (
  id uuid primary key, actor_id uuid not null references public.profiles(id),
  payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table app_private.corporate_duty_audit (
  id bigint generated always as identity primary key,
  duty_id uuid not null references app_private.corporate_duties(id),
  actor_id uuid not null references public.profiles(id),
  occurred_at timestamptz not null default clock_timestamp(),
  action text not null, reason text,
  before_data jsonb, after_data jsonb not null
);
alter table app_private.corporate_office_time_zones enable row level security;
alter table app_private.corporate_duty_pilot_trainers enable row level security;
alter table app_private.corporate_duties enable row level security;
alter table app_private.corporate_duty_commands enable row level security;
alter table app_private.corporate_duty_audit enable row level security;
revoke all on app_private.corporate_office_time_zones,app_private.corporate_duty_pilot_trainers,
  app_private.corporate_duties,app_private.corporate_duty_commands,app_private.corporate_duty_audit from public,fit_api;

create function app_private.corporate_duty_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.corporate_trainers t on t.trainer_id=p.id and t.is_yandex
    join app_private.corporate_duty_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=auth.uid() and p.account_role='trainer')
$$;
create function app_private.corporate_duty_payload(d app_private.corporate_duties) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',d.id,'trainerId',d.trainer_id,'officeId',d.office_id,
    'officeName',d.office_name,'officeCity',d.office_city,'timeZone',d.time_zone,
    'startedAt',d.started_at,'endedAt',d.ended_at,'version',d.version,
    'status',case when d.voided then 'void' when d.ended_at is null then 'open'
      when d.ended_at-d.started_at>interval '24 hours' and not d.long_confirmed then 'review' else 'completed' end,
    'seconds',case when d.ended_at is null then null else extract(epoch from d.ended_at-d.started_at) end)
$$;
revoke all on function app_private.corporate_duty_payload(app_private.corporate_duties) from public,fit_api;
create function app_private.corporate_duty_access() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('allowed',app_private.corporate_duty_allowed(),
   'hasHistory',exists(select 1 from app_private.corporate_duties where trainer_id=auth.uid()),
   'active',(select app_private.corporate_duty_payload(d) from app_private.corporate_duties d
     where trainer_id=auth.uid() and ended_at is null and not voided),
   'offices',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'city',o.city,'timeZone',z.time_zone) order by o.city,o.name,o.id)
     from public.corporate_trainer_offices b join public.corporate_offices o on o.id=b.office_id and not o.archived
     left join app_private.corporate_office_time_zones z on z.office_id=o.id
     where b.trainer_id=auth.uid() and app_private.corporate_duty_allowed()),'[]'::jsonb))
$$;

create function app_private.save_corporate_duty_zone(p_office uuid,p_zone text,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old app_private.corporate_office_time_zones; outcome jsonb;
begin
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if p_office is null or p_version is null or p_version<0 or p_zone is null
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then
   raise exception 'corporate_duty_invalid' using errcode='PT422'; end if;
 if not exists(select 1 from public.corporate_offices where id=p_office) then
   raise exception 'corporate_not_found' using errcode='PT404'; end if;
 select * into old from app_private.corporate_office_time_zones where office_id=p_office;
 if old.time_zone=p_zone and old.version=p_version+1 then
   return jsonb_build_object('timeZone',old.time_zone,'version',old.version); end if;
 if coalesce(old.version,0)<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
 insert into app_private.corporate_office_time_zones values(p_office,p_zone,p_version+1)
   on conflict(office_id) do update set time_zone=excluded.time_zone,version=excluded.version;
 outcome:=jsonb_build_object('timeZone',p_zone,'version',p_version+1);
 insert into app_private.corporate_admin_audit(actor_id,entity_kind,entity_id,before_data,after_data)
   values(auth.uid(),'office',p_office,case when old.office_id is null then null else to_jsonb(old) end,outcome);
 return outcome;
end $$;

-- One lock shared with confirmation/office/pilot writes. Commands include their
-- entire intent; replay never changes timestamps or creates a second audit row.
create function app_private.command_corporate_duty(p_command uuid,p_id uuid,p_action text,p_office uuid,p_version bigint,
 p_start timestamptz default null,p_end timestamptz default null,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old app_private.corporate_duties; changed app_private.corporate_duties;
 command app_private.corporate_duty_commands; intent jsonb; outcome jsonb; office public.corporate_offices; zone text;
begin
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if p_command is null or p_id is null or p_version is null or p_version<0 or p_action is null
   or p_action not in ('start','stop','correct','void','restore','confirm') then
   raise exception 'corporate_duty_invalid' using errcode='PT422'; end if;
 select * into old from app_private.corporate_duties where id=p_id for update;
 if p_action in ('correct','void','restore','confirm') then
   if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
   if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
     raise exception 'corporate_duty_invalid' using errcode='PT422'; end if;
 elsif p_action='start' then
   if not app_private.corporate_duty_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 elsif old.trainer_id is distinct from auth.uid() then
   raise exception 'corporate_not_found' using errcode='PT404';
 end if;
 intent:=jsonb_build_object('id',p_id,'action',p_action,'officeId',p_office,'version',p_version,
   'start',p_start,'end',p_end,'reason',p_reason);
 select * into command from app_private.corporate_duty_commands where id=p_command;
 if found then
   if command.actor_id<>auth.uid() or command.payload<>intent then raise exception 'corporate_conflict' using errcode='PT409'; end if;
   return command.result;
 end if;
 if p_action='start' then
   if old.id is not null or p_version<>0 or p_office is null or p_start is not null or p_end is not null or p_reason is not null then
     raise exception 'corporate_conflict' using errcode='PT409'; end if;
   select o.* into office from public.corporate_offices o join public.corporate_trainer_offices b on b.office_id=o.id
     where o.id=p_office and b.trainer_id=auth.uid() and not o.archived;
   select time_zone into zone from app_private.corporate_office_time_zones where office_id=p_office;
   if office.id is null then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
   if zone is null then raise exception 'corporate_duty_timezone_required' using errcode='PT422'; end if;
   if exists(select 1 from app_private.corporate_duties where trainer_id=auth.uid() and ended_at is null and not voided) then
     raise exception 'corporate_conflict' using errcode='PT409'; end if;
   insert into app_private.corporate_duties(id,trainer_id,office_id,office_name,office_city,time_zone,started_at)
     values(p_id,auth.uid(),office.id,office.name,office.city,zone,clock_timestamp()) returning * into changed;
 else
   if old.id is null then raise exception 'corporate_not_found' using errcode='PT404'; end if;
   if old.version<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
   changed:=old;
   if p_action='stop' then
     if old.ended_at is not null or old.voided or p_start is not null or p_end is not null or p_office is not null or p_reason is not null then
       raise exception 'corporate_conflict' using errcode='PT409'; end if;
     changed.ended_at:=clock_timestamp();
   elsif p_action in ('correct','restore') then
     if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
       or p_end<=p_start or p_end>clock_timestamp() or p_office is null then
       raise exception 'corporate_duty_invalid' using errcode='PT422'; end if;
     select * into office from public.corporate_offices where id=p_office;
     if office.id is null then raise exception 'corporate_not_found' using errcode='PT404'; end if;
     -- Same-office edits retain the historical timezone, even after zone changes.
     if old.office_id<>p_office then
       select time_zone into zone from app_private.corporate_office_time_zones where office_id=p_office;
       if zone is null then raise exception 'corporate_duty_timezone_required' using errcode='PT422'; end if;
       changed.office_id:=office.id; changed.office_name:=office.name; changed.office_city:=office.city; changed.time_zone:=zone;
     end if;
     if p_action='correct' and old.voided or p_action='restore' and not old.voided then
       raise exception 'corporate_conflict' using errcode='PT409'; end if;
     changed.started_at:=p_start; changed.ended_at:=p_end; changed.voided:=false; changed.long_confirmed:=false;
   elsif p_action='void' then
     if old.voided then raise exception 'corporate_conflict' using errcode='PT409'; end if;
     changed.voided:=true;
   else
     if old.voided or old.ended_at is null or old.ended_at-old.started_at<=interval '24 hours' then
       raise exception 'corporate_conflict' using errcode='PT409'; end if;
     changed.long_confirmed:=true;
   end if;
   changed.version:=old.version+1;
   update app_private.corporate_duties set office_id=changed.office_id,office_name=changed.office_name,
     office_city=changed.office_city,time_zone=changed.time_zone,started_at=changed.started_at,ended_at=changed.ended_at,
     voided=changed.voided,long_confirmed=changed.long_confirmed,version=changed.version where id=p_id;
 end if;
 -- Half-open intervals allow back-to-back duties but forbid any double counting.
 if not changed.voided and exists(select 1 from app_private.corporate_duties d
   where d.trainer_id=changed.trainer_id and d.id<>changed.id and not d.voided
   and tstzrange(d.started_at,d.ended_at,'[)') && tstzrange(changed.started_at,changed.ended_at,'[)')) then
   raise exception 'corporate_duty_overlap' using errcode='PT409'; end if;
 outcome:=app_private.corporate_duty_payload(changed);
 insert into app_private.corporate_duty_audit(duty_id,actor_id,action,reason,before_data,after_data)
   values(p_id,auth.uid(),p_action,p_reason,case when old.id is null then null else to_jsonb(old) end,to_jsonb(changed));
 insert into app_private.corporate_duty_commands(id,actor_id,payload,result) values(p_command,auth.uid(),intent,outcome);
 return outcome;
end $$;

create function app_private.read_corporate_duties(p_from date,p_until date,p_trainer uuid default null,p_office uuid default null,
 p_cursor_at timestamptz default null,p_cursor_id uuid default null,p_admin boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_admin then
   if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 else
   p_trainer:=auth.uid();
   if not app_private.corporate_duty_allowed() and not exists(select 1 from app_private.corporate_duties where trainer_id=p_trainer) then
     raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>93
   or (p_cursor_at is null)<>(p_cursor_id is null) then raise exception 'corporate_duty_invalid' using errcode='PT422'; end if;
 with selected as (select d.* from app_private.corporate_duties d
   where (p_trainer is null or trainer_id=p_trainer) and (p_office is null or office_id=p_office)
     and d.started_at<(p_until::timestamp at time zone d.time_zone)
     and (d.ended_at is null or d.ended_at>(p_from::timestamp at time zone d.time_zone))),
 segments as (select d.id,d.trainer_id,d.office_id,local_date::date local_day,
   extract(epoch from least(d.ended_at,((local_date::date+1)::timestamp at time zone d.time_zone))-
     greatest(d.started_at,(local_date::date::timestamp at time zone d.time_zone))) seconds
   from selected d cross join lateral generate_series(greatest(p_from,(d.started_at at time zone d.time_zone)::date)::timestamp,
     least(p_until-1,(d.ended_at at time zone d.time_zone)::date)::timestamp,interval '1 day') local_date
   where not d.voided and d.ended_at is not null and (d.ended_at-d.started_at<=interval '24 hours' or d.long_confirmed)),
 positive as (select * from segments where seconds>0),
 page as (select * from selected where p_cursor_at is null or (started_at,id)<(p_cursor_at,p_cursor_id)
   order by started_at desc,id desc limit 51),visible as (select * from page order by started_at desc,id desc limit 50)
 select jsonb_build_object('seconds',coalesce((select sum(seconds) from positive),0),
   'days',(select count(distinct (trainer_id,local_day)) from positive),'completed',(select count(distinct id) from positive),
   'open',(select count(*) from selected where not voided and ended_at is null),
   'review',(select count(*) from selected where not voided and ended_at-started_at>interval '24 hours' and not long_confirmed),
   'byTrainer',coalesce((select jsonb_agg(jsonb_build_object('trainerId',trainer_id,'seconds',seconds,'days',days,'completed',completed) order by trainer_id)
     from (select trainer_id,sum(seconds) seconds,count(distinct local_day) days,count(distinct id) completed from positive group by trainer_id) t),'[]'::jsonb),
   'byOffice',coalesce((select jsonb_agg(jsonb_build_object('officeId',office_id,'seconds',seconds,'days',days,'completed',completed) order by office_id)
     from (select office_id,sum(seconds) seconds,count(distinct (trainer_id,local_day)) days,count(distinct id) completed from positive group by office_id) t),'[]'::jsonb),
   'records',coalesce((select jsonb_agg(app_private.corporate_duty_payload(v) order by started_at desc,id desc) from
     (select d.* from app_private.corporate_duties d join visible v on v.id=d.id) v),'[]'::jsonb),
   'nextCursor',case when (select count(*) from page)>50 then
     (select jsonb_build_object('at',started_at,'id',id) from visible order by started_at,id limit 1) else null end,
   'trainers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',btrim(concat_ws(' ',p.first_name,p.last_name))) order by p.first_name,p.last_name,p.id)
     from public.profiles p where p_admin and exists(select 1 from app_private.corporate_duties d where d.trainer_id=p.id)),'[]'::jsonb),
   'offices',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'city',o.city,'archived',o.archived,
     'timeZone',z.time_zone,'zoneVersion',coalesce(z.version,0)) order by o.city,o.name,o.id)
     from public.corporate_offices o left join app_private.corporate_office_time_zones z on z.office_id=o.id where p_admin),'[]'::jsonb)) into result;
 return result;
end $$;
create function app_private.read_corporate_duty_audit(p_id uuid,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 if not exists(select 1 from app_private.corporate_duties where id=p_id) then raise exception 'corporate_not_found' using errcode='PT404'; end if;
 return jsonb_build_object('records',coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc)
   from (select id,actor_id,occurred_at,action,reason,before_data,after_data from app_private.corporate_duty_audit
     where duty_id=p_id and (p_before is null or id<p_before) order by id desc limit 50) a),'[]'::jsonb));
end $$;
revoke all on function app_private.corporate_duty_allowed(),app_private.corporate_duty_access(),
 app_private.save_corporate_duty_zone(uuid,text,bigint),app_private.command_corporate_duty(uuid,uuid,text,uuid,bigint,timestamptz,timestamptz,text),
 app_private.read_corporate_duties(date,date,uuid,uuid,timestamptz,uuid,boolean),app_private.read_corporate_duty_audit(uuid,bigint) from public;
grant execute on function app_private.corporate_duty_allowed(),app_private.corporate_duty_access(),
 app_private.save_corporate_duty_zone(uuid,text,bigint),app_private.command_corporate_duty(uuid,uuid,text,uuid,bigint,timestamptz,timestamptz,text),
 app_private.read_corporate_duties(date,date,uuid,uuid,timestamptz,uuid,boolean),app_private.read_corporate_duty_audit(uuid,bigint) to fit_api;

-- Down Migration
-- Operational history must never be silently discarded by rollback.
do $$ begin
 if exists(select 1 from app_private.corporate_duties) or exists(select 1 from app_private.corporate_duty_pilot_trainers)
   or exists(select 1 from app_private.corporate_office_time_zones) then raise exception 'corporate_duty_history_in_use'; end if;
end $$;
drop function app_private.read_corporate_duty_audit(uuid,bigint);
drop function app_private.read_corporate_duties(date,date,uuid,uuid,timestamptz,uuid,boolean);
drop function app_private.command_corporate_duty(uuid,uuid,text,uuid,bigint,timestamptz,timestamptz,text);
drop function app_private.save_corporate_duty_zone(uuid,text,bigint);
drop function app_private.corporate_duty_access();
drop function app_private.corporate_duty_payload(app_private.corporate_duties);
drop function app_private.corporate_duty_allowed();
drop table app_private.corporate_duty_audit,app_private.corporate_duty_commands,app_private.corporate_duties,
 app_private.corporate_duty_pilot_trainers,app_private.corporate_office_time_zones;
