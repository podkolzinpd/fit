-- Up Migration

-- Title availability is independent of the presentation pilot. Keep all
-- aggregate author, connection, locking, version and replay checks intact.
do $migration$
declare
  planned text := pg_get_functiondef('public.save_planned_workout(jsonb,bigint)'::regprocedure);
  completed text := pg_get_functiondef('public.save_completed_workout(jsonb,bigint)'::regprocedure);
  old_guard text := $guard$    if not app_private.fit_lime_enabled() then
      raise exception 'workout_forbidden' using errcode = 'PT403';
    end if;
$guard$;
  title_edit text := $edit$  -- Public title metadata follows the already-authorized aggregate edit.
  -- New completed creates get their title from save_planned_workout; retries
  -- must not overwrite a title renamed after the original create.
  if p_expected_version is not null and p_workout ? 'title' then
    if jsonb_typeof(p_workout->'title') not in ('string', 'null')
      or length(btrim(p_workout->>'title')) > 120 then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    update public.workouts set title = nullif(btrim(p_workout->>'title'), '')
    where id = saved_workout_id;
  end if;

$edit$;
begin
  if strpos(planned, old_guard) = 0 or strpos(completed, 'public title metadata') > 0
    or strpos(completed, 'saved_workout_id') = 0
    or strpos(completed, '  -- Authorized and version-checked by the lifecycle command above.') = 0 then
    raise exception 'public_workout_title_definition_mismatch';
  end if;
  execute replace(planned, old_guard, '');
  execute replace(completed, '  -- Authorized and version-checked by the lifecycle command above.', title_edit || '  -- Authorized and version-checked by the lifecycle command above.');
end;
$migration$;

-- Down Migration

do $migration$
declare
  planned text := pg_get_functiondef('public.save_planned_workout(jsonb,bigint)'::regprocedure);
  completed text := pg_get_functiondef('public.save_completed_workout(jsonb,bigint)'::regprocedure);
  old_guard text := $guard$    if not app_private.fit_lime_enabled() then
      raise exception 'workout_forbidden' using errcode = 'PT403';
    end if;
$guard$;
  title_edit text := $edit$  -- Public title metadata follows the already-authorized aggregate edit.
  -- New completed creates get their title from save_planned_workout; retries
  -- must not overwrite a title renamed after the original create.
  if p_expected_version is not null and p_workout ? 'title' then
    if jsonb_typeof(p_workout->'title') not in ('string', 'null')
      or length(btrim(p_workout->>'title')) > 120 then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    update public.workouts set title = nullif(btrim(p_workout->>'title'), '')
    where id = saved_workout_id;
  end if;

$edit$;
  anchor text := $anchor$    if jsonb_typeof(p_workout->'title') not in ('string', 'null') then$anchor$;
begin
  if strpos(planned, anchor) = 0 or strpos(completed, title_edit) = 0 then
    raise exception 'public_workout_title_definition_mismatch';
  end if;
  execute replace(planned, anchor, old_guard || anchor);
  execute replace(completed, title_edit, '');
end;
$migration$;
