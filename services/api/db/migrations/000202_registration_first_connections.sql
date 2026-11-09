-- Up Migration

-- Registration and mutual consent precede new coaching work. Existing history
-- retains its previous read/edit/delete policies; no rows are removed or linked.
create or replace function public.can_create_client_workout(p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.clients c join public.profiles actor on actor.id=auth.uid()
    where c.id=p_client_id and c.archived_at is null and c.merged_into_client_id is null
      and c.auth_user_id is not null and (
        actor.account_role='client' and c.auth_user_id=actor.id
        or actor.account_role='trainer' and exists(select 1 from public.client_trainer_relationships r
          where r.client_id=c.id and r.trainer_id=actor.id and r.status='active')));
$$;
revoke all on function public.can_create_client_workout(uuid) from public;
grant execute on function public.can_create_client_workout(uuid) to fit_api;

create or replace function app_private.require_registered_coaching_client(p_client_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.profiles where id=auth.uid() and account_role='trainer') then
    -- Serialize with the same client-row lock used by connection/disconnection.
    perform 1 from public.clients where id=p_client_id for update;
    if not public.can_create_client_workout(p_client_id) then
      raise exception 'athlete_connection_required' using errcode='PT409';
    end if;
  end if;
end $$;
revoke all on function app_private.require_registered_coaching_client(uuid) from public,fit_api;

create or replace function app_private.guard_registered_client_creation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.profiles where id=auth.uid() and account_role='trainer') then
    raise exception 'athlete_registration_required' using errcode='PT409';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_registered_client_creation() from public,fit_api;
create or replace trigger require_athlete_registration before insert on public.clients
  for each row execute function app_private.guard_registered_client_creation();

create or replace function app_private.guard_registered_coaching_workout()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform app_private.require_registered_coaching_client(new.client_id);
  elsif old.status='planned' and new.status in ('in_progress','done') then
    perform app_private.require_registered_coaching_client(new.client_id);
  end if;
  return new;
end $$;
revoke all on function app_private.guard_registered_coaching_workout() from public,fit_api;
create or replace trigger require_registered_coaching_workout before insert or update of status on public.workouts
  for each row execute function app_private.guard_registered_coaching_workout();

-- Preserve the original entry implementations and replay semantics behind
-- wrappers, so old clients cannot start/resume Live before the new precondition.
do $$ begin
  if to_regprocedure('app_private.quick_start_live_workout_before_registration(uuid,uuid)') is null then
    alter function public.quick_start_live_workout(uuid,uuid) rename to quick_start_live_workout_before_registration;
    alter function public.quick_start_live_workout_before_registration(uuid,uuid) set schema app_private;
  end if;
  if to_regprocedure('app_private.start_live_workout_before_registration(uuid,bigint,uuid)') is null then
    alter function public.start_live_workout(uuid,bigint,uuid) rename to start_live_workout_before_registration;
    alter function public.start_live_workout_before_registration(uuid,bigint,uuid) set schema app_private;
  end if;
  if to_regprocedure('app_private.finish_live_workout_before_registration(uuid,bigint,uuid,boolean,text,uuid)') is null then
    alter function public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) rename to finish_live_workout_before_registration;
    alter function public.finish_live_workout_before_registration(uuid,bigint,uuid,boolean,text,uuid) set schema app_private;
  end if;
end $$;
revoke all on function app_private.quick_start_live_workout_before_registration(uuid,uuid),
  app_private.start_live_workout_before_registration(uuid,bigint,uuid),
  app_private.finish_live_workout_before_registration(uuid,bigint,uuid,boolean,text,uuid) from public,fit_api;

create or replace function public.quick_start_live_workout(p_client_id uuid,p_operation_id uuid)
returns table(workout_id uuid,resumed boolean) language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_registered_coaching_client(p_client_id);
  return query select * from app_private.quick_start_live_workout_before_registration(p_client_id,p_operation_id);
end $$;
create or replace function public.start_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid)
returns table(version bigint,replayed boolean) language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_registered_coaching_client((select client_id from public.workouts where id=p_workout_id));
  return query select * from app_private.start_live_workout_before_registration(p_workout_id,p_expected_version,p_operation_id);
end $$;
create or replace function public.finish_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid,
  p_attendance boolean,p_disposition text,p_package_id uuid)
returns table(version bigint,replayed boolean) language plpgsql security definer set search_path='' as $$
begin
  -- Quick completion must take the client lock before the workout lock, just
  -- like start and legacy account merges. The row trigger remains a final guard.
  -- Finishing an existing live session retains its previous history semantics.
  if exists(select 1 from public.workouts where id=p_workout_id and status='planned' and trainer_id=auth.uid()) then
    perform app_private.require_registered_coaching_client((select client_id from public.workouts where id=p_workout_id));
  end if;
  return query select * from app_private.finish_live_workout_before_registration(
    p_workout_id,p_expected_version,p_operation_id,p_attendance,p_disposition,p_package_id);
end $$;
revoke all on function public.quick_start_live_workout(uuid,uuid),public.start_live_workout(uuid,bigint,uuid),
  public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) from public;
grant execute on function public.quick_start_live_workout(uuid,uuid),public.start_live_workout(uuid,bigint,uuid),
  public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) to fit_api;

-- Down Migration
-- The data-preserving registration requirement is retained on rollback.
