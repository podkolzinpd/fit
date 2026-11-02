-- Up Migration

create table app_private.corporate_service_pilot_trainers (
  profile_id uuid primary key references public.trainers(profile_id) on delete cascade,
  enabled boolean not null default false
);
create table app_private.corporate_services (
  id uuid primary key,
  trainer_id uuid references public.profiles(id) on delete set null,
  office_id uuid references public.corporate_offices(id) on delete set null,
  kind text not null check(kind in ('consultation','tour','instruction','intro')),
  occurred_at timestamptz not null,
  version bigint not null default 1 check(version>0),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index corporate_services_trainer_date on app_private.corporate_services(trainer_id,occurred_at desc,id desc);
create index corporate_services_office_date on app_private.corporate_services(office_id,occurred_at);
create index corporate_services_date on app_private.corporate_services(occurred_at);
create table app_private.corporate_service_commands (
  id uuid primary key,
  service_id uuid not null references app_private.corporate_services(id),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('create','update','void')),
  service_version bigint not null,
  payload jsonb not null,
  before_data jsonb,
  after_data jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(service_id,service_version)
);
alter table app_private.corporate_service_pilot_trainers enable row level security;
alter table app_private.corporate_services enable row level security;
alter table app_private.corporate_service_commands enable row level security;
revoke all on app_private.corporate_service_pilot_trainers,app_private.corporate_services,
  app_private.corporate_service_commands from public,fit_api;

create function app_private.corporate_services_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex
    join app_private.corporate_service_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=auth.uid() and p.account_role='trainer' and exists(
      select 1 from public.corporate_trainer_offices b join public.corporate_offices o on o.id=b.office_id
      where b.trainer_id=p.id and not o.archived))
$$;

create function app_private.corporate_service_json(s app_private.corporate_services) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',s.id,'kind',s.kind,'officeId',s.office_id,
    'city',coalesce(o.city,''),'officeName',coalesce(o.name,'Офис недоступен'),
    'occurredAt',s.occurred_at,'version',s.version,'voidedAt',s.voided_at,
    'createdAt',s.created_at,'updatedAt',s.updated_at)
  from (values(1)) seed(x) left join public.corporate_offices o on o.id=s.office_id
$$;
revoke all on function app_private.corporate_service_json(app_private.corporate_services) from public,fit_api;

create function app_private.corporate_service_bounds(p_from date,p_until date)
returns table(start_at timestamptz,end_at timestamptz,time_zone text)
language plpgsql stable security definer set search_path='' as $$
declare zone text;
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>93 then
    raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
  select coalesce(p.timezone,'Europe/Moscow') into zone from public.profiles p where p.id=auth.uid();
  if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
    raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
  return query select p_from::timestamp at time zone zone,p_until::timestamp at time zone zone,zone;
end $$;
revoke all on function app_private.corporate_service_bounds(date,date) from public,fit_api;

