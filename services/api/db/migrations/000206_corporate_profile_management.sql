-- Up Migration
-- Independent, empty/default-off pilot. No existing account, profile or pilot is rewritten.
create table app_private.corporate_profile_pilot_trainers (
 profile_id uuid primary key references public.trainers(profile_id), enabled boolean not null default false
);
create table app_private.corporate_profile_management (
 trainer_id uuid primary key references public.trainers(profile_id),
 managed boolean not null default false, version bigint not null default 1 check(version>0)
);
create table app_private.corporate_profile_commands (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 trainer_id uuid not null references public.trainers(profile_id), intent jsonb not null,
 profile_version bigint not null, management_version bigint not null,
 before_data jsonb, result jsonb, created_at timestamptz not null default now()
);
create table app_private.corporate_profile_audit (
 id uuid primary key default gen_random_uuid(), trainer_id uuid not null references public.trainers(profile_id),
 actor_id uuid not null references public.profiles(id), action text not null,
 before_data jsonb, after_data jsonb not null, occurred_at timestamptz not null default now()
);
alter table app_private.corporate_profile_pilot_trainers enable row level security;
alter table app_private.corporate_profile_management enable row level security;
alter table app_private.corporate_profile_commands enable row level security;
alter table app_private.corporate_profile_audit enable row level security;
revoke all on app_private.corporate_profile_pilot_trainers, app_private.corporate_profile_management,
 app_private.corporate_profile_commands, app_private.corporate_profile_audit from public,fit_api;

create function app_private.corporate_profile_available(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.corporate_trainers c
 join public.profiles p on p.id=c.trainer_id and p.account_role='trainer'
 join app_private.corporate_profile_pilot_trainers f on f.profile_id=c.trainer_id and f.enabled
 where c.trainer_id=p_target and c.is_yandex)
