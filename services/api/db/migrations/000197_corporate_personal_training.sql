-- Up Migration

create table app_private.corporate_personal_pilot_trainers (
  profile_id uuid primary key references public.trainers(profile_id) on delete cascade,
  enabled boolean not null default false
);
create table app_private.corporate_employee_marks (
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  marked boolean not null,
  version bigint not null check(version>0),
  primary key(trainer_id,client_id)
);
create table app_private.corporate_employee_periods (
  id uuid primary key,
  trainer_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  from_date date not null,
  time_zone text not null,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  until_date date,
  check((ended_at is null)=(until_date is null)),
  check(until_date is null or until_date>=from_date)
);
create unique index corporate_employee_one_open_period
  on app_private.corporate_employee_periods(trainer_id,client_id) where ended_at is null;
create table app_private.corporate_employee_commands (
  id uuid primary key,
  trainer_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  marked boolean not null,
  expected_version bigint not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
-- Only first completion can establish eligibility. Current workout fields are
-- still authoritative for corrections, while later membership changes are not.
create table app_private.corporate_personal_workouts (
  workout_id uuid primary key,
  trainer_id uuid references public.profiles(id) on delete set null,
  period_id uuid not null references app_private.corporate_employee_periods(id),
  captured_at timestamptz not null default clock_timestamp()
);
create index corporate_personal_trainer on app_private.corporate_personal_workouts(trainer_id,workout_id);
alter table app_private.corporate_personal_pilot_trainers enable row level security;
alter table app_private.corporate_employee_marks enable row level security;
alter table app_private.corporate_employee_periods enable row level security;
alter table app_private.corporate_employee_commands enable row level security;
alter table app_private.corporate_personal_workouts enable row level security;
revoke all on app_private.corporate_personal_pilot_trainers,app_private.corporate_employee_marks,
  app_private.corporate_employee_periods,app_private.corporate_employee_commands,
  app_private.corporate_personal_workouts from public,fit_api;

create function app_private.corporate_personal_trainer_allowed(p_trainer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex
    join app_private.corporate_personal_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=p_trainer and p.account_role='trainer')
$$;
revoke all on function app_private.corporate_personal_trainer_allowed(uuid) from public,fit_api;
create function app_private.corporate_personal_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select app_private.corporate_personal_trainer_allowed(auth.uid())
$$;

create function app_private.read_corporate_employee_mark(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mark app_private.corporate_employee_marks; started date;
begin
  if not app_private.corporate_personal_allowed() then
    raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client and c.archived_at is null
    and public.is_active_client_trainer_connection(c.id,auth.uid())) then
    raise exception 'corporate_not_found' using errcode='PT404'; end if;
  select * into mark from app_private.corporate_employee_marks
    where trainer_id=auth.uid() and client_id=p_client;
  select from_date into started from app_private.corporate_employee_periods
    where trainer_id=auth.uid() and client_id=p_client and ended_at is null;
  return jsonb_build_object('marked',coalesce(mark.marked,false),
    'version',coalesce(mark.version,0),'fromDate',started);
end $$;

create function app_private.save_corporate_employee_mark(p_command uuid,p_client uuid,p_marked boolean,p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old app_private.corporate_employee_marks; command app_private.corporate_employee_commands;
  zone text; today date; outcome jsonb;
begin
  if not app_private.corporate_personal_allowed() then
    raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  if not app_private.corporate_personal_allowed() then
    raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_command is null or p_client is null or p_marked is null or p_version is null or p_version<0 then
    raise exception 'corporate_personal_invalid' using errcode='PT422'; end if;
  -- Relationship mutations lock this same card. Re-check after acquiring it.
  perform 1 from public.clients where id=p_client for update;
  if not exists(select 1 from public.clients c where c.id=p_client and c.archived_at is null
    and public.is_active_client_trainer_connection(c.id,auth.uid())) then
    raise exception 'corporate_not_found' using errcode='PT404'; end if;
  select * into command from app_private.corporate_employee_commands where id=p_command;
  if found then
    if command.trainer_id is distinct from auth.uid() or command.client_id is distinct from p_client
      or command.marked<>p_marked or command.expected_version<>p_version then
      raise exception 'corporate_conflict' using errcode='PT409'; end if;
    return command.result;
  end if;
  select * into old from app_private.corporate_employee_marks
    where trainer_id=auth.uid() and client_id=p_client for update;
  if coalesce(old.version,0)<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
  if coalesce(old.marked,false)=p_marked then return app_private.read_corporate_employee_mark(p_client); end if;
  select timezone into zone from public.profiles where id=auth.uid();
  if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
    raise exception 'corporate_personal_invalid' using errcode='PT422'; end if;
  today:=(clock_timestamp() at time zone zone)::date;
  if p_marked then
    insert into app_private.corporate_employee_periods(id,trainer_id,client_id,from_date,time_zone)
      values(p_command,auth.uid(),p_client,today,zone);
  else
    update app_private.corporate_employee_periods set ended_at=clock_timestamp(),
      until_date=greatest(from_date,(clock_timestamp() at time zone time_zone)::date)
      where trainer_id=auth.uid() and client_id=p_client and ended_at is null;
  end if;
  insert into app_private.corporate_employee_marks(trainer_id,client_id,marked,version)
    values(auth.uid(),p_client,p_marked,p_version+1)
    on conflict(trainer_id,client_id) do update set marked=excluded.marked,version=excluded.version;
  outcome:=app_private.read_corporate_employee_mark(p_client);
  insert into app_private.corporate_employee_commands(id,trainer_id,client_id,marked,expected_version,result)
    values(p_command,auth.uid(),p_client,p_marked,p_version,outcome);
  return outcome;
end $$;

create function app_private.capture_corporate_personal_workout() returns trigger
language plpgsql security definer set search_path='' as $$
declare trainer uuid; period uuid;
begin
  if new.status<>'done' then return new; end if;
  if tg_op='UPDATE' then if old.status='done' then return new; end if; end if;
  trainer:=coalesce(new.created_by,new.trainer_id);
  if not app_private.corporate_personal_trainer_allowed(trainer) then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  if not app_private.corporate_personal_trainer_allowed(trainer) then return new; end if;
  select p.id into period from app_private.corporate_employee_periods p
    join app_private.corporate_employee_marks m on m.trainer_id=p.trainer_id and m.client_id=p.client_id and m.marked
    where p.trainer_id=trainer and p.client_id=new.client_id and p.ended_at is null
      and new.workout_date>=p.from_date
      and public.is_active_client_trainer_connection(new.client_id,trainer);
  if period is not null then
    insert into app_private.corporate_personal_workouts(workout_id,trainer_id,period_id)
      values(new.id,trainer,period) on conflict(workout_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.capture_corporate_personal_workout() from public,fit_api;
create trigger capture_corporate_personal_workout after insert or update of status on public.workouts
  for each row execute function app_private.capture_corporate_personal_workout();

create view app_private.corporate_personal_counted as
  select f.workout_id,f.trainer_id,w.workout_date
  from app_private.corporate_personal_workouts f
  join app_private.corporate_employee_periods p on p.id=f.period_id
  join public.workouts w on w.id=f.workout_id
  where w.status='done' and w.training_format='with_trainer' and w.deleted_at is null
    and coalesce(w.created_by,w.trainer_id) is not distinct from f.trainer_id
    and w.workout_date>=p.from_date and (p.until_date is null or w.workout_date<=p.until_date);
revoke all on app_private.corporate_personal_counted from public,fit_api;

create function app_private.corporate_personal_statistics(p_from date,p_until date,p_trainer uuid default null,
  p_cursor_date date default null,p_cursor_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total bigint; trainers jsonb; records jsonb; next_cursor jsonb;
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>93
    or (p_cursor_date is null)<>(p_cursor_id is null) then
    raise exception 'corporate_personal_invalid' using errcode='PT422'; end if;
  select count(*) into total from app_private.corporate_personal_counted f
    where f.workout_date>=p_from and f.workout_date<p_until and (p_trainer is null or f.trainer_id=p_trainer);
  select coalesce(jsonb_agg(jsonb_build_object('id',t.trainer_id,'name',t.name,'count',t.n)
    order by t.name,t.trainer_id),'[]'::jsonb) into trainers from (
    select f.trainer_id,coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Тренер недоступен') name,count(*) n
    from app_private.corporate_personal_counted f left join public.profiles p on p.id=f.trainer_id
    where f.workout_date>=p_from and f.workout_date<p_until group by f.trainer_id,p.first_name,p.last_name) t;
  with page as (select f.*,coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Тренер недоступен') name
    from app_private.corporate_personal_counted f left join public.profiles p on p.id=f.trainer_id
    where f.workout_date>=p_from and f.workout_date<p_until and (p_trainer is null or f.trainer_id=p_trainer)
      and (p_cursor_date is null or (f.workout_date,f.workout_id)<(p_cursor_date,p_cursor_id))
    order by f.workout_date desc,f.workout_id desc limit 51),
  visible as (select * from page order by workout_date desc,workout_id desc limit 50)
  select coalesce((select jsonb_agg(jsonb_build_object('id',workout_id,'date',workout_date,
    'trainerId',trainer_id,'trainerName',name,'status','done') order by workout_date desc,workout_id desc)
    from visible),'[]'::jsonb),case when (select count(*) from page)>50 then
    (select jsonb_build_object('date',workout_date,'id',workout_id) from visible order by workout_date,workout_id limit 1)
    else null end into records,next_cursor;
  return jsonb_build_object('count',total,'trainers',trainers,'records',records,'nextCursor',next_cursor);
end $$;
revoke all on function app_private.corporate_personal_allowed(),app_private.read_corporate_employee_mark(uuid),
  app_private.save_corporate_employee_mark(uuid,uuid,boolean,bigint),
  app_private.corporate_personal_statistics(date,date,uuid,date,uuid) from public;
grant execute on function app_private.corporate_personal_allowed(),app_private.read_corporate_employee_mark(uuid),
  app_private.save_corporate_employee_mark(uuid,uuid,boolean,bigint),
  app_private.corporate_personal_statistics(date,date,uuid,date,uuid) to fit_api;

-- Down Migration
do $$ begin
  if exists(select 1 from app_private.corporate_employee_periods)
    or exists(select 1 from app_private.corporate_employee_commands)
    or exists(select 1 from app_private.corporate_personal_workouts)
    or exists(select 1 from app_private.corporate_employee_marks)
    or exists(select 1 from app_private.corporate_personal_pilot_trainers) then
    raise exception 'corporate_personal_history_in_use'; end if;
end $$;
drop trigger capture_corporate_personal_workout on public.workouts;
drop function app_private.corporate_personal_statistics(date,date,uuid,date,uuid);
drop view app_private.corporate_personal_counted;
drop function app_private.capture_corporate_personal_workout();
drop function app_private.save_corporate_employee_mark(uuid,uuid,boolean,bigint);
drop function app_private.read_corporate_employee_mark(uuid);
drop function app_private.corporate_personal_allowed();
drop function app_private.corporate_personal_trainer_allowed(uuid);
drop table app_private.corporate_personal_workouts,app_private.corporate_employee_commands,
  app_private.corporate_employee_periods,app_private.corporate_employee_marks,app_private.corporate_personal_pilot_trainers;
