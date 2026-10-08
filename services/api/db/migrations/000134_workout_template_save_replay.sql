-- Up Migration

-- Preserve the existing validator and optimistic write; only the public entry
-- point accepts a byte-equivalent logical retry of the last successful command.
alter function public.save_workout_template(jsonb,bigint) rename to save_workout_template_once;
revoke all on function public.save_workout_template_once(jsonb,bigint) from public, fit_api;

create function public.save_workout_template(p_template jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  template_id uuid := nullif(p_template->>'id','')::uuid;
  current_template public.workout_templates%rowtype;
begin
  if template_id is not null then
    -- Lock even when there is no row yet: concurrent creates must compare the
    -- committed payload, never silently accept a different insert conflict.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(template_id::text, 0));
    select * into current_template from public.workout_templates
      where id=template_id and trainer_id=auth.uid() and archived_at is null for update;
    if found
      and ((p_expected_version is null and current_template.version=1)
        or (p_expected_version is not null and current_template.version=p_expected_version+1))
      and current_template.name=btrim(coalesce(p_template->>'name',''))
      and current_template.notes is not distinct from nullif(btrim(coalesce(p_template->>'notes','')),'')
      and current_template.exercises=coalesce(p_template->'exercises','[]'::jsonb)
    then
      return template_id;
    end if;
  end if;
  return public.save_workout_template_once(p_template, p_expected_version);
end; $$;
revoke all on function public.save_workout_template(jsonb,bigint) from public;
grant execute on function public.save_workout_template(jsonb,bigint) to fit_api;

-- Down Migration

drop function public.save_workout_template(jsonb,bigint);
alter function public.save_workout_template_once(jsonb,bigint) rename to save_workout_template;
grant execute on function public.save_workout_template(jsonb,bigint) to fit_api;
