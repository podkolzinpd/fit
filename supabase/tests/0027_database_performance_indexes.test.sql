begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_index(
  'public',
  'workouts',
  'workouts_active_client_date_idx',
  'active workout pages have a client-first date index'
);
select is(
  (
    select string_agg(attribute.attname, ',' order by key_column.ordinality)
    from pg_index index_row
    cross join lateral unnest(index_row.indkey)
      with ordinality key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = index_row.indrelid
     and attribute.attnum = key_column.attnum
    where index_row.indexrelid =
      'public.workouts_active_client_date_idx'::regclass
  ),
  'client_id,workout_date,start_time,created_at,id',
  'client workout index preserves stable page ordering'
);
select has_index(
  'public',
  'workouts',
  'workouts_active_author_client_date_idx',
  'trainer workout pages have an author-first index'
);
select is(
  (
    select string_agg(attribute.attname, ',' order by key_column.ordinality)
    from pg_index index_row
    cross join lateral unnest(index_row.indkey)
      with ordinality key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = index_row.indrelid
     and attribute.attnum = key_column.attnum
    where index_row.indexrelid =
      'public.workouts_active_author_client_date_idx'::regclass
  ),
  'created_by,client_id,workout_date,start_time,created_at,id',
  'trainer workout index covers author-scoped stable ordering'
);
select has_index(
  'public',
  'client_progress',
  'client_progress_created_by_client_idx',
  'progress ownership checks have an author index'
);
select has_index(
  'public',
  'client_invitations',
  'client_invitations_active_client_created_idx',
  'active invitation listing has a partial index'
);

select hasnt_index(
  'public',
  'workout_exercises',
  'workout_exercises_workout_position_idx',
  'exercise position unique index has no non-unique duplicate'
);
select hasnt_index(
  'public',
  'workout_sets',
  'workout_sets_exercise_position_idx',
  'set position unique index has no non-unique duplicate'
);
select hasnt_index(
  'public',
  'clients',
  'clients_auth_user_idx',
  'client auth lookup has no duplicate of the unique index'
);

select * from finish();
rollback;
