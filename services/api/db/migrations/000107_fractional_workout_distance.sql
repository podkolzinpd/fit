-- Up Migration

-- Keep two decimal places in metres (0.01 m = 0.00001 km) for planned and
-- actual distances, without reducing the existing six-digit kilometre range.
-- The curated ops view depends on both columns. Rebuild it within the same
-- transaction and restore every existing SELECT grant before committing.
create temporary table workout_distance_ops_grants on commit drop as
select grant_item.grantee, grant_item.is_grantable
from pg_class view_class,
  lateral aclexplode(coalesce(view_class.relacl, acldefault('r', view_class.relowner))) grant_item
where view_class.oid = 'ops_readonly.workout_sets'::regclass
  and grant_item.privilege_type = 'SELECT';

drop view ops_readonly.workout_sets;
drop trigger refresh_workout_calories_on_set on public.workout_sets;

alter table public.workout_sets
  alter column plan_distance_km type numeric(11, 5),
  alter column fact_distance_km type numeric(11, 5);

create trigger refresh_workout_calories_on_set
after insert or update of fact_weight_kg, fact_reps, fact_duration_min,
  fact_duration_sec, fact_distance_km, fact_rpe, confirmed_at or delete
on public.workout_sets
for each row execute function app_private.refresh_workout_calories_from_set();

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

revoke all on ops_readonly.workout_sets from public;

do $$
declare
  grant_item record;
begin
  for grant_item in select grantee, is_grantable from workout_distance_ops_grants loop
    execute format(
      'grant select on ops_readonly.workout_sets to %s%s',
      case when grant_item.grantee = 0 then 'public'
        else format('%I', pg_get_userbyid(grant_item.grantee)) end,
      case when grant_item.is_grantable then ' with grant option' else '' end
    );
  end loop;
end;
$$;

-- Down Migration

-- The previous API works with the expanded type. Narrowing it would round
-- newly saved distances, so an automatic rollback intentionally leaves it.
select 1;
