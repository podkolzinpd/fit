-- Up Migration

-- Only coaching authorization changes. Partition keys, snapshots, authorship,
-- version checks, rollout gates and transaction boundaries remain unchanged.
do $$
declare
  target regprocedure;
  definition text;
  matches integer;
  expected integer;
  legacy_pattern text := 'client[.]trainer_id = (actor_id_value|actor_id)\s+or exists \(\s+select 1\s+from public[.]client_trainers membership\s+where membership[.]client_id = client[.]id\s+and membership[.]trainer_id = \1\s+\)';
begin
  foreach target in array array[
    'app_private.save_planned_workout_without_title(jsonb,bigint)'::regprocedure,
    'app_private.save_planned_workout_without_cross_partition_snapshots(jsonb,bigint)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    expected := case when target = 'app_private.save_planned_workout_without_title(jsonb,bigint)'::regprocedure then 1 else 2 end;
    select count(*) into matches from regexp_matches(definition, legacy_pattern, 'g');
    if matches <> expected then
      raise exception 'planned_workout_access_definition_mismatch';
    end if;
    execute regexp_replace(definition, legacy_pattern,
      'public.is_active_client_trainer_connection(client.id, \1)', 'g');
  end loop;
end;
$$;

-- Down Migration

do $$
declare
  target regprocedure;
  definition text;
begin
  foreach target in array array[
    'app_private.save_planned_workout_without_title(jsonb,bigint)'::regprocedure,
    'app_private.save_planned_workout_without_cross_partition_snapshots(jsonb,bigint)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    execute regexp_replace(definition,
      'public[.]is_active_client_trainer_connection\(client[.]id, (actor_id_value|actor_id)\)',
      'client.trainer_id = \1 or exists ( select 1 from public.client_trainers membership where membership.client_id = client.id and membership.trainer_id = \1 )', 'g');
  end loop;
end;
$$;

