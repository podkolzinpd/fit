-- Up Migration
-- Explicit admin-confirmed test enrollment replaces only the closed invitation
-- restriction. Legacy feature pilots are preserved byte-for-byte.
alter table app_private.corporate_trainer_invitations add column recipient_email text;
create table app_private.corporate_testing_trainers (
 trainer_id uuid primary key references public.trainers(profile_id),
 enabled boolean not null default false, version bigint not null default 1 check(version>0)
);
create table app_private.corporate_testing_audit (
 id uuid primary key default gen_random_uuid(), trainer_id uuid not null references public.trainers(profile_id),
 actor_id uuid not null references public.profiles(id), before_enabled boolean not null, after_enabled boolean not null,
 created_at timestamptz not null default now()
);
alter table app_private.corporate_testing_trainers enable row level security;
alter table app_private.corporate_testing_audit enable row level security;
revoke all on app_private.corporate_testing_trainers,app_private.corporate_testing_audit from public,fit_api;
create function app_private.corporate_testing_enabled(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.corporate_testing_trainers where trainer_id=p_target and enabled)
$$;
revoke all on function app_private.corporate_testing_enabled(uuid) from public,fit_api;

create function app_private.set_corporate_testing(p_target uuid,p_enabled boolean,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare old_row app_private.corporate_testing_trainers;
begin
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 if p_enabled is null or p_version is null or p_version<0 then raise exception 'corporate_invalid' using errcode='PT422'; end if;
 if not exists(select 1 from public.profiles p join public.corporate_trainers c on c.trainer_id=p.id
   where p.id=p_target and p.account_role='trainer' and c.is_yandex) then raise exception 'corporate_not_found' using errcode='PT404'; end if;
 select * into old_row from app_private.corporate_testing_trainers where trainer_id=p_target for update;
 if old_row.trainer_id is not null and old_row.enabled=p_enabled and old_row.version=p_version+1 then return; end if;
 if coalesce(old_row.version,0)<>p_version then raise exception 'corporate_conflict' using errcode='PT409'; end if;
 -- Removing enrollment must not silently unlock an administrator-managed profile.
 if not p_enabled and exists(select 1 from app_private.corporate_profile_management where trainer_id=p_target and managed) then
   raise exception 'corporate_testing_managed' using errcode='PT409'; end if;
 if coalesce(old_row.enabled,false)=p_enabled then return; end if;
 insert into app_private.corporate_testing_trainers(trainer_id,enabled) values(p_target,p_enabled)
 on conflict(trainer_id) do update set enabled=excluded.enabled,version=corporate_testing_trainers.version+1;
 insert into app_private.corporate_testing_audit(trainer_id,actor_id,before_enabled,after_enabled)
 values(p_target,auth.uid(),coalesce(old_row.enabled,false),p_enabled);
end $$;
revoke all on function app_private.set_corporate_testing(uuid,boolean,bigint) from public;
grant execute on function app_private.set_corporate_testing(uuid,boolean,bigint) to fit_api;

create function app_private.create_corporate_invitation_for_recipient(p_id uuid,p_hash text,p_offices uuid[],p_email text) returns void
language plpgsql security definer set search_path='' as $$
declare email text:=nullif(lower(btrim(p_email)),''); previous app_private.corporate_trainer_invitations;
begin
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 if email is not null and (length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or email ~ '[[:cntrl:]]') then
  raise exception 'corporate_email_invalid' using errcode='PT422'; end if;
 select * into previous from app_private.corporate_trainer_invitations where id=p_id for update;
 if found and previous.recipient_email is distinct from email then raise exception 'corporate_conflict' using errcode='PT409'; end if;
 if previous.id is null and email is not null and exists(select 1 from app_private.corporate_trainer_invitations i
  where i.recipient_email=email and i.revoked_at is null and i.approved_at is null and i.expires_at>now()) then
  raise exception 'corporate_recipient_pending' using errcode='PT409'; end if;
 perform app_private.create_corporate_trainer_invitation(p_id,p_hash,p_offices);
 update app_private.corporate_trainer_invitations set recipient_email=email where id=p_id;
end $$;
revoke all on function app_private.create_corporate_invitation_for_recipient(uuid,text,uuid[],text) from public;
grant execute on function app_private.create_corporate_invitation_for_recipient(uuid,text,uuid[],text) to fit_api;

create or replace function app_private.corporate_services_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex

    where (app_private.corporate_testing_enabled(p.id) or exists(select 1 from app_private.corporate_service_pilot_trainers legacy where legacy.profile_id=p.id and legacy.enabled)) and p.id=auth.uid() and p.account_role='trainer' and exists(
      select 1 from public.corporate_trainer_offices b join public.corporate_offices o on o.id=b.office_id
      where b.trainer_id=p.id and not o.archived))
