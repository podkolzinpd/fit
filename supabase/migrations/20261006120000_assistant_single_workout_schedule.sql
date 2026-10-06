-- A generated program-v1 payload can represent either one future workout or
-- a 1-4 week program. Keep the canonical-payload validation, but accept the
-- single-workout shape that the generator and UI already support.
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

