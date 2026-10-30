-- Up Migration

-- Metadata-only command: preserve every plan, fact and lifecycle field.
create function public.rename_workout(
  p_workout_id uuid, p_title text, p_expected_version bigint
)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  workout_row public.workouts%rowtype;
  clean_title text := btrim(p_title);
  next_version bigint;
begin
  select * into workout_row from public.workouts
  where id = p_workout_id and deleted_at is null for update;
  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  perform 1 from app_private.authorize_workout_lifecycle(p_workout_id, false);
  if clean_title is null or char_length(clean_title) not between 1 and 120
    or p_expected_version is null or p_expected_version < 1 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  -- Lost-response retry is safe; it cannot modify an unseen different title.
  if workout_row.title is not distinct from clean_title then return workout_row.version; end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  update public.workouts set title = clean_title, updated_by = auth.uid(),
    version = version + 1 where id = p_workout_id returning version into next_version;
  return next_version;
end;
$$;
revoke all on function public.rename_workout(uuid, text, bigint) from public;
grant execute on function public.rename_workout(uuid, text, bigint) to fit_api;

-- Down Migration
drop function public.rename_workout(uuid, text, bigint);
