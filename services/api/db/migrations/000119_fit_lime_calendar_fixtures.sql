-- Up Migration

-- Private provenance only: no demo label or new public profile/flag. Creating
-- this schema does NOT seed data; the bounded IAM-only operation is separate.
create table app_private.fit_lime_calendar_batches (
  batch_id text not null,
  trainer_id uuid not null references public.trainers(profile_id) on delete restrict,
  anchor_date date not null,
  created_at timestamptz not null default now(),
  cleaned_at timestamptz,
  primary key (batch_id, trainer_id),
  check (batch_id = 'fit-lime-calendar-20261003')
);
create table app_private.fit_lime_calendar_clients (
  client_id uuid primary key references public.clients(id) on delete restrict deferrable initially deferred,
  batch_id text not null,
  trainer_id uuid not null,
  foreign key (batch_id, trainer_id) references app_private.fit_lime_calendar_batches(batch_id, trainer_id) on delete restrict
);
create table app_private.fit_lime_calendar_workouts (
  workout_id uuid primary key references public.workouts(id) on delete restrict deferrable initially deferred,
  client_id uuid not null references app_private.fit_lime_calendar_clients(client_id) on delete restrict
);
revoke all on app_private.fit_lime_calendar_batches, app_private.fit_lime_calendar_clients,
  app_private.fit_lime_calendar_workouts from public, fit_api;

-- Synthetic cards must never become somebody's real athlete account, move
-- into another client partition, or acquire another trainer through a merge.
create function app_private.guard_fit_lime_fixture_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'clients' then
    if exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = new.id)
      and (new.auth_user_id is not null or new.merged_into_client_id is not null
        or exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = new.id and f.trainer_id <> new.trainer_id)) then
      raise exception 'synthetic_client_identity_is_fixed' using errcode = '23514';
    end if;
  elsif tg_table_name = 'workouts' then
    if tg_op = 'UPDATE' and (new.client_id <> old.client_id or new.trainer_id <> old.trainer_id)
      and (exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id in (old.client_id, new.client_id))) then
      raise exception 'synthetic_workout_partition_is_fixed' using errcode = '23514';
    end if;
  else
    if exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = new.client_id and f.trainer_id <> new.trainer_id) then
      raise exception 'synthetic_client_trainer_is_fixed' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_fit_lime_fixture_identity() from public;
create trigger guard_fit_lime_fixture_identity before insert or update on public.clients
for each row execute function app_private.guard_fit_lime_fixture_identity();
create trigger guard_fit_lime_fixture_identity before update on public.workouts
for each row execute function app_private.guard_fit_lime_fixture_identity();
create trigger guard_fit_lime_fixture_identity before insert or update on public.client_trainers
for each row execute function app_private.guard_fit_lime_fixture_identity();
create trigger guard_fit_lime_fixture_identity before insert or update on public.client_trainer_relationships
for each row execute function app_private.guard_fit_lime_fixture_identity();

-- The existing finance trigger has no package for these new cards. Guard its
-- trigger predicate as well, so later edits/completion cannot create charges.
create function app_private.is_fit_lime_fixture_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = p_client_id)
$$;
revoke all on function app_private.is_fit_lime_fixture_client(uuid) from public;
grant execute on function app_private.is_fit_lime_fixture_client(uuid) to fit_api;
drop trigger sync_trainer_finance_workout on public.workouts;
create trigger sync_trainer_finance_workout
after insert or update of status, deleted_at, training_format on public.workouts
for each row when (not app_private.is_fit_lime_fixture_client(new.client_id))
execute function app_private.sync_trainer_finance_workout();

-- Analytics keep their exact column contract, security options and grants.
-- Substitute only three fixed sources in the two existing view definitions;
-- do not fork hundreds of lines of product metric calculations.
create view app_private.fit_lime_real_clients as
select c.* from public.clients c where not exists
  (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = c.id);
create view app_private.fit_lime_real_workouts as
select w.* from public.workouts w where not exists
  (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = w.client_id);
create view app_private.fit_lime_real_memberships as
select m.* from public.client_trainers m where not exists
  (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = m.client_id);
revoke all on app_private.fit_lime_real_clients, app_private.fit_lime_real_workouts,
  app_private.fit_lime_real_memberships from public, fit_api;
do $$
declare v_name text; v_definition text; v_path text := current_setting('search_path');
begin
  perform pg_catalog.set_config('search_path', '', true);
  foreach v_name in array array['analytics.trainer_overview', 'analytics.client_overview'] loop
    v_definition := pg_catalog.pg_get_viewdef(v_name::regclass, true);
    if position('public.clients' in v_definition) = 0 or position('public.workouts' in v_definition) = 0 then
      raise exception 'analytics_fixture_filter_source_changed';
    end if;
    v_definition := replace(v_definition, 'public.clients', 'app_private.fit_lime_real_clients');
    v_definition := replace(v_definition, 'public.workouts', 'app_private.fit_lime_real_workouts');
    v_definition := replace(v_definition, 'public.client_trainers', 'app_private.fit_lime_real_memberships');
    execute 'create or replace view ' || v_name || ' with (security_barrier = true, security_invoker = false) as ' || v_definition;
  end loop;
  perform pg_catalog.set_config('search_path', v_path, true);
end;
$$;

-- Down Migration

-- Never erase seeded data implicitly during schema rollback.
do $$ begin
  if exists (select 1 from app_private.fit_lime_calendar_batches) then
    raise exception 'fixture_provenance_requires_forward_rollback';
  end if;
end $$;
do $$
declare v_name text; v_definition text; v_path text := current_setting('search_path');
begin
  perform pg_catalog.set_config('search_path', '', true);
  foreach v_name in array array['analytics.trainer_overview', 'analytics.client_overview'] loop
    v_definition := pg_catalog.pg_get_viewdef(v_name::regclass, true);
    v_definition := replace(v_definition, 'app_private.fit_lime_real_clients', 'public.clients');
    v_definition := replace(v_definition, 'app_private.fit_lime_real_workouts', 'public.workouts');
    v_definition := replace(v_definition, 'app_private.fit_lime_real_memberships', 'public.client_trainers');
    execute 'create or replace view ' || v_name || ' with (security_barrier = true, security_invoker = false) as ' || v_definition;
  end loop;
  perform pg_catalog.set_config('search_path', v_path, true);
end;
$$;
drop view app_private.fit_lime_real_clients, app_private.fit_lime_real_workouts, app_private.fit_lime_real_memberships;
drop trigger sync_trainer_finance_workout on public.workouts;
create trigger sync_trainer_finance_workout after insert or update of status, deleted_at, training_format on public.workouts
for each row execute function app_private.sync_trainer_finance_workout();
drop function app_private.is_fit_lime_fixture_client(uuid);
drop trigger guard_fit_lime_fixture_identity on public.clients;
drop trigger guard_fit_lime_fixture_identity on public.workouts;
drop trigger guard_fit_lime_fixture_identity on public.client_trainers;
drop trigger guard_fit_lime_fixture_identity on public.client_trainer_relationships;
drop function app_private.guard_fit_lime_fixture_identity();
drop table app_private.fit_lime_calendar_workouts, app_private.fit_lime_calendar_clients, app_private.fit_lime_calendar_batches;
