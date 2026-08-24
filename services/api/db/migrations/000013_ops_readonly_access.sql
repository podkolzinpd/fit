-- Up Migration

create schema ops_readonly;

revoke all on schema ops_readonly from public;

comment on schema ops_readonly is
  'Curated operational read-only views. Direct public and app_private access stays revoked.';

create view ops_readonly.profiles
with (security_barrier = true, security_invoker = false)
as
select
  profile.id,
  profile.timezone,
  profile.account_role,
  profile.created_at,
  profile.updated_at
from public.profiles profile;

create view ops_readonly.trainers
with (security_barrier = true, security_invoker = false)
as
select
  trainer.profile_id,
  trainer.created_at,
  trainer.updated_at
from public.trainers trainer;

create view ops_readonly.clients
with (security_barrier = true, security_invoker = false)
as
select
  client.id,
  client.trainer_id,
  client.auth_user_id,
  client.archived_at,
  client.version,
  client.created_at,
  client.updated_at
from public.clients client;

create view ops_readonly.client_trainers
with (security_barrier = true, security_invoker = false)
as
select
  membership.client_id,
  membership.trainer_id,
  membership.version,
  membership.joined_at
from public.client_trainers membership;

create view ops_readonly.client_invitations
with (security_barrier = true, security_invoker = false)
as
select
  invitation.id,
  invitation.client_id,
  invitation.created_by,
  invitation.target_role,
  invitation.expires_at,
  invitation.claimed_by,
  invitation.claimed_at,
  invitation.revoked_at,
  invitation.created_at
from public.client_invitations invitation;

create view ops_readonly.custom_exercises
with (security_barrier = true, security_invoker = false)
as
select
  exercise.id,
  exercise.trainer_id,
  exercise.name,
  exercise.muscle_group,
  exercise.input_kind,
  exercise.archived_at,
  exercise.version,
  exercise.created_at,
  exercise.updated_at
from public.custom_exercises exercise;

create view ops_readonly.workouts
with (security_barrier = true, security_invoker = false)
as
select
  workout.id,
  workout.trainer_id,
  workout.client_id,
  workout.created_by,
  workout.workout_date,
  workout.start_time,
  workout.end_time,
  workout.status,
  workout.started_at,
  workout.completed_at,
  workout.deleted_at,
  workout.version,
  workout.created_at,
  workout.updated_at
from public.workouts workout;

create view ops_readonly.workout_exercises
with (security_barrier = true, security_invoker = false)
as
select
  exercise.id,
  exercise.workout_id,
  exercise.trainer_id,
  exercise.client_id,
  exercise.position,
  exercise.exercise_source,
  exercise.exercise_ref,
  exercise.custom_exercise_id,
  exercise.exercise_name,
  exercise.muscle_group,
  exercise.input_kind,
  exercise.block_id,
  exercise.block_type,
  exercise.block_preset,
  exercise.block_rounds,
  exercise.rest_between_exercises_sec,
  exercise.rest_between_rounds_sec,
  exercise.rest_between_sets_sec,
  exercise.created_at,
  exercise.updated_at
from public.workout_exercises exercise;

create view ops_readonly.workout_sets
with (security_barrier = true, security_invoker = false)
as
select
  workout_set.id,
  workout_set.workout_exercise_id,
  workout_set.trainer_id,
  workout_set.client_id,
  workout_set.position,
  workout_set.plan_weight_kg,
  workout_set.plan_reps,
  workout_set.plan_duration_min,
  workout_set.plan_duration_sec,
  workout_set.plan_distance_km,
  workout_set.plan_rpe,
  workout_set.fact_weight_kg,
  workout_set.fact_reps,
  workout_set.fact_duration_min,
  workout_set.fact_duration_sec,
  workout_set.fact_distance_km,
  workout_set.fact_rpe,
  workout_set.confirmed_at,
  workout_set.version,
  workout_set.created_at,
  workout_set.updated_at
from public.workout_sets workout_set;

revoke all on all tables in schema ops_readonly from public;

alter default privileges in schema ops_readonly
revoke all on tables from public;

create or replace function app_private.set_ops_readonly_access(
  p_role_name text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role pg_catalog.pg_roles%rowtype;
begin
  if p_role_name is null or p_role_name = '' or char_length(p_role_name) > 63 then
    raise exception 'invalid_database_role' using errcode = '22023';
  end if;

  select role.*
  into target_role
  from pg_catalog.pg_roles role
  where role.rolname = p_role_name;

  if not found then
    raise exception 'database_role_not_found' using errcode = '42704';
  end if;

  if not target_role.rolcanlogin
    or target_role.rolsuper
    or target_role.rolcreaterole
    or target_role.rolcreatedb
    or target_role.rolreplication
    or target_role.rolbypassrls
    or target_role.rolname in ('fit_api', 'fit_owner')
    or target_role.rolname like 'pg\_%' escape '\'
    or target_role.rolname like 'mdb\_%' escape '\'
    or exists (
      select 1
      from pg_catalog.pg_roles privileged_role
      where privileged_role.rolname in (
        'mdb_admin',
        'mdb_monitor',
        'mdb_read_all_data',
        'mdb_superuser',
        'mdb_write_all_data'
      )
        and pg_catalog.pg_has_role(
          target_role.rolname,
          privileged_role.oid,
          'member'
        )
    )
  then
    raise exception 'database_role_is_not_a_safe_reader' using errcode = '42501';
  end if;

  -- Remove grants from earlier manual experiments before applying the curated
  -- profile. Object ownership and inherited administrative memberships are not
  -- silently accepted as read-only access.
  execute format(
    'revoke all privileges on all tables in schema public from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on all sequences in schema public from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on all functions in schema public from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on schema public from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on all tables in schema app_private from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on all sequences in schema app_private from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on all functions in schema app_private from %I',
    target_role.rolname
  );
  execute format(
    'revoke all privileges on schema app_private from %I',
    target_role.rolname
  );

  if p_enabled then
    execute format(
      'grant usage on schema ops_readonly to %I',
      target_role.rolname
    );
    execute format(
      'grant select on all tables in schema ops_readonly to %I',
      target_role.rolname
    );
    execute format(
      'alter default privileges for role %I in schema ops_readonly grant select on tables to %I',
      current_user,
      target_role.rolname
    );
  else
    execute format(
      'alter default privileges for role %I in schema ops_readonly revoke select on tables from %I',
      current_user,
      target_role.rolname
    );
    execute format(
      'revoke all privileges on all tables in schema ops_readonly from %I',
      target_role.rolname
    );
    execute format(
      'revoke all privileges on schema ops_readonly from %I',
      target_role.rolname
    );
  end if;

  return true;
end;
$$;

revoke all on function app_private.set_ops_readonly_access(text, boolean)
from public;

-- Down Migration

drop function app_private.set_ops_readonly_access(text, boolean);
drop schema ops_readonly cascade;