$$;

create or replace function app_private.corporate_personal_trainer_allowed(p_trainer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex

    where (app_private.corporate_testing_enabled(p.id) or exists(select 1 from app_private.corporate_personal_pilot_trainers legacy where legacy.profile_id=p.id and legacy.enabled)) and p.id=p_trainer and p.account_role='trainer')
$$;

create or replace function app_private.corporate_duty_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.corporate_trainers t on t.trainer_id=p.id and t.is_yandex

    where (app_private.corporate_testing_enabled(p.id) or exists(select 1 from app_private.corporate_duty_pilot_trainers legacy where legacy.profile_id=p.id and legacy.enabled)) and p.id=auth.uid() and p.account_role='trainer')
$$;

create or replace function app_private.corporate_profile_available(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.corporate_trainers c
 join public.profiles p on p.id=c.trainer_id and p.account_role='trainer'

 where (app_private.corporate_testing_enabled(c.trainer_id) or exists(select 1 from app_private.corporate_profile_pilot_trainers legacy where legacy.profile_id=c.trainer_id and legacy.enabled)) and c.trainer_id=p_target and c.is_yandex)
$$;

create or replace function app_private.claim_corporate_trainer_invitation(p_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare v app_private.corporate_trainer_invitations; state text;
begin
  if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=auth.uid() and p.account_role='trainer') then
    raise exception 'corporate_trainer_required' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- Pilot or account access can be revoked while this command waits.
  if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=auth.uid() and p.account_role='trainer') then
    raise exception 'corporate_trainer_required' using errcode='PT403'; end if;
  select * into v from app_private.corporate_trainer_invitations where token_sha256=p_hash for update;
  if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  state:=app_private.corporate_invitation_status(v);
  if v.claimed_by=auth.uid() and state in ('claimed','approved') then return state; end if;
  if state<>'active' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
  if not app_private.corporate_invitation_offices_valid(v.office_ids) then raise exception 'corporate_invalid' using errcode='PT422'; end if;
  update app_private.corporate_trainer_invitations set claimed_by=auth.uid(),claimed_at=now() where id=v.id;
  insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(v.id,auth.uid(),'claim');
  return 'claimed';
end $$;

create or replace function app_private.decide_corporate_trainer_invitation(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v app_private.corporate_trainer_invitations; state text; current_version bigint;
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_approve is null then raise exception 'corporate_invalid' using errcode='PT422'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- Owner access changes use the same lock; recheck after any wait.
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  select * into v from app_private.corporate_trainer_invitations where id=p_id for update;
  if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  state:=app_private.corporate_invitation_status(v);
  if p_approve then
    if state='approved' then return; end if;
    if state<>'claimed' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
    if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=v.claimed_by and p.account_role='trainer') then
      raise exception 'corporate_not_found' using errcode='PT404'; end if;
    if not app_private.corporate_invitation_offices_valid(v.office_ids) then raise exception 'corporate_invalid' using errcode='PT422'; end if;
    if not exists(select 1 from public.corporate_trainers where trainer_id=v.claimed_by and is_yandex) then
      select coalesce((select version from public.corporate_trainers where trainer_id=v.claimed_by),0) into current_version;
      perform app_private.save_corporate_trainer(v.claimed_by,true,v.office_ids,current_version);
    end if;
    update app_private.corporate_trainer_invitations set approved_by=auth.uid(),approved_at=now() where id=p_id;
    insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(p_id,auth.uid(),'approve');
  else
    if state='revoked' then return; end if;
    if state='approved' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
    update app_private.corporate_trainer_invitations set revoked_at=now() where id=p_id;
    insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(p_id,auth.uid(),'revoke');
  end if;
end $$;

create or replace function app_private.list_corporate_trainer_invitations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',app_private.corporate_invitation_status(i),
    'recipientEmail',i.recipient_email,'createdAt',i.created_at,'expiresAt',i.expires_at,'officeIds',i.office_ids,
    'trainerName',case when i.claimed_at is not null then coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Аккаунт недоступен') else null end)
    order by (i.approved_at is null and i.revoked_at is null and i.expires_at>now()) desc,i.created_at desc) from (select * from app_private.corporate_trainer_invitations
      order by (approved_at is null and revoked_at is null and expires_at>now()) desc,created_at desc limit 400) i
    left join public.profiles p on p.id=i.claimed_by),'[]'::jsonb);
