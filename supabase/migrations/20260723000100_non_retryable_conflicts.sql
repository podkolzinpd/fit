do $$
declare
  rpc regprocedure;
  definition text;
  conflict_rpcs constant regprocedure[] := array[
    'public.update_client(jsonb,bigint)'::regprocedure,
    'public.save_workout(jsonb,bigint)'::regprocedure,
    'public.start_workout(uuid,bigint)'::regprocedure,
    'public.save_live_set_draft(uuid,jsonb,bigint)'::regprocedure,
    'public.confirm_live_set(uuid,bigint)'::regprocedure,
    'public.finish_workout(uuid,bigint)'::regprocedure,
    'public.save_progress(jsonb,bigint)'::regprocedure,
    'public.soft_delete_workout(uuid,bigint)'::regprocedure,
    'public.soft_delete_progress(uuid,bigint)'::regprocedure,
    'public.append_live_exercise(uuid,jsonb,bigint)'::regprocedure,
    'public.append_live_set(uuid,bigint)'::regprocedure
  ];
begin
  foreach rpc in array conflict_rpcs
  loop
    definition := pg_get_functiondef(rpc);
    if definition not like '%40001%' then
      raise exception 'expected retryable conflict code in %', rpc;
    end if;

    execute replace(definition, '40001', 'PT409');
  end loop;
end;
$$;

