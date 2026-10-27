-- Up Migration

-- An independent capability. Neither account_role nor existing tenant policies change.
create table app_private.corporate_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table app_private.corporate_admins enable row level security;
revoke all on app_private.corporate_admins from public, fit_api;

create function app_private.is_corporate_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from app_private.corporate_admins
    where profile_id = auth.uid() and enabled)
$$;
revoke all on function app_private.is_corporate_admin() from public;
grant execute on function app_private.is_corporate_admin() to fit_api;

create table public.corporate_offices (
  id uuid primary key default gen_random_uuid(),
  city text not null check(char_length(btrim(city)) between 1 and 100),
  name text not null check(char_length(btrim(name)) between 1 and 160),
  address text not null check(char_length(btrim(address)) between 1 and 300),
  archived boolean not null default false,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index corporate_offices_identity on public.corporate_offices
  (lower(btrim(city)), lower(btrim(name)), lower(btrim(address)));
create table public.corporate_trainers (
  trainer_id uuid primary key references public.trainers(profile_id) on delete cascade,
  is_yandex boolean not null default false,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.corporate_trainer_offices (
  trainer_id uuid not null references public.corporate_trainers(trainer_id) on delete cascade,
  office_id uuid not null references public.corporate_offices(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(trainer_id, office_id)
);
create table app_private.corporate_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_kind text not null check(entity_kind in ('office','trainer')),
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
alter table app_private.corporate_admin_audit enable row level security;
revoke all on app_private.corporate_admin_audit from public, fit_api;

alter table public.corporate_offices enable row level security;
alter table public.corporate_trainers enable row level security;
alter table public.corporate_trainer_offices enable row level security;
revoke all on public.corporate_offices, public.corporate_trainers, public.corporate_trainer_offices from public, fit_api;
-- All writes are checked commands; no runtime direct-table grants.

create function app_private.corporate_admin_bundle() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  return jsonb_build_object(
    'offices', coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'city',o.city,'name',o.name,'address',o.address,
      'archived',o.archived,'version',o.version) order by o.city,o.name,o.id)
      from public.corporate_offices o),'[]'::jsonb),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.profile_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'isYandex',coalesce(c.is_yandex,false),'version',coalesce(c.version,0),
      'officeIds',coalesce((select jsonb_agg(b.office_id order by b.office_id)
        from public.corporate_trainer_offices b where b.trainer_id=t.profile_id),'[]'::jsonb))
      order by p.first_name,p.last_name,t.profile_id)
      from public.trainers t join public.profiles p on p.id=t.profile_id
      left join public.corporate_trainers c on c.trainer_id=t.profile_id
      where p.account_role='trainer'),'[]'::jsonb));
end $$;

