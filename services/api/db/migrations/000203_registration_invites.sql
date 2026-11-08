-- Up Migration

-- A trainer invitation is explicit consent for one future athlete, without a placeholder card.
create table if not exists app_private.registration_invites (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(profile_id) on delete cascade,
  token_sha256 text not null unique check(token_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  revoked_at timestamptz,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  request_id uuid references app_private.connection_requests(id) on delete set null,
  relationship_id uuid references public.client_trainer_relationships(id) on delete set null
);
alter table app_private.registration_invites enable row level security;
revoke all on app_private.registration_invites from public,fit_api;

-- Preserve the actor-scoped directory and its consent/relationship locks behind a private wrapper.
do $$ begin
  if to_regprocedure('app_private.connection_directory_before_registration_invites(text,jsonb)') is null then
    alter function app_private.connection_directory(text,jsonb) rename to connection_directory_before_registration_invites;
  end if;
end $$;
revoke all on function app_private.connection_directory_before_registration_invites(text,jsonb) from public,fit_api;

create or replace function app_private.connection_directory(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  actor_role text;
  token text;
  invite app_private.registration_invites%rowtype;
  pending app_private.connection_requests%rowtype;
  result jsonb;
  preview jsonb;
  attempts integer;
begin
  if p_action not in ('create_invitation','revoke_invitation')
    and not (p_action='resolve' and p_data->>'kind'='code' and char_length(p_data->>'value')=32)
    and not (p_action='send' and p_data ? 'invitationCode') then
    return app_private.connection_directory_before_registration_invites(p_action,p_data);
  end if;
  select account_role into actor_role from public.profiles where id=actor;
  if actor is null or actor_role not in ('trainer','client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  if p_action in ('create_invitation','resolve','send') then
    insert into app_private.connection_limits(actor_id,window_start,attempts) values(actor,date_trunc('hour',now()),1)
      on conflict(actor_id,window_start) do update set attempts=app_private.connection_limits.attempts+1
      returning app_private.connection_limits.attempts into attempts;
    if attempts>30 then raise exception 'connection_rate_limited' using errcode='PT429'; end if;
    delete from app_private.connection_limits where actor_id=actor and window_start<now()-interval '1 day';
  end if;
  if p_action='create_invitation' then
    if actor_role<>'trainer' or not exists(select 1 from public.trainers where profile_id=actor) then
      raise exception 'connection_forbidden' using errcode='PT403';
    end if;
    token:=upper(replace(gen_random_uuid()::text,'-',''));
    insert into app_private.registration_invites(trainer_id,token_sha256)
      values(actor,encode(sha256(convert_to(token,'UTF8')),'hex')) returning * into invite;
    insert into app_private.connection_audit(actor_id,event) values(actor,'registration_invitation_created');
    return jsonb_build_object('id',invite.id,'code',token,'expiresAt',invite.expires_at);
  end if;
  token:=case p_action when 'resolve' then p_data->>'value' when 'send' then p_data->>'invitationCode' else p_data->>'code' end;
  if token is null or token !~ '^[A-F0-9]{32}$' then raise exception 'connection_invalid' using errcode='PT422'; end if;
  select * into invite from app_private.registration_invites where token_sha256=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
  if p_action='revoke_invitation' then
    if invite.id is null or invite.trainer_id<>actor then raise exception 'connection_forbidden' using errcode='PT403'; end if;
    update app_private.registration_invites set revoked_at=coalesce(revoked_at,now()) where id=invite.id;
    insert into app_private.connection_audit(actor_id,event) values(actor,'registration_invitation_revoked');
    return jsonb_build_object('status','revoked');
  end if;
  if actor_role<>'client' then
    if p_action='resolve' then return null; end if;
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  if invite.id is null or invite.revoked_at is not null
    or (invite.claimed_at is null and invite.expires_at<=now())
    or (invite.claimed_at is not null and invite.claimed_by is distinct from actor) then
    if p_action='resolve' then return null; end if;
    raise exception 'connection_offer_unavailable' using errcode='PT409';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||actor::text,0));
  preview:=app_private.connection_directory_before_registration_invites('preview',jsonb_build_object('peerId',invite.trainer_id));
  if invite.claimed_at is not null then
    if not exists(select 1 from public.client_trainer_relationships r join public.clients c on c.id=r.client_id
      where r.id=invite.relationship_id and r.status='active' and r.trainer_id=invite.trainer_id
        and c.auth_user_id=actor and c.archived_at is null and c.merged_into_client_id is null) then
      raise exception 'connection_changed' using errcode='PT409';
    end if;
    if p_action='send' then
      if (p_data->>'peerId')::uuid is distinct from invite.trainer_id then raise exception 'connection_invalid' using errcode='PT422'; end if;
      return jsonb_build_object('id',invite.request_id,'status','accepted');
    end if;
  end if;
  if p_action='resolve' then return preview||jsonb_build_object('invitationCode',token); end if;
  if (p_data->>'peerId')::uuid is distinct from invite.trainer_id then raise exception 'connection_invalid' using errcode='PT422'; end if;
  -- Never reuse an earlier athlete-originated consent as a fresh confirmation.
  select * into pending from app_private.connection_requests
    where trainer_id=invite.trainer_id and athlete_id=actor and status='pending' for update;
  if pending.id is not null and (pending.initiated_by=actor or pending.expires_at<=now()) then
    update app_private.connection_requests set status='cancelled',decided_at=now() where id=pending.id;
    insert into app_private.connection_audit(actor_id,request_id,event) values(actor,pending.id,'superseded_by_registration_invitation');
    pending.id:=null;
  end if;
  if pending.id is null then
    insert into app_private.connection_requests(trainer_id,athlete_id,initiated_by)
      values(invite.trainer_id,actor,invite.trainer_id) returning * into pending;
    insert into app_private.connection_audit(actor_id,request_id,event) values(actor,pending.id,'registration_invitation_received');
  end if;
  -- The existing accept command verifies the athlete's current relationship snapshot,
  -- creates only their registered own card, switches atomically, and preserves history.
  result:=app_private.connection_directory_before_registration_invites('accept',p_data||jsonb_build_object('requestId',pending.id));
  update app_private.registration_invites set claimed_by=actor,claimed_at=now(),request_id=pending.id,
    relationship_id=(select accepted_relationship_id from app_private.connection_requests where id=pending.id)
    where id=invite.id;
  return result||jsonb_build_object('id',pending.id);
end $$;
revoke all on function app_private.connection_directory(text,jsonb) from public;
grant execute on function app_private.connection_directory(text,jsonb) to fit_api;

-- Down Migration
-- Retain issued invitations, consumed receipts and coaching history on rollback.