end $$;

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
    insert into app_private.corporate_testing_audit(trainer_id,actor_id,before_enabled,after_enabled)
      select p_id,auth.uid(),enabled,false from app_private.corporate_testing_trainers where trainer_id=p_id and enabled;
    update app_private.corporate_testing_trainers set enabled=false,version=version+1 where trainer_id=p_id and enabled;
    insert into app_private.corporate_profile_audit(trainer_id,actor_id,action,before_data,after_data)
      select p_id,auth.uid(),'status_removed',to_jsonb(m),jsonb_build_object('managed',false,'version',m.version+1)
      from app_private.corporate_profile_management m where trainer_id=p_id and managed;
    insert into app_private.corporate_profile_management(trainer_id,managed,version)
      select p_id,false,1 where exists(select 1 from app_private.corporate_profile_management where trainer_id=p_id) or exists(select 1 from app_private.corporate_profile_pilot_trainers where profile_id=p_id) or exists(select 1 from app_private.corporate_testing_trainers where trainer_id=p_id)
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

create function app_private.confirm_corporate_invitation_testing(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare invitation app_private.corporate_trainer_invitations; current_version bigint;
begin
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 perform pg_catalog.pg_advisory_xact_lock(159,1);
 if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
 select * into invitation from app_private.corporate_trainer_invitations where id=p_id for update;
 if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
 -- A repeated confirmation never re-enables access revoked after approval.
 if app_private.corporate_invitation_status(invitation)='approved' then return; end if;
 perform app_private.decide_corporate_trainer_invitation(p_id,true);
 select version into current_version from app_private.corporate_testing_trainers where trainer_id=invitation.claimed_by;
 perform app_private.set_corporate_testing(invitation.claimed_by,true,coalesce(current_version,0));
end $$;
revoke all on function app_private.confirm_corporate_invitation_testing(uuid) from public;
grant execute on function app_private.confirm_corporate_invitation_testing(uuid) to fit_api;
create function app_private.corporate_admin_bundle_with_testing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare bundle jsonb;
begin
 bundle:=app_private.corporate_admin_bundle_with_profile_access();
 return jsonb_set(bundle,'{trainers}',coalesce((select jsonb_agg(entry.value ||
  jsonb_build_object('testingEnabled',coalesce(t.enabled,false),'testingVersion',coalesce(t.version,0)) order by entry.ordinality)
  from jsonb_array_elements(bundle->'trainers') with ordinality entry(value,ordinality)
  left join app_private.corporate_testing_trainers t on t.trainer_id=(entry.value->>'id')::uuid),'[]'::jsonb));
end $$;
revoke all on function app_private.corporate_admin_bundle_with_testing() from public;
grant execute on function app_private.corporate_admin_bundle_with_testing() to fit_api;

-- Down Migration
-- Never discard an enrolled cohort, its audit, or addressed invitations.
do $$ begin
 if exists(select 1 from app_private.corporate_testing_trainers)
 or exists(select 1 from app_private.corporate_testing_audit)
 or exists(select 1 from app_private.corporate_trainer_invitations where recipient_email is not null) then
 raise exception 'corporate_testing_rollback_requires_empty_state'; end if;
end $$;
drop function app_private.corporate_admin_bundle_with_testing();
drop function app_private.confirm_corporate_invitation_testing(uuid);
drop function app_private.create_corporate_invitation_for_recipient(uuid,text,uuid[],text);
create or replace function app_private.corporate_services_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex
    join app_private.corporate_service_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=auth.uid() and p.account_role='trainer' and exists(
      select 1 from public.corporate_trainer_offices b join public.corporate_offices o on o.id=b.office_id
      where b.trainer_id=p.id and not o.archived))
$$;

create or replace function app_private.corporate_personal_trainer_allowed(p_trainer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p
    join public.trainers t on t.profile_id=p.id
    join public.corporate_trainers c on c.trainer_id=p.id and c.is_yandex
    join app_private.corporate_personal_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=p_trainer and p.account_role='trainer')
$$;

create or replace function app_private.corporate_duty_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.corporate_trainers t on t.trainer_id=p.id and t.is_yandex
    join app_private.corporate_duty_pilot_trainers pilot on pilot.profile_id=p.id and pilot.enabled
    where p.id=auth.uid() and p.account_role='trainer')
$$;

create or replace function app_private.corporate_profile_available(p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.corporate_trainers c
 join public.profiles p on p.id=c.trainer_id and p.account_role='trainer'
 join app_private.corporate_profile_pilot_trainers f on f.profile_id=c.trainer_id and f.enabled
 where c.trainer_id=p_target and c.is_yandex)