create function app_private.save_corporate_office(p_id uuid,p_city text,p_name text,p_address text,p_archived boolean,p_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare old_row public.corporate_offices; new_row public.corporate_offices;
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  if p_id is null or p_city is null or p_name is null or p_address is null or p_archived is null
    or char_length(btrim(p_city)) not between 1 and 100
    or char_length(btrim(p_name)) not between 1 and 160
    or char_length(btrim(p_address)) not between 1 and 300
    or p_version is null or p_version<0 then
    raise exception 'corporate_invalid' using errcode='PT422';
  end if;
  select id,city,name,address,archived,version,created_at,updated_at into old_row from public.corporate_offices where id=p_id for update;
  if old_row.id is null then
    if p_version<>0 then raise exception 'corporate_conflict' using errcode='PT409'; end if;
    insert into public.corporate_offices(id,city,name,address,archived)
      values(p_id,btrim(p_city),btrim(p_name),btrim(p_address),p_archived) returning id,city,name,address,archived,version,created_at,updated_at into new_row;
  else
    -- Exact lost-response replay is safe; it does not create a second audit entry.
    if old_row.city=btrim(p_city) and old_row.name=btrim(p_name) and old_row.address=btrim(p_address)
      and old_row.archived=p_archived and old_row.version=p_version+1 then return; end if;
    if old_row.version<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
    if p_archived and exists(
      select 1 from public.corporate_trainers t join public.corporate_trainer_offices b on b.trainer_id=t.trainer_id
      where b.office_id=p_id and t.is_yandex and not exists(
        select 1 from public.corporate_trainer_offices other join public.corporate_offices o on o.id=other.office_id
        where other.trainer_id=t.trainer_id and o.id<>p_id and not o.archived)) then
      raise exception 'corporate_office_in_use' using errcode='PT422';
    end if;
    update public.corporate_offices set city=btrim(p_city),name=btrim(p_name),address=btrim(p_address),
      archived=p_archived,version=version+1,updated_at=now() where id=p_id returning id,city,name,address,archived,version,created_at,updated_at into new_row;
  end if;
  insert into app_private.corporate_admin_audit(actor_id,entity_kind,entity_id,before_data,after_data)
    values(auth.uid(),'office',p_id,case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(new_row));
exception when unique_violation then raise exception 'corporate_office_duplicate' using errcode='PT422';
end $$;

create function app_private.save_corporate_trainer(p_id uuid,p_enabled boolean,p_offices uuid[],p_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare old_row public.corporate_trainers; old_offices uuid[]; office_ids uuid[];
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  if p_id is null or p_enabled is null or p_offices is null or p_version is null or p_version<0
    or cardinality(p_offices)>100 or array_position(p_offices,null) is not null then
    raise exception 'corporate_invalid' using errcode='PT422';
  end if;
  if not exists(select 1 from public.trainers t join public.profiles p on p.id=t.profile_id
    where t.profile_id=p_id and p.account_role='trainer') then
    raise exception 'corporate_not_found' using errcode='PT404';
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into office_ids from unnest(p_offices) x;
  if (p_enabled and cardinality(office_ids)=0) or exists(select 1 from unnest(office_ids) x
    where not exists(select 1 from public.corporate_offices o where o.id=x and not o.archived)) then
    raise exception 'corporate_invalid' using errcode='PT422';
  end if;
  select trainer_id,is_yandex,version,created_at,updated_at into old_row from public.corporate_trainers where trainer_id=p_id for update;
  select coalesce(array_agg(office_id order by office_id),'{}'::uuid[]) into old_offices
    from public.corporate_trainer_offices where trainer_id=p_id;
  if old_row.trainer_id is not null and old_row.is_yandex=p_enabled and old_offices=office_ids
    and old_row.version=p_version+1 then return; end if;
  if coalesce(old_row.version,0)<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
  insert into public.corporate_trainers(trainer_id,is_yandex) values(p_id,p_enabled)
    on conflict(trainer_id) do update set is_yandex=excluded.is_yandex,version=corporate_trainers.version+1,updated_at=now();
  delete from public.corporate_trainer_offices where trainer_id=p_id;
  insert into public.corporate_trainer_offices(trainer_id,office_id) select p_id,unnest(office_ids);
  insert into app_private.corporate_admin_audit(actor_id,entity_kind,entity_id,before_data,after_data)
    values(auth.uid(),'trainer',p_id,jsonb_build_object('isYandex',coalesce(old_row.is_yandex,false),'officeIds',old_offices),
      jsonb_build_object('isYandex',p_enabled,'officeIds',office_ids));
end $$;

revoke all on function app_private.corporate_admin_bundle() from public;
revoke all on function app_private.save_corporate_office(uuid,text,text,text,boolean,bigint) from public;
revoke all on function app_private.save_corporate_trainer(uuid,boolean,uuid[],bigint) from public;
grant execute on function app_private.corporate_admin_bundle() to fit_api;
grant execute on function app_private.save_corporate_office(uuid,text,text,text,boolean,bigint) to fit_api;
grant execute on function app_private.save_corporate_trainer(uuid,boolean,uuid[],bigint) to fit_api;

-- Down Migration

drop function app_private.save_corporate_trainer(uuid,boolean,uuid[],bigint);
drop function app_private.save_corporate_office(uuid,text,text,text,boolean,bigint);
drop function app_private.corporate_admin_bundle();
drop table app_private.corporate_admin_audit;
drop table public.corporate_trainer_offices;
drop table public.corporate_trainers;
drop table public.corporate_offices;
drop function app_private.is_corporate_admin();
drop table app_private.corporate_admins;