create function app_private.save_corporate_service(p_command uuid,p_id uuid,p_kind text,p_office uuid,
  p_at timestamptz,p_version bigint,p_void boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old app_private.corporate_services; fresh app_private.corporate_services;
  command app_private.corporate_service_commands; payload jsonb; outcome jsonb; action text;
begin
  if not app_private.corporate_services_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- The owner pilot operator and corporate membership/office writes share this lock.
  if not app_private.corporate_services_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_command is null or p_id is null or p_version is null or p_version<0 or p_void is null then
    raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
  action:=case when p_void then 'void' when p_version=0 then 'create' else 'update' end;
  payload:=jsonb_build_object('id',p_id,'action',action,'version',p_version,
    'kind',case when p_void then null else p_kind end,'officeId',case when p_void then null else p_office end,
    'at',case when p_void then null else extract(epoch from p_at) end);
  select * into command from app_private.corporate_service_commands where id=p_command;
  if found then
    if command.actor_id is distinct from auth.uid() or command.payload<>payload then
      raise exception 'corporate_conflict' using errcode='PT409'; end if;
    return command.result;
  end if;
  select * into old from app_private.corporate_services where id=p_id for update;
  if old.id is not null and old.trainer_id is distinct from auth.uid() then
    raise exception 'corporate_not_found' using errcode='PT404'; end if;
  if old.id is null and p_version<>0 then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  if old.id is not null and (old.version<>p_version or old.voided_at is not null) then
    raise exception 'corporate_conflict' using errcode='PT409'; end if;
  if p_void then
    if old.id is null then raise exception 'corporate_not_found' using errcode='PT404'; end if;
    update app_private.corporate_services set voided_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
      where id=p_id returning * into fresh;
  else
    if p_kind is null or p_kind not in ('consultation','tour','instruction','intro') or p_at is null
      or not isfinite(p_at) or p_at>clock_timestamp() or p_office is null or not exists(
      select 1 from public.corporate_trainer_offices b join public.corporate_offices o on o.id=b.office_id
      where b.trainer_id=auth.uid() and b.office_id=p_office and not o.archived) then
      raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
    if old.id is null then
      insert into app_private.corporate_services(id,trainer_id,office_id,kind,occurred_at)
        values(p_id,auth.uid(),p_office,p_kind,p_at) returning * into fresh;
    else
      update app_private.corporate_services set office_id=p_office,kind=p_kind,occurred_at=p_at,
        version=version+1,updated_at=clock_timestamp() where id=p_id returning * into fresh;
    end if;
  end if;
  outcome:=jsonb_build_object('saved',true,'id',fresh.id,'version',fresh.version);
  insert into app_private.corporate_service_commands(id,service_id,actor_id,action,service_version,payload,before_data,after_data,result)
    values(p_command,p_id,auth.uid(),action,fresh.version,payload,
      case when old.id is null then null else app_private.corporate_service_json(old) end,
      app_private.corporate_service_json(fresh),outcome);
  return outcome;
end $$;

create function app_private.read_corporate_services(p_from date,p_until date,p_cursor_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare bounds record; records jsonb; next_cursor jsonb;
begin
  if not app_private.corporate_services_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  select * into bounds from app_private.corporate_service_bounds(p_from,p_until);
  if (p_cursor_at is null)<>(p_cursor_id is null) or (p_cursor_at is not null and not isfinite(p_cursor_at)) then
    raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
  with page as (select s.* from app_private.corporate_services s where s.trainer_id=auth.uid()
    and s.occurred_at>=bounds.start_at and s.occurred_at<bounds.end_at
    and (p_cursor_at is null or (s.occurred_at,s.id)<(p_cursor_at,p_cursor_id))
    order by s.occurred_at desc,s.id desc limit 51),
  visible as (select * from page order by occurred_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(app_private.corporate_service_json(v) order by v.occurred_at desc,v.id desc) from visible v),'[]'::jsonb),
    case when (select count(*) from page)>50 then (select jsonb_build_object('at',occurred_at,'id',id)
      from visible order by occurred_at,id limit 1) else null end into records,next_cursor;
  return jsonb_build_object('records',records,'nextCursor',next_cursor,'timeZone',bounds.time_zone,
    'offices',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'city',o.city,'name',o.name) order by o.city,o.name,o.id)
      from public.corporate_offices o join public.corporate_trainer_offices b on b.office_id=o.id
      where b.trainer_id=auth.uid() and not o.archived),'[]'::jsonb));
end $$;

