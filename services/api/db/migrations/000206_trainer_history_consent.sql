-- Up Migration

-- Consent belongs to one relationship period. No existing relationship is opted in.
create table if not exists app_private.trainer_history_access (
  relationship_id uuid primary key references public.client_trainer_relationships(id) on delete cascade,
  enabled boolean not null default false,
  solo_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table app_private.trainer_history_access enable row level security;
revoke all on app_private.trainer_history_access from public,fit_api;
alter table app_private.connection_requests add column if not exists share_history boolean not null default false;
alter table app_private.connection_requests add column if not exists share_solo_history boolean not null default false;

-- Preserve every existing owner/athlete read rule and add read-only access to
-- prior records for the current, explicitly authorized trainer.
create or replace function app_private.can_read_workout_before_history_consent(p_workout_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = p_workout_id and workout.deleted_at is null
      and (
        client.auth_user_id = auth.uid()
        or (public.is_active_client_trainer_connection(client.id, auth.uid())
          and (workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid())
            or (workout.status in ('in_progress', 'done')
              and client.auth_user_id is not null and workout.created_by = client.auth_user_id)))
        or ((workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid()))
          and exists (
            select 1 from public.client_trainer_relationships relationship
            where relationship.client_id = client.id and relationship.trainer_id = auth.uid()
              and relationship.status = 'disconnected'
              and workout.created_at <= relationship.disconnected_at
          ))
      )
  );
$$;
revoke all on function app_private.can_read_workout_before_history_consent(uuid) from public,fit_api;
create or replace function public.can_read_workout(p_workout_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.workouts w
    join public.clients c on c.id=w.client_id
    left join public.client_trainer_relationships r
      on r.client_id=c.id and r.trainer_id=auth.uid() and r.status='active'
    left join app_private.trainer_history_access h on h.relationship_id=r.id
    where w.id=p_workout_id and w.deleted_at is null and (
      c.auth_user_id=auth.uid()
      or (c.merged_into_client_id is null and (
        r.id is not null or (c.auth_user_id is null and c.trainer_id=auth.uid()
          and exists(select 1 from public.trainers where profile_id=auth.uid()))
      ) and (
        w.created_by=auth.uid() or w.created_by is null and w.trainer_id=auth.uid()
        or (w.status in ('in_progress','done') and c.auth_user_id is not null and w.created_by=c.auth_user_id
          and (w.created_at>r.connected_at or h.relationship_id is null
            or h.enabled or h.solo_enabled and w.training_format='self'))
        or (c.auth_user_id is not null
          and (h.enabled or h.solo_enabled and w.training_format='self'))
      ))
      or ((w.created_by=auth.uid() or w.created_by is null and w.trainer_id=auth.uid())
        and exists(select 1 from public.client_trainer_relationships previous
          where previous.client_id=c.id and previous.trainer_id=auth.uid()
            and previous.status='disconnected' and w.created_at<=previous.disconnected_at))
    ));
$$;
revoke all on function public.can_read_workout(uuid) from public;
grant execute on function public.can_read_workout(uuid) to fit_api;

-- The directory wrapper records the athlete's choice before a trainer's later
-- acceptance; trainer-supplied booleans never grant access.
do $$ begin
  if to_regprocedure('app_private.connection_directory_before_history_consent(text,jsonb)') is null then
    alter function app_private.connection_directory(text,jsonb) rename to connection_directory_before_history_consent;
  end if;
end $$;
revoke all on function app_private.connection_directory_before_history_consent(text,jsonb) from public,fit_api;
create or replace function app_private.connection_directory(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  athlete uuid;
  card uuid;
  relation public.client_trainer_relationships%rowtype;
  req app_private.connection_requests%rowtype;
  result jsonb;
  choice boolean:=coalesce((p_data->>'shareHistory')::boolean,false);
  solo_choice boolean:=coalesce((p_data->>'shareSoloHistory')::boolean,false);
  was_pending boolean:=false;
begin
  if p_action in ('history_access','set_history_access') then
    if not exists(select 1 from public.profiles where id=actor and account_role='client') then
      raise exception 'connection_forbidden' using errcode='PT403';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||actor::text,0));
    select id into card from public.clients where auth_user_id=actor and archived_at is null and merged_into_client_id is null for update;
    select * into relation from public.client_trainer_relationships where client_id=card and status='active';
    if p_action='set_history_access' then
      if relation.id is null or relation.id is distinct from (p_data->>'relationshipId')::uuid then
        raise exception 'connection_changed' using errcode='PT409';
      end if;
      insert into app_private.trainer_history_access(relationship_id,enabled,solo_enabled) values(relation.id,choice,solo_choice)
        on conflict(relationship_id) do update set enabled=excluded.enabled,
          solo_enabled=case when p_data ? 'shareSoloHistory' then excluded.solo_enabled else app_private.trainer_history_access.solo_enabled end,updated_at=now();
      insert into app_private.connection_audit(actor_id,event) values(actor,case when choice then 'history_access_granted' else 'history_access_revoked' end);
    end if;
    if relation.id is null then return null; end if;
    return jsonb_build_object('relationshipId',relation.id,'trainerId',relation.trainer_id,
      'enabled',coalesce((select enabled from app_private.trainer_history_access where relationship_id=relation.id),false),
      'soloEnabled',coalesce((select solo_enabled from app_private.trainer_history_access where relationship_id=relation.id),true));
  end if;
  if p_action='accept' then
    select * into req from app_private.connection_requests where id=(p_data->>'requestId')::uuid;
    was_pending:=req.status='pending';
  end if;
  result:=app_private.connection_directory_before_history_consent(p_action,p_data);
  if p_action not in ('send','accept') or result is null then return result; end if;
  if p_action='send' and result->>'id' is not null then
    select * into req from app_private.connection_requests where id=(result->>'id')::uuid for update;
    if req.athlete_id=actor and req.status='pending' then
      update app_private.connection_requests set share_history=choice,share_solo_history=solo_choice where id=req.id;
    end if;
  end if;
  if result->>'status'='accepted' then
    athlete:=case when exists(select 1 from public.profiles where id=actor and account_role='client') then actor else req.athlete_id end;
    select r.* into relation from public.client_trainer_relationships r join public.clients c on c.id=r.client_id
      where c.auth_user_id=athlete and c.archived_at is null and c.merged_into_client_id is null and r.status='active';
    -- Replays cannot undo a later revocation. Only a fresh acceptance creates a grant.
    if relation.id is not null and (p_action='send' and result->>'id' is not null or was_pending) then
      insert into app_private.trainer_history_access(relationship_id,enabled,solo_enabled)
        values(relation.id,case when actor=athlete then choice else req.share_history end,
          case when actor=athlete then solo_choice else req.share_solo_history end) on conflict do nothing;
    end if;
  end if;
  return result;
