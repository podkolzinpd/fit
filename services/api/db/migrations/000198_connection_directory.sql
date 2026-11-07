-- Up Migration

-- Reapplication after a rollback preserves connection records and restores routines.
-- login_sha256 follows the retained discovery-binding contract; it hashes an exact provider email.
create table if not exists app_private.connection_email_bindings (
  subject_sha256 text not null check(subject_sha256 ~ '^[a-f0-9]{64}$'),
  login_sha256 text not null check(login_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default now(),
  primary key(subject_sha256,login_sha256)
);
create index if not exists connection_email_lookup on app_private.connection_email_bindings(login_sha256);
create table if not exists app_private.connection_locators (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),
  updated_at timestamptz not null default now()
);
create table if not exists app_private.connection_requests (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(profile_id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  expected_relationship_id uuid references public.client_trainer_relationships(id) on delete set null,
  expected_revision timestamptz,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  decided_at timestamptz,
  check(initiated_by in (trainer_id,athlete_id)),
  check(trainer_id<>athlete_id)
);
create unique index if not exists connection_request_pending_pair on app_private.connection_requests(trainer_id,athlete_id) where status='pending';
create table if not exists app_private.connection_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references app_private.connection_requests(id) on delete cascade,
  event text not null,
  created_at timestamptz not null default now()
);
create table if not exists app_private.connection_limits (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null,
  primary key(actor_id,window_start)
);
alter table app_private.connection_email_bindings enable row level security;
alter table app_private.connection_locators enable row level security;
alter table app_private.connection_requests enable row level security;
alter table app_private.connection_audit enable row level security;
alter table app_private.connection_limits enable row level security;
revoke all on app_private.connection_email_bindings,app_private.connection_locators,
  app_private.connection_requests,app_private.connection_audit,app_private.connection_limits from public,fit_api;

-- Only the server's verified OAuth provider observer calls this function.
-- A mailbox is a discovery hint and is never an authorization credential.
create or replace function app_private.observe_connection_emails(p_subject text,p_hashes text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_subject !~ '^[a-f0-9]{64}$' or p_hashes is null or cardinality(p_hashes)>10
    or exists(select 1 from unnest(p_hashes) h where h is null or h !~ '^[a-f0-9]{64}$') then
    raise exception 'invalid_email_observation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email-observation:'||p_subject,0));
  delete from app_private.connection_email_bindings where subject_sha256=p_subject;
  insert into app_private.connection_email_bindings(subject_sha256,login_sha256)
    select p_subject,h from (select distinct unnest(p_hashes) h) s;
  delete from app_private.connection_email_bindings e where observed_at<now()-interval '7 days'
    and not exists(select 1 from app_private.auth_identities i where i.provider='yandex' and i.provider_subject_sha256=e.subject_sha256);
end $$;
revoke all on function app_private.observe_connection_emails(text,text[]) from public;
grant execute on function app_private.observe_connection_emails(text,text[]) to fit_api;

create or replace function app_private.clear_connection_emails_on_unlink()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from app_private.connection_email_bindings where subject_sha256=old.provider_subject_sha256;
  return old;
end $$;
revoke all on function app_private.clear_connection_emails_on_unlink() from public,fit_api;
create or replace trigger clear_connection_emails_on_unlink after delete on app_private.auth_identities
  for each row execute function app_private.clear_connection_emails_on_unlink();

