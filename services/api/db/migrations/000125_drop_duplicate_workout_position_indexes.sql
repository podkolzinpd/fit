-- Up Migration

-- DROP INDEX takes a table lock. Fail and roll back instead of waiting behind
-- an active workout transaction for an unbounded period.
set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- Keep catalog verification and removal in the same protected snapshot of
-- these tables; concurrent DDL must not remove the retained constraint.
lock table public.workout_exercises, public.workout_sets in access exclusive mode;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('workout_exercises', 'workout_exercises_workout_position_idx', 'workout_exercises_position_unique'),
      ('workout_sets', 'workout_sets_exercise_position_idx', 'workout_sets_position_unique')
    ) as targets(table_name, redundant_index, position_constraint)
  loop
    -- Check the live catalog, not only the original migration. Preserve the
    -- deferrable UNIQUE constraint used by workout reordering, and fail closed
    -- if either index has drifted, is invalid, or owns a constraint.
    if not exists (
      select 1
      from pg_catalog.pg_index redundant
      join pg_catalog.pg_class redundant_class on redundant_class.oid = redundant.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid = redundant_class.relam
      join pg_catalog.pg_constraint position_constraint
        on position_constraint.conrelid = redundant.indrelid
        and position_constraint.conname = target.position_constraint
        and position_constraint.contype = 'u'
      join pg_catalog.pg_index retained on retained.indexrelid = position_constraint.conindid
      join pg_catalog.pg_class retained_class on retained_class.oid = retained.indexrelid
      where redundant.indexrelid = pg_catalog.to_regclass(format('public.%I', target.redundant_index))
        and redundant.indrelid = pg_catalog.to_regclass(format('public.%I', target.table_name))
        and access_method.amname = 'btree'
        and redundant_class.relam = retained_class.relam
        and not redundant.indisunique
        and not redundant.indisprimary
        and not redundant.indisreplident
        and redundant.indisvalid and redundant.indisready
        and retained.indisunique and retained.indisvalid and retained.indisready
        and position_constraint.convalidated
        and position_constraint.condeferrable and not position_constraint.condeferred
        and redundant.indnkeyatts = 2 and redundant.indnatts = 2
        and redundant.indnkeyatts = retained.indnkeyatts
        and redundant.indnatts = retained.indnatts
        and redundant.indkey = retained.indkey
        and redundant.indclass = retained.indclass
        and redundant.indcollation = retained.indcollation
        and redundant.indoption = retained.indoption
        and redundant.indexprs is null and retained.indexprs is null
        and redundant.indpred is null and retained.indpred is null
        and not exists (
          select 1 from pg_catalog.pg_constraint dependency
          where dependency.conindid = redundant.indexrelid
        )
    ) then
      raise exception 'workout_position_index_catalog_mismatch: %', target.redundant_index;
    end if;
  end loop;
end;
$$;

-- No CASCADE: dependent objects must never be removed with these indexes.
drop index public.workout_exercises_workout_position_idx;
drop index public.workout_sets_exercise_position_idx;

-- Down Migration

set local lock_timeout = '3s';
set local statement_timeout = '15s';

create index workout_exercises_workout_position_idx
  on public.workout_exercises (workout_id, position);
create index workout_sets_exercise_position_idx
  on public.workout_sets (workout_exercise_id, position);