end $$;
revoke all on function app_private.connection_directory(text,jsonb) from public;
grant execute on function app_private.connection_directory(text,jsonb) to fit_api;

-- Links, QR/legacy code and chat keep the original atomic claim and receipts.
create table if not exists app_private.trainer_history_confirmation_choices (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  enabled boolean not null,
  solo_enabled boolean not null default false,
  primary key(actor_id,operation_id)
);
alter table app_private.trainer_history_confirmation_choices enable row level security;
revoke all on app_private.trainer_history_confirmation_choices from public,fit_api;
create or replace function app_private.confirm_trainer_connection(p_source text,p_locator text,
  p_expected_relationship uuid,p_offer_version text,p_operation_id uuid,p_share_history boolean,p_share_solo_history boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare card uuid; relation uuid; previous boolean; previous_solo boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_role='client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||auth.uid()::text,0));
  insert into app_private.trainer_history_confirmation_choices values(auth.uid(),p_operation_id,p_share_history,p_share_solo_history) on conflict do nothing;
  select enabled,solo_enabled into previous,previous_solo from app_private.trainer_history_confirmation_choices where actor_id=auth.uid() and operation_id=p_operation_id;
  if previous is distinct from p_share_history or previous_solo is distinct from p_share_solo_history then raise exception 'connection_changed' using errcode='PT409'; end if;
  card:=app_private.confirm_trainer_connection(p_source,p_locator,p_expected_relationship,p_offer_version,p_operation_id);
  select relationship_id into relation from app_private.trainer_connection_receipts where actor_id=auth.uid() and operation_id=p_operation_id;
  insert into app_private.trainer_history_access(relationship_id,enabled,solo_enabled) values(relation,p_share_history,p_share_solo_history) on conflict do nothing;
  return card;
end $$;
revoke all on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean,boolean) from public;
grant execute on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean,boolean) to fit_api;

-- Compatibility for callers that only expose the all-history choice.
create or replace function app_private.confirm_trainer_connection(p_source text,p_locator text,
  p_expected_relationship uuid,p_offer_version text,p_operation_id uuid,p_share_history boolean)
returns uuid language sql security definer set search_path='' as $$
  select app_private.confirm_trainer_connection(p_source,p_locator,p_expected_relationship,p_offer_version,p_operation_id,p_share_history,false);
$$;
revoke all on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean) from public;
grant execute on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid,boolean) to fit_api;

-- Duration correction is a mutation, so shared-history read access must not widen it.
create or replace function public.set_workout_actual_duration(
  p_workout_id uuid, p_duration_sec integer, p_expected_version bigint
)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  workout_row public.workouts%rowtype;
  next_version bigint;
begin
  if actor_id is null or not public.can_read_workout(p_workout_id)
    or not app_private.can_read_workout_before_history_consent(p_workout_id) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  select workout.* into workout_row from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null
  for update;
  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if p_expected_version is null or p_expected_version < 1
    or (p_duration_sec is not null and p_duration_sec not between 1 and 43200) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  -- An identical retry is a no-op, including a lost response after commit.
  if workout_row.actual_duration_sec is not distinct from p_duration_sec then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  update public.workouts workout
  set actual_duration_sec = p_duration_sec, updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  -- Existing duration-sensitive calorie triggers run in this transaction.
  return next_version;
end;
$$;
revoke all on function public.set_workout_actual_duration(uuid, integer, bigint) from public;
grant execute on function public.set_workout_actual_duration(uuid, integer, bigint) to fit_api;


-- Down Migration
-- Forward-only: consent choices and original workout data are retained.