$$;

create or replace function app_private.claim_corporate_trainer_invitation(p_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare v app_private.corporate_trainer_invitations; state text;
begin
  if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=auth.uid() and p.account_role='trainer') then
    raise exception 'corporate_trainer_required' using errcode='PT403'; end if;
  if not exists(select 1 from app_private.corporate_invitation_pilot_trainers where profile_id=auth.uid() and enabled) then
    raise exception 'corporate_invitation_pilot_only' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- Pilot or account access can be revoked while this command waits.
  if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=auth.uid() and p.account_role='trainer') then
    raise exception 'corporate_trainer_required' using errcode='PT403'; end if;
  if not exists(select 1 from app_private.corporate_invitation_pilot_trainers where profile_id=auth.uid() and enabled) then
    raise exception 'corporate_invitation_pilot_only' using errcode='PT403'; end if;
  select * into v from app_private.corporate_trainer_invitations where token_sha256=p_hash for update;
  if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  state:=app_private.corporate_invitation_status(v);
  if v.claimed_by=auth.uid() and state in ('claimed','approved') then return state; end if;
  if state<>'active' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
  if exists(select 1 from public.corporate_trainers where trainer_id=auth.uid() and is_yandex) then return 'already_member'; end if;
  if not app_private.corporate_invitation_offices_valid(v.office_ids) then raise exception 'corporate_invalid' using errcode='PT422'; end if;
  update app_private.corporate_trainer_invitations set claimed_by=auth.uid(),claimed_at=now() where id=v.id;
  insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(v.id,auth.uid(),'claim');
  return 'claimed';
end $$;

create or replace function app_private.decide_corporate_trainer_invitation(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v app_private.corporate_trainer_invitations; state text; current_version bigint;
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_approve is null then raise exception 'corporate_invalid' using errcode='PT422'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- Owner access changes use the same lock; recheck after any wait.
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  select * into v from app_private.corporate_trainer_invitations where id=p_id for update;
  if not found then raise exception 'corporate_not_found' using errcode='PT404'; end if;
  state:=app_private.corporate_invitation_status(v);
  if p_approve then
    if state='approved' then return; end if;
    if state<>'claimed' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
    if not exists(select 1 from public.profiles p join public.trainers t on t.profile_id=p.id where p.id=v.claimed_by and p.account_role='trainer') then
      raise exception 'corporate_not_found' using errcode='PT404'; end if;
    if not exists(select 1 from app_private.corporate_invitation_pilot_trainers where profile_id=v.claimed_by and enabled) then
      raise exception 'corporate_invitation_pilot_only' using errcode='PT403'; end if;
    if not app_private.corporate_invitation_offices_valid(v.office_ids) then raise exception 'corporate_invalid' using errcode='PT422'; end if;
    if not exists(select 1 from public.corporate_trainers where trainer_id=v.claimed_by and is_yandex) then
      select coalesce((select version from public.corporate_trainers where trainer_id=v.claimed_by),0) into current_version;
      perform app_private.save_corporate_trainer(v.claimed_by,true,v.office_ids,current_version);
    end if;
    update app_private.corporate_trainer_invitations set approved_by=auth.uid(),approved_at=now() where id=p_id;
    insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(p_id,auth.uid(),'approve');
  else
    if state='revoked' then return; end if;
    if state='approved' then raise exception 'corporate_invitation_unavailable' using errcode='PT409'; end if;
    update app_private.corporate_trainer_invitations set revoked_at=now() where id=p_id;
    insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(p_id,auth.uid(),'revoke');
  end if;
end $$;

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

create or replace function app_private.list_corporate_trainer_invitations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',app_private.corporate_invitation_status(i),
    'createdAt',i.created_at,'expiresAt',i.expires_at,'officeIds',i.office_ids,
    'trainerName',case when i.claimed_at is not null then coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Аккаунт недоступен') else null end)
    order by (i.approved_at is null and i.revoked_at is null and i.expires_at>now()) desc,i.created_at desc) from (select * from app_private.corporate_trainer_invitations
      order by (approved_at is null and revoked_at is null and expires_at>now()) desc,created_at desc limit 400) i
    left join public.profiles p on p.id=i.claimed_by),'[]'::jsonb);
end $$;
drop function app_private.set_corporate_testing(uuid,boolean,bigint);
drop function app_private.corporate_testing_enabled(uuid);
drop table app_private.corporate_testing_audit;
drop table app_private.corporate_testing_trainers;
alter table app_private.corporate_trainer_invitations drop column recipient_email;
