-- Up Migration

-- Widen plan and fact RPE without updating any recorded workout or set.
alter table public.workout_sets
  drop constraint workout_sets_rpe_valid,
  add constraint workout_sets_rpe_valid check (
    (plan_rpe is null or (plan_rpe between 5 and 10 and mod(plan_rpe * 10, 5) = 0))
    and (fact_rpe is null or (fact_rpe between 5 and 10 and mod(fact_rpe * 10, 5) = 0))
  );

-- Down Migration

-- Never clamp, clear or remove recorded values to satisfy the old range.
do $$ begin
  if exists(select 1 from public.workout_sets where plan_rpe < 6 or fact_rpe < 6) then
    raise exception 'workout_set_rpe_five_in_use';
  end if;
end $$;
alter table public.workout_sets
  drop constraint workout_sets_rpe_valid,
  add constraint workout_sets_rpe_valid check (
    (plan_rpe is null or (plan_rpe between 6 and 10 and mod(plan_rpe * 10, 5) = 0))
    and (fact_rpe is null or (fact_rpe between 6 and 10 and mod(fact_rpe * 10, 5) = 0))
  );
