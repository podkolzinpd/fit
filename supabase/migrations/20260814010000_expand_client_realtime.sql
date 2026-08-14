-- Keep the shared Trainer <-> Client space current without requiring a full
-- page reload. These tables already carry client_id and keep their existing
-- RLS policies; publication only makes permitted row changes observable.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'client_goals',
    'goal_stages',
    'client_trainers',
    'client_invitations',
    'client_training_summaries',
    'client_published_training_summaries'
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