create or replace function app_private.connection_directory(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  actor_role text;
  peer uuid;
  peer_role text;
  trainer uuid;
  athlete uuid;
  card uuid;
  active_id uuid;
  old_trainer uuid;
  revision timestamptz;
  code_value text;
  attempt_count integer;
  req app_private.connection_requests%rowtype;
  result jsonb;
begin
  select account_role into actor_role from public.profiles where id=actor;
  if actor is null or actor_role not in ('trainer','client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  if p_action in ('resolve','send','rotate') then
    insert into app_private.connection_limits(actor_id,window_start,attempts)
      values(actor,date_trunc('hour',now()),1)
      on conflict(actor_id,window_start) do update set attempts=app_private.connection_limits.attempts+1
      returning attempts into attempt_count;
    if attempt_count>30 then raise exception 'connection_rate_limited' using errcode='PT429'; end if;
    delete from app_private.connection_limits where actor_id=actor and window_start<now()-interval '1 day';
  end if;
  if p_action in ('self','rotate') then
    insert into app_private.connection_locators(profile_id) values(actor) on conflict do nothing;
    if p_action='rotate' then
      update app_private.connection_locators set code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),updated_at=now() where profile_id=actor;
      insert into app_private.connection_audit(actor_id,event) values(actor,'locator_rotated');
    end if;
    select code into code_value from app_private.connection_locators where profile_id=actor;
    return jsonb_build_object('code',code_value,'fitId',actor,'emailSearchReady',exists(
      select 1 from app_private.auth_identities i join app_private.connection_email_bindings e
      on e.subject_sha256=i.provider_subject_sha256 where i.profile_id=actor and i.provider='yandex'));
  end if;
  if p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'incoming',r.initiated_by<>actor,
      'peerId',p.id,'name',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Пользователь Fit'),
      'role',p.account_role,'expiresAt',r.expires_at) order by r.created_at desc),'[]') into result
      from app_private.connection_requests r join public.profiles p on p.id=case when actor=r.trainer_id then r.athlete_id else r.trainer_id end
      where actor in (r.trainer_id,r.athlete_id) and r.status='pending' and r.expires_at>now();
    return result;
  end if;
  if p_action='status' then
    select * into req from app_private.connection_requests where id=(p_data->>'requestId')::uuid;
    if req.id is null or actor not in (req.trainer_id,req.athlete_id) then raise exception 'connection_forbidden' using errcode='PT403'; end if;
    return jsonb_build_object('status',case when req.status='pending' and req.expires_at<=now() then 'expired' else req.status end);
  end if;
  if p_action='resolve' then
    if p_data->>'kind'='email' then
      select (array_agg(distinct i.profile_id))[1] into peer
        from app_private.connection_email_bindings e join app_private.auth_identities i
          on i.provider_subject_sha256=e.subject_sha256 and i.provider='yandex'
        where e.login_sha256=p_data->>'value' having count(distinct i.profile_id)=1;
    elsif p_data->>'kind'='code' then
      select profile_id into peer from app_private.connection_locators where code=p_data->>'value';
    end if;
  elsif p_action in ('preview','send') then
    peer:=(p_data->>'peerId')::uuid;
  elsif p_action in ('accept','decline','cancel') then
    select * into req from app_private.connection_requests where id=(p_data->>'requestId')::uuid;
    if req.id is null or actor not in (req.trainer_id,req.athlete_id) then raise exception 'connection_forbidden' using errcode='PT403'; end if;
    peer:=case when actor=req.trainer_id then req.athlete_id else req.trainer_id end;
  else
    raise exception 'connection_invalid' using errcode='PT422';
  end if;
  select account_role into peer_role from public.profiles where id=peer;
  if peer is null or peer=actor or peer_role=actor_role or peer_role is null then
    return null;
  end if;
  trainer:=case when actor_role='trainer' then actor else peer end;
  athlete:=case when actor_role='client' then actor else peer end;
  if not exists(select 1 from public.trainers where profile_id=trainer) then raise exception 'connection_forbidden' using errcode='PT403'; end if;
  -- Same lock and canonical card as legacy invite/switch commands.
  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||athlete::text,0));
  select id into card from public.clients where auth_user_id=athlete and archived_at is null and merged_into_client_id is null for update;
  if card is null and actor=athlete and p_action in ('send','accept') then
    select created.client_id into card from public.create_quick_own_client_card(
      (select case when char_length(btrim(concat_ws(' ',first_name,last_name))) between 2 and 120
        then btrim(concat_ws(' ',first_name,last_name)) else 'Спортсмен Fit' end from public.profiles where id=athlete)) created;
  end if;
  if card is null and p_action='accept' then raise exception 'connection_card_missing' using errcode='PT409'; end if;
  select id,trainer_id into active_id,old_trainer from public.client_trainer_relationships where client_id=card and status='active';
  select max(updated_at) into revision from public.client_trainer_relationships where client_id=card;
  if p_action in ('resolve','preview') then
    select jsonb_build_object('id',p.id,'name',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Пользователь Fit'),
      'role',p.account_role,'connected',old_trainer=trainer,
      'expectedRevision',case when actor_role='client' then revision else null end,
      'expectedRelationshipId',case when actor_role='client' then active_id else null end,
      'currentTrainer',case when actor_role='client' and old_trainer is not null then
        (select jsonb_build_object('id',t.id,'name',concat_ws(' ',t.first_name,t.last_name)) from public.profiles t where t.id=old_trainer) else null end)
      into result from public.profiles p where p.id=peer;
    return result;
  end if;
  if p_action='send' then
    if actor_role='client' and (active_id is distinct from (p_data->>'expectedRelationshipId')::uuid
      or revision is distinct from (p_data->>'expectedRevision')::timestamptz) then raise exception 'connection_changed' using errcode='PT409'; end if;
    if old_trainer=trainer then return jsonb_build_object('status','accepted'); end if;
    update app_private.connection_requests set status='cancelled',decided_at=now()
      where trainer_id=trainer and athlete_id=athlete and status='pending' and expires_at<=now();
    select * into req from app_private.connection_requests where trainer_id=trainer and athlete_id=athlete and status='pending' for update;
    if req.id is not null then return jsonb_build_object('id',req.id,'status',req.status); end if;
    insert into app_private.connection_requests(trainer_id,athlete_id,initiated_by,expected_relationship_id,expected_revision)
      values(trainer,athlete,actor,case when actor_role='client' then active_id else null end,
        case when actor_role='client' then revision else null end) returning * into req;
    insert into app_private.connection_audit(actor_id,request_id,event) values(actor,req.id,'requested');
    return jsonb_build_object('id',req.id,'status',req.status);
  end if;
  select * into req from app_private.connection_requests where id=req.id for update;
  if p_action='cancel' and actor<>req.initiated_by or p_action in ('accept','decline') and actor=req.initiated_by then raise exception 'connection_forbidden' using errcode='PT403'; end if;
  if p_action='accept' and req.status='accepted' then
    if old_trainer=trainer then return jsonb_build_object('status','accepted'); end if;
    raise exception 'connection_changed' using errcode='PT409';
  end if;
  if req.status<>'pending' or req.expires_at<=now() then raise exception 'connection_offer_unavailable' using errcode='PT409'; end if;
  if p_action='accept' then
    if revision is distinct from (case when actor_role='trainer' then req.expected_revision else (p_data->>'expectedRevision')::timestamptz end) then
      raise exception 'connection_changed' using errcode='PT409';
    end if;
    if active_id is distinct from (case when actor_role='client' then (p_data->>'expectedRelationshipId')::uuid else req.expected_relationship_id end) then
      raise exception 'connection_changed' using errcode='PT409';
    end if;
    if old_trainer is not null and old_trainer<>trainer then
      -- Athlete consent is checked above even when the trainer is the final actor.
      update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),
        disconnected_by=athlete,updated_at=now() where id=active_id;
      update public.chat_conversations set connection_invited_at=null,connection_accepted_at=null where client_id=card;
      update public.client_invitations set revoked_at=now() where client_id=card and claimed_at is null and revoked_at is null;
    end if;
    perform app_private.connect_single_trainer(card,trainer);
    insert into public.client_trainers(client_id,trainer_id,alias) select card,trainer,full_name from public.clients where id=card on conflict do nothing;
  end if;
  update app_private.connection_requests set status=case p_action when 'accept' then 'accepted' when 'decline' then 'declined' else 'cancelled' end,decided_at=now() where id=req.id returning * into req;
  insert into app_private.connection_audit(actor_id,request_id,event) values(actor,req.id,req.status);
  return jsonb_build_object('id',req.id,'status',req.status);
end $$;
revoke all on function app_private.connection_directory(text,jsonb) from public;
grant execute on function app_private.connection_directory(text,jsonb) to fit_api;

-- Down Migration
-- Forward-only: connection decisions and audit records must be retained.
