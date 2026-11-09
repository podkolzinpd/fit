-- Up Migration
-- Incident rollback of PR2039. Keep applied migrations and all records.
drop trigger if exists require_athlete_registration on public.clients;
drop trigger if exists require_registered_coaching_workout on public.workouts;

create or replace function public.can_create_client_workout(p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.clients c where c.id=p_client_id
    and c.archived_at is null and c.merged_into_client_id is null
    and public.is_active_client_trainer_connection(c.id,auth.uid()));
$$;
revoke all on function public.can_create_client_workout(uuid) from public;
grant execute on function public.can_create_client_workout(uuid) to fit_api;

-- The preserved pre-registration commands retain their original authorization,
-- locks, financial semantics and operation receipts.
create or replace function app_private.require_registered_coaching_client(p_client_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin return; end $$;
revoke all on function app_private.require_registered_coaching_client(uuid) from public,fit_api;

create or replace function public.quick_start_live_workout(p_client_id uuid,p_operation_id uuid)
returns table(workout_id uuid,resumed boolean) language sql security definer set search_path='' as $$
  select * from app_private.quick_start_live_workout_before_registration(p_client_id,p_operation_id);
$$;
create or replace function public.start_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid)
returns table(version bigint,replayed boolean) language sql security definer set search_path='' as $$
  select * from app_private.start_live_workout_before_registration(p_workout_id,p_expected_version,p_operation_id);
$$;
create or replace function public.finish_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid,
  p_attendance boolean,p_disposition text,p_package_id uuid)
returns table(version bigint,replayed boolean) language sql security definer set search_path='' as $$
  select * from app_private.finish_live_workout_before_registration(p_workout_id,p_expected_version,p_operation_id,p_attendance,p_disposition,p_package_id);
$$;
revoke all on function public.quick_start_live_workout(uuid,uuid),public.start_live_workout(uuid,bigint,uuid),
  public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) from public;
grant execute on function public.quick_start_live_workout(uuid,uuid),public.start_live_workout(uuid,bigint,uuid),
  public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) to fit_api;

-- Down Migration
-- Forward-only incident rollback. Do not reinstate the rejected restriction.