create function app_private.read_corporate_service(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare service app_private.corporate_services;
begin
  if not app_private.corporate_services_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  select * into service from app_private.corporate_services where id=p_id and trainer_id=auth.uid();
  if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  return app_private.corporate_service_json(service);
end $$;

create function app_private.read_corporate_service_audit(p_id uuid,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare events jsonb; next_version bigint;
begin
  if not app_private.corporate_services_allowed() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if not exists(select 1 from app_private.corporate_services where id=p_id and trainer_id=auth.uid()) then
    raise exception 'corporate_not_found' using errcode='PT404'; end if;
  if p_before is not null and p_before<1 then raise exception 'corporate_service_invalid' using errcode='PT422'; end if;
  with page as (select * from app_private.corporate_service_commands where service_id=p_id
    and (p_before is null or service_version<p_before) order by service_version desc limit 31),
  visible as (select * from page order by service_version desc limit 30)
  select coalesce((select jsonb_agg(jsonb_build_object('action',action,'at',created_at,'version',service_version,
    'before',before_data,'after',after_data) order by service_version desc) from visible),'[]'::jsonb),
    case when (select count(*) from page)>30 then (select min(service_version) from visible) else null end
    into events,next_version;
  return jsonb_build_object('events',events,'nextBeforeVersion',next_version);
end $$;

create function app_private.corporate_service_statistics(p_from date,p_until date,p_trainer uuid default null,p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare bounds record; counts jsonb;
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  select * into bounds from app_private.corporate_service_bounds(p_from,p_until);
  select jsonb_build_object('consultation',count(*) filter(where kind='consultation'),
    'tour',count(*) filter(where kind='tour'),'instruction',count(*) filter(where kind='instruction'),
    'intro',count(*) filter(where kind='intro')) into counts from app_private.corporate_services
    where occurred_at>=bounds.start_at and occurred_at<bounds.end_at and voided_at is null
      and (p_trainer is null or trainer_id=p_trainer) and (p_office is null or office_id=p_office);
  return jsonb_build_object('counts',counts,'timeZone',bounds.time_zone,
    'offices',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'city',o.city,'name',o.name,'archived',o.archived) order by o.city,o.name,o.id)
      from public.corporate_offices o where exists(select 1 from app_private.corporate_services s where s.office_id=o.id)
      or exists(select 1 from public.corporate_trainer_offices b join public.corporate_trainers t on t.trainer_id=b.trainer_id
        where b.office_id=o.id and t.is_yandex)),'[]'::jsonb),
    'trainers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,
      'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'active',coalesce(t.is_yandex,false)) order by p.first_name,p.last_name,p.id)
      from public.profiles p left join public.corporate_trainers t on t.trainer_id=p.id
      where t.is_yandex or exists(select 1 from app_private.corporate_services s where s.trainer_id=p.id)),'[]'::jsonb));
end $$;

revoke all on function app_private.corporate_services_allowed(),
 app_private.save_corporate_service(uuid,uuid,text,uuid,timestamptz,bigint,boolean),
 app_private.read_corporate_services(date,date,timestamptz,uuid),app_private.read_corporate_service(uuid),app_private.read_corporate_service_audit(uuid,bigint),
 app_private.corporate_service_statistics(date,date,uuid,uuid) from public;
grant execute on function app_private.corporate_services_allowed(),
 app_private.save_corporate_service(uuid,uuid,text,uuid,timestamptz,bigint,boolean),
 app_private.read_corporate_services(date,date,timestamptz,uuid),app_private.read_corporate_service(uuid),app_private.read_corporate_service_audit(uuid,bigint),
 app_private.corporate_service_statistics(date,date,uuid,uuid) to fit_api;

-- Down Migration
drop function app_private.corporate_service_statistics(date,date,uuid,uuid);
drop function app_private.read_corporate_service_audit(uuid,bigint);
drop function app_private.read_corporate_service(uuid);
drop function app_private.read_corporate_services(date,date,timestamptz,uuid);
drop function app_private.save_corporate_service(uuid,uuid,text,uuid,timestamptz,bigint,boolean);
drop function app_private.corporate_service_bounds(date,date);
drop function app_private.corporate_service_json(app_private.corporate_services);
drop function app_private.corporate_services_allowed();
drop table app_private.corporate_service_commands;
drop table app_private.corporate_services;
drop table app_private.corporate_service_pilot_trainers;
