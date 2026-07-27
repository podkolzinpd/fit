do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'workouts',
    'workout_exercises',
    'workout_sets',
    'client_progress',
    'client_progress_custom',
    'client_custom_metrics'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
