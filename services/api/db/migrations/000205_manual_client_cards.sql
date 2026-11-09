-- Up Migration

-- Restore trainer-owned cards without weakening consent for registered clients.
drop trigger if exists require_athlete_registration on public.clients;
drop function if exists app_private.guard_registered_client_creation();
create or replace function public.can_create_client_workout(p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.clients c join public.profiles actor on actor.id=auth.uid()
    where c.id=p_client_id and c.archived_at is null and c.merged_into_client_id is null
      and (actor.account_role='client' and c.auth_user_id=actor.id
        or actor.account_role='trainer' and public.is_active_client_trainer_connection(c.id,actor.id)));
$$;
revoke all on function public.can_create_client_workout(uuid) from public;
grant execute on function public.can_create_client_workout(uuid) to fit_api;

-- Down Migration
-- Forward-only: retain cards and all existing history.
