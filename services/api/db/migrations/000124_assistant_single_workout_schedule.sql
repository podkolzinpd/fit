-- Up Migration

-- Mirrors supabase/migrations/20261006120000_assistant_single_workout_schedule.sql.
-- Generated recommendations may contain one future workout as well as a
-- 1-4 week program. Preserve canonical validation while accepting one item.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.apply_assistant_action(uuid,jsonb,bigint)'::regprocedure)
  into function_definition;

  if position('not in (4, 8, 12)' in function_definition) = 0 then
    raise exception 'assistant_single_workout_schedule_invariant';
  end if;

  execute replace(
    function_definition,
    'not in (4, 8, 12)',
    'not in (1, 4, 8, 12)'
  );
end;
$$;

-- Down Migration

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.apply_assistant_action(uuid,jsonb,bigint)'::regprocedure)
  into function_definition;

  if position('not in (1, 4, 8, 12)' in function_definition) = 0 then
    raise exception 'assistant_single_workout_schedule_down_invariant';
  end if;

  execute replace(
    function_definition,
    'not in (1, 4, 8, 12)',
    'not in (4, 8, 12)'
  );
end;
$$;

