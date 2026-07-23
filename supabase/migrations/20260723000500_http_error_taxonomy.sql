do $$
declare
  rpc regprocedure;
  definition text;
begin
  for rpc in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0001%'
        or case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0002%'
      )
  loop
    definition := pg_get_functiondef(rpc);
    definition := replace(definition, 'P0001', 'PT422');
    definition := replace(definition, 'P0002', 'PT404');
    execute definition;
  end loop;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0001%'
        or case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0002%'
      )
  ) then
    raise exception 'legacy business SQLSTATE remains';
  end if;
end;
$$;
