-- Up Migration

create table app_private.corporate_invitation_pilot_trainers (
  profile_id uuid primary key references public.trainers(profile_id) on delete cascade,
  enabled boolean not null default false
);
create table app_private.corporate_trainer_invitations (
  id uuid primary key,
  token_sha256 text unique not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  office_ids uuid[] not null check(cardinality(office_ids) between 1 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz
);
create index corporate_invitation_pending_expiry on app_private.corporate_trainer_invitations(expires_at)
  where revoked_at is null and approved_at is null;
create index corporate_invitation_created on app_private.corporate_trainer_invitations(created_at desc);
create table app_private.corporate_invitation_audit (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references app_private.corporate_trainer_invitations(id),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('create','claim','approve','revoke')),
  created_at timestamptz not null default now(),
  unique(invitation_id, action)
);
alter table app_private.corporate_invitation_pilot_trainers enable row level security;
alter table app_private.corporate_trainer_invitations enable row level security;
alter table app_private.corporate_invitation_audit enable row level security;
revoke all on app_private.corporate_invitation_pilot_trainers,app_private.corporate_trainer_invitations,app_private.corporate_invitation_audit from public,fit_api;

create function app_private.corporate_invitation_status(p app_private.corporate_trainer_invitations)
returns text language sql stable set search_path='' as $$
  select case when p.approved_at is not null then 'approved'
    when p.revoked_at is not null then 'revoked' when p.expires_at<=now() then 'expired'
    when p.claimed_at is not null then 'claimed' else 'active' end
$$;
revoke all on function app_private.corporate_invitation_status(app_private.corporate_trainer_invitations) from public,fit_api;

create function app_private.corporate_invitation_offices_valid(p_ids uuid[])
returns boolean language sql stable security definer set search_path='' as $$
  select p_ids is not null and cardinality(p_ids) between 1 and 100
    and array_position(p_ids,null) is null and not exists(select 1 from unnest(p_ids) x
      where not exists(select 1 from public.corporate_offices o where o.id=x and not o.archived))
$$;
revoke all on function app_private.corporate_invitation_offices_valid(uuid[]) from public,fit_api;

create function app_private.create_corporate_trainer_invitation(p_id uuid,p_hash text,p_offices uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v app_private.corporate_trainer_invitations; offices uuid[];
begin
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  perform pg_catalog.pg_advisory_xact_lock(159,1);
  -- Owner access changes use the same lock; recheck after any wait.
  if not app_private.is_corporate_admin() then raise exception 'corporate_forbidden' using errcode='PT403'; end if;
  if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or not app_private.corporate_invitation_offices_valid(p_offices) then
    raise exception 'corporate_invalid' using errcode='PT422'; end if;
  select array_agg(distinct x order by x) into offices from unnest(p_offices) x;
  select * into v from app_private.corporate_trainer_invitations where id=p_id for update;
  if found then
    -- A lost create response may retry the same operation before it is claimed.
    -- Return a new server-generated secret for the same invitation, invalidating the lost one.
    if v.created_by is distinct from auth.uid() or v.office_ids<>offices or app_private.corporate_invitation_status(v)<>'active' then
      raise exception 'corporate_conflict' using errcode='PT409'; end if;
    update app_private.corporate_trainer_invitations set token_sha256=p_hash where id=p_id;
    return;
  end if;
  if (select count(*) from app_private.corporate_trainer_invitations i where i.revoked_at is null and i.approved_at is null and i.expires_at>now())>=200 then
    raise exception 'corporate_invitation_limit' using errcode='PT409'; end if;
  insert into app_private.corporate_trainer_invitations(id,token_sha256,created_by,office_ids) values(p_id,p_hash,auth.uid(),offices);
  insert into app_private.corporate_invitation_audit(invitation_id,actor_id,action) values(p_id,auth.uid(),'create');
end $$;

create function app_private.preview_corporate_trainer_invitation(p_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('status',app_private.corporate_invitation_status(i),'expiresAt',i.expires_at,
    'offices',coalesce((select jsonb_agg(jsonb_build_object('city',o.city,'name',o.name) order by o.city,o.name)
      from public.corporate_offices o where o.id=any(i.office_ids)),'[]'::jsonb))
  from app_private.corporate_trainer_invitations i where i.token_sha256=p_hash
$$;

create function app_private.list_corporate_trainer_invitations()
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

create function app_private.claim_corporate_trainer_invitation(p_hash text)
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

create function app_private.decide_corporate_trainer_invitation(p_id uuid,p_approve boolean)
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

revoke all on function app_private.create_corporate_trainer_invitation(uuid,text,uuid[]),
  app_private.preview_corporate_trainer_invitation(text),app_private.list_corporate_trainer_invitations(),
  app_private.claim_corporate_trainer_invitation(text),app_private.decide_corporate_trainer_invitation(uuid,boolean) from public;
grant execute on function app_private.create_corporate_trainer_invitation(uuid,text,uuid[]),
  app_private.preview_corporate_trainer_invitation(text),app_private.list_corporate_trainer_invitations(),
  app_private.claim_corporate_trainer_invitation(text),app_private.decide_corporate_trainer_invitation(uuid,boolean) to fit_api;

-- Down Migration

drop function app_private.decide_corporate_trainer_invitation(uuid,boolean);
drop function app_private.claim_corporate_trainer_invitation(text);
drop function app_private.list_corporate_trainer_invitations();
drop function app_private.preview_corporate_trainer_invitation(text);
drop function app_private.create_corporate_trainer_invitation(uuid,text,uuid[]);
drop function app_private.corporate_invitation_offices_valid(uuid[]);
drop function app_private.corporate_invitation_status(app_private.corporate_trainer_invitations);
drop table app_private.corporate_invitation_audit;
drop table app_private.corporate_trainer_invitations;
drop table app_private.corporate_invitation_pilot_trainers;
