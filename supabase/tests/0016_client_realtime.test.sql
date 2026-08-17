begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = any (array[
        'clients',
        'workouts',
        'workout_exercises',
        'workout_sets',
        'client_progress',
        'client_progress_custom',
        'client_custom_metrics',
        'client_goals',
        'goal_stages',
        'client_trainers',
        'client_invitations',
        'client_training_summaries',
        'client_published_training_summaries'
      ])
  ),
  13,
  'all client portal tables are published for realtime'
);

select * from finish();
rollback;
