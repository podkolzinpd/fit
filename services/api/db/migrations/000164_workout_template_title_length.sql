-- Up Migration

-- A workout title must survive saving as a template without truncation.
alter table public.workout_templates drop constraint workout_templates_name_length;
alter table public.workout_templates add constraint workout_templates_name_length check (char_length(name) <= 120);
do $$
declare definition text := pg_get_functiondef('public.save_workout_template_once(jsonb,bigint)'::regprocedure);
begin
  if strpos(definition, 'char_length(template_name)>80') = 0 then
    raise exception 'workout_template_title_validation_changed';
  end if;
  execute replace(definition, 'char_length(template_name)>80', 'char_length(template_name)>120');
end;
$$;

-- Down Migration

-- A rollback refuses to truncate any longer title already stored.
alter table public.workout_templates drop constraint workout_templates_name_length;
alter table public.workout_templates add constraint workout_templates_name_length check (char_length(name) <= 80);
do $$
declare definition text := pg_get_functiondef('public.save_workout_template_once(jsonb,bigint)'::regprocedure);
begin
  if strpos(definition, 'char_length(template_name)>120') = 0 then
    raise exception 'workout_template_title_validation_changed';
  end if;
  execute replace(definition, 'char_length(template_name)>120', 'char_length(template_name)>80');
end;
$$;