$$;
create function app_private.can_admin_corporate_profile(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select app_private.is_corporate_admin() and app_private.corporate_profile_available(p_target)
$$;
create function app_private.require_corporate_profile_admin(p_target uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.can_admin_corporate_profile(p_target) then
  raise exception 'corporate_profile_forbidden' using errcode='PT403'; end if;
end $$;
create function app_private.corporate_profile_owner_can_write(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_target=auth.uid() and (not app_private.corporate_profile_available(p_target)
  or not exists(select 1 from app_private.corporate_profile_management where trainer_id=p_target and managed))
$$;
create function app_private.corporate_profile_management(p_target uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid:=coalesce(p_target,auth.uid()); available boolean;
begin
 if target is distinct from auth.uid() then perform app_private.require_corporate_profile_admin(target); end if;
 available:=app_private.corporate_profile_available(target);
 return jsonb_build_object('available',available,'managedByAdmin',available and coalesce((select managed
  from app_private.corporate_profile_management where trainer_id=target),false),
  'version',coalesce((select version from app_private.corporate_profile_management where trainer_id=target),0));
end $$;
create function app_private.check_corporate_profile_write(p_target uuid,p_admin boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_target,auth.uid());
begin
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if p_admin then perform app_private.require_corporate_profile_admin(target);
 elsif not app_private.corporate_profile_owner_can_write(target) then
  raise exception 'trainer_profile_managed' using errcode='PT403';
 end if;
end $$;

-- SELECT is independent of write policy, so a locked trainer can still view the draft.
drop policy trainer_profiles_manage_own on public.trainer_professional_profiles;
create policy trainer_profiles_read_own on public.trainer_professional_profiles for select to fit_api using(trainer_id=auth.uid());
create policy trainer_profiles_insert_own on public.trainer_professional_profiles for insert to fit_api
 with check(app_private.corporate_profile_owner_can_write(trainer_id));
create policy trainer_profiles_update_own on public.trainer_professional_profiles for update to fit_api
 using(app_private.corporate_profile_owner_can_write(trainer_id)) with check(app_private.corporate_profile_owner_can_write(trainer_id));
create policy trainer_profiles_admin_read on public.trainer_professional_profiles for select to fit_api
 using(app_private.can_admin_corporate_profile(trainer_id));
create policy trainer_profiles_admin_insert on public.trainer_professional_profiles for insert to fit_api
 with check(app_private.can_admin_corporate_profile(trainer_id));
create policy trainer_profiles_admin_update on public.trainer_professional_profiles for update to fit_api
 using(app_private.can_admin_corporate_profile(trainer_id)) with check(app_private.can_admin_corporate_profile(trainer_id));

create function app_private.begin_corporate_profile_write(p_target uuid,p_admin boolean,p_version bigint,p_management_version bigint,p_command uuid,p_intent jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare control_version bigint; profile_version bigint; previous app_private.corporate_profile_commands; before_snapshot jsonb;
begin
 perform app_private.check_corporate_profile_write(p_target,p_admin);
 if not app_private.corporate_profile_available(p_target) then return jsonb_build_object('replay',false); end if;
 if p_command is null or p_version is null or p_management_version is null then
  raise exception 'trainer_profile_refresh_required' using errcode='PT409'; end if;
 if p_version<0 or p_management_version<0 or p_intent is null then raise exception 'corporate_profile_invalid' using errcode='PT422'; end if;
 select * into previous from app_private.corporate_profile_commands where id=p_command;
 if found then
  if previous.actor_id<>auth.uid() or previous.trainer_id<>p_target or previous.intent<>p_intent
    or previous.profile_version<>p_version or previous.management_version<>p_management_version or previous.result is null then
   raise exception 'corporate_profile_conflict' using errcode='PT409'; end if;
  return jsonb_build_object('replay',true,'result',previous.result);
 end if;
 select version into control_version from app_private.corporate_profile_management where trainer_id=p_target;
 select version,to_jsonb(p) into profile_version,before_snapshot from public.trainer_professional_profiles p where trainer_id=p_target for update;
 if coalesce(control_version,0)<>p_management_version or coalesce(profile_version,0)<>p_version then
  raise exception 'corporate_profile_conflict' using errcode='PT409'; end if;
 insert into app_private.corporate_profile_commands(id,actor_id,trainer_id,intent,profile_version,management_version,before_data)
 values(p_command,auth.uid(),p_target,p_intent,p_version,p_management_version,before_snapshot);
 return jsonb_build_object('replay',false);
end $$;
create function app_private.finish_corporate_profile_write(p_target uuid,p_command uuid,p_intent jsonb,p_result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare command app_private.corporate_profile_commands; after_snapshot jsonb;
begin
 if not app_private.corporate_profile_available(p_target) then return; end if;
 select * into command from app_private.corporate_profile_commands where id=p_command and actor_id=auth.uid() and trainer_id=p_target and intent=p_intent for update;
 if command.id is null or command.result is not null then raise exception 'corporate_profile_conflict' using errcode='PT409'; end if;
 select to_jsonb(p) into after_snapshot from public.trainer_professional_profiles p where trainer_id=p_target;
 if after_snapshot is null then raise exception 'corporate_profile_invalid' using errcode='PT422'; end if;
 update app_private.corporate_profile_commands set result=p_result where id=p_command;
 insert into app_private.corporate_profile_audit(trainer_id,actor_id,action,before_data,after_data)
 values(p_target,auth.uid(),p_intent->>'action',command.before_data,after_snapshot);
end $$;

create function app_private.set_corporate_profile_management(p_target uuid,p_managed boolean,p_version bigint,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old app_private.corporate_profile_management; previous app_private.corporate_profile_commands; outcome jsonb;
 intent jsonb:=jsonb_build_object('action','management','managed',p_managed);
begin
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 perform app_private.require_corporate_profile_admin(p_target);
 if p_managed is null or p_version is null or p_version<0 or p_command is null then raise exception 'corporate_profile_invalid' using errcode='PT422'; end if;
 select * into previous from app_private.corporate_profile_commands where id=p_command;
 if found then
  if previous.actor_id<>auth.uid() or previous.trainer_id<>p_target or previous.intent<>intent or previous.management_version<>p_version then
   raise exception 'corporate_profile_conflict' using errcode='PT409'; end if;
  return app_private.corporate_profile_management(p_target);
 end if;
 select * into old from app_private.corporate_profile_management where trainer_id=p_target for update;
 if coalesce(old.version,0)<>p_version then raise exception 'corporate_profile_conflict' using errcode='PT409'; end if;
 insert into app_private.corporate_profile_management(trainer_id,managed,version) values(p_target,p_managed,p_version+1)
 on conflict(trainer_id) do update set managed=excluded.managed,version=excluded.version;
 outcome:=app_private.corporate_profile_management(p_target);
 insert into app_private.corporate_profile_commands(id,actor_id,trainer_id,intent,profile_version,management_version,result)
 values(p_command,auth.uid(),p_target,intent,0,p_version,outcome);
 insert into app_private.corporate_profile_audit(trainer_id,actor_id,action,before_data,after_data)
 values(p_target,auth.uid(),'management',jsonb_build_object('managedByAdmin',coalesce(old.managed,false),'version',coalesce(old.version,0)),outcome);
 return outcome;
end $$;
create function app_private.corporate_profile_history(p_target uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.require_corporate_profile_admin(p_target);
 if p_offset is null or p_offset<0 then raise exception 'corporate_profile_invalid' using errcode='PT422'; end if;
 return coalesce((select jsonb_agg(to_jsonb(a) order by occurred_at desc,id desc) from
  (select a.id,a.actor_id,coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Пользователь') as actor_name,
    a.action,a.before_data,a.after_data,a.occurred_at from app_private.corporate_profile_audit a
    join public.profiles p on p.id=a.actor_id
    where a.trainer_id=p_target order by a.occurred_at desc,a.id desc limit 50 offset p_offset) a),'[]'::jsonb);
end $$;

-- Keep both earlier bundle generations intact for API rollback.
create function app_private.corporate_admin_bundle_with_profile_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare bundle jsonb;
begin
 bundle:=app_private.corporate_admin_bundle_with_identity();
 return jsonb_set(bundle,'{trainers}',coalesce((select jsonb_agg(entry.value ||
   jsonb_build_object('profileEditingAvailable',app_private.can_admin_corporate_profile((entry.value->>'id')::uuid)) order by entry.ordinality)
   from jsonb_array_elements(bundle->'trainers') with ordinality entry(value,ordinality)),'[]'::jsonb));
end $$;
revoke all on function app_private.corporate_admin_bundle_with_profile_access() from public;
grant execute on function app_private.corporate_admin_bundle_with_profile_access() to fit_api;

-- Reset inside the existing status transaction, including direct command callers.
create or replace function app_private.save_corporate_trainer(p_id uuid,p_enabled boolean,p_offices uuid[],p_version bigint)
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
  if not p_enabled then
    insert into app_private.corporate_profile_audit(trainer_id,actor_id,action,before_data,after_data)
      select p_id,auth.uid(),'status_removed',to_jsonb(m),jsonb_build_object('managed',false,'version',m.version+1)
      from app_private.corporate_profile_management m where trainer_id=p_id and managed;
    insert into app_private.corporate_profile_management(trainer_id,managed,version)
      select p_id,false,1 where exists(select 1 from app_private.corporate_profile_pilot_trainers where profile_id=p_id)
      on conflict(trainer_id) do update set managed=false,version=corporate_profile_management.version+1;
  end if;
  insert into public.corporate_trainers(trainer_id,is_yandex) values(p_id,p_enabled)
    on conflict(trainer_id) do update set is_yandex=excluded.is_yandex,version=corporate_trainers.version+1,updated_at=now();
  delete from public.corporate_trainer_offices where trainer_id=p_id;
  insert into public.corporate_trainer_offices(trainer_id,office_id) select p_id,unnest(office_ids);
  insert into app_private.corporate_admin_audit(actor_id,entity_kind,entity_id,before_data,after_data)
    values(auth.uid(),'trainer',p_id,jsonb_build_object('isYandex',coalesce(old_row.is_yandex,false),'officeIds',old_offices),
      jsonb_build_object('isYandex',p_enabled,'officeIds',office_ids));
end $$;

revoke all on function app_private.corporate_profile_available(uuid) from public;
grant execute on function app_private.corporate_profile_available(uuid) to fit_api;

revoke all on function app_private.can_admin_corporate_profile(uuid) from public;
grant execute on function app_private.can_admin_corporate_profile(uuid) to fit_api;

revoke all on function app_private.require_corporate_profile_admin(uuid) from public;
grant execute on function app_private.require_corporate_profile_admin(uuid) to fit_api;

revoke all on function app_private.corporate_profile_owner_can_write(uuid) from public;
grant execute on function app_private.corporate_profile_owner_can_write(uuid) to fit_api;

revoke all on function app_private.corporate_profile_management(uuid) from public;
grant execute on function app_private.corporate_profile_management(uuid) to fit_api;

revoke all on function app_private.check_corporate_profile_write(uuid,boolean) from public;
grant execute on function app_private.check_corporate_profile_write(uuid,boolean) to fit_api;

revoke all on function app_private.begin_corporate_profile_write(uuid,boolean,bigint,bigint,uuid,jsonb) from public;
grant execute on function app_private.begin_corporate_profile_write(uuid,boolean,bigint,bigint,uuid,jsonb) to fit_api;

revoke all on function app_private.finish_corporate_profile_write(uuid,uuid,jsonb,jsonb) from public;
grant execute on function app_private.finish_corporate_profile_write(uuid,uuid,jsonb,jsonb) to fit_api;

revoke all on function app_private.set_corporate_profile_management(uuid,boolean,bigint,uuid) from public;
grant execute on function app_private.set_corporate_profile_management(uuid,boolean,bigint,uuid) to fit_api;

revoke all on function app_private.corporate_profile_history(uuid,integer) from public;
grant execute on function app_private.corporate_profile_history(uuid,integer) to fit_api;

-- Down Migration
-- Empty-schema rollback is safe. Once used, retain the audit and protection.
do $$ begin
 if exists(select 1 from app_private.corporate_profile_pilot_trainers)
 or exists(select 1 from app_private.corporate_profile_management)
 or exists(select 1 from app_private.corporate_profile_commands)
 or exists(select 1 from app_private.corporate_profile_audit) then
  raise exception 'corporate_profile_history_in_use'; end if;
end $$;
drop function app_private.corporate_admin_bundle_with_profile_access();
create or replace function app_private.save_corporate_trainer(p_id uuid,p_enabled boolean,p_offices uuid[],p_version bigint)
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

drop policy trainer_profiles_read_own on public.trainer_professional_profiles;
drop policy trainer_profiles_insert_own on public.trainer_professional_profiles;
drop policy trainer_profiles_update_own on public.trainer_professional_profiles;
drop policy trainer_profiles_admin_read on public.trainer_professional_profiles;
drop policy trainer_profiles_admin_insert on public.trainer_professional_profiles;
drop policy trainer_profiles_admin_update on public.trainer_professional_profiles;
create policy trainer_profiles_manage_own on public.trainer_professional_profiles for all to fit_api
 using(trainer_id=(select auth.uid())) with check(trainer_id=(select auth.uid()));
drop function app_private.corporate_profile_history(uuid,integer);
drop function app_private.set_corporate_profile_management(uuid,boolean,bigint,uuid);
drop function app_private.finish_corporate_profile_write(uuid,uuid,jsonb,jsonb);
drop function app_private.begin_corporate_profile_write(uuid,boolean,bigint,bigint,uuid,jsonb);
drop function app_private.check_corporate_profile_write(uuid,boolean);
drop function app_private.corporate_profile_management(uuid);
drop function app_private.corporate_profile_owner_can_write(uuid);
drop function app_private.require_corporate_profile_admin(uuid);
drop function app_private.can_admin_corporate_profile(uuid);
drop function app_private.corporate_profile_available(uuid);
drop table app_private.corporate_profile_audit;
drop table app_private.corporate_profile_commands;
drop table app_private.corporate_profile_management;
drop table app_private.corporate_profile_pilot_trainers;
