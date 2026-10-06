-- Up Migration

-- Program generation supports one to four weeks with one to three sessions
-- per week. The canonical payload, client and source snapshot are validated
-- independently below, so every resulting size from 1 through 12 is valid.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.apply_assistant_action(uuid,jsonb,bigint)'::regprocedure)
  into function_definition;

  if position('not in (1, 4, 8, 12)' in function_definition) = 0 then
    raise exception 'assistant_flexible_program_schedule_invariant';
  end if;

  execute replace(
    function_definition,
    'not in (1, 4, 8, 12)',
    'not between 1 and 12'
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

  if position('not between 1 and 12' in function_definition) = 0 then
    raise exception 'assistant_flexible_program_schedule_down_invariant';
  end if;

  execute replace(
    function_definition,
    'not between 1 and 12',
    'not in (1, 4, 8, 12)'
  );
end;
$$;
