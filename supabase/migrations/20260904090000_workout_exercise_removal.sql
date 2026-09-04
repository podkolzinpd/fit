-- Reserve final positions for the entire aggregate, including omitted plan
-- rows. Moving only submitted rows left omitted rows in the way of edits.
create or replace function private.park_completed_workout_positions(p_workout_id uuid, p_workout jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  exercise_row record;
  set_row record;
  requested jsonb;
  requested_sets jsonb;
  temporary_base integer;
  final_tail integer;
  exercise_tail integer;
begin
  -- Serialize the preparatory writes with the optimistic root mutation.
  perform 1 from public.workouts where id = p_workout_id for update;
  requested := coalesce(p_workout->'exercises', '[]'::jsonb);
  select coalesce(max((value->>'position')::integer), -1) + 1
    into exercise_tail from jsonb_array_elements(requested);
  select greatest(coalesce(max(position), 0), exercise_tail + count(*)::integer) + 1
    into temporary_base from public.workout_exercises where workout_id = p_workout_id;
  -- Every destination is above every old position; no transient duplicates.
  for exercise_row in select id from public.workout_exercises
    where workout_id = p_workout_id order by position, id loop
    update public.workout_exercises set position = temporary_base where id = exercise_row.id;
    temporary_base := temporary_base + 1;
  end loop;
  for exercise_row in select id from public.workout_exercises
    where workout_id = p_workout_id order by position, id loop
    if not exists (select 1 from jsonb_array_elements(requested)
      where nullif(value->>'sourceExerciseId', '')::uuid = exercise_row.id) then
      update public.workout_exercises set position = exercise_tail where id = exercise_row.id;
      exercise_tail := exercise_tail + 1;
    end if;
    select coalesce(value->'sets', '[]'::jsonb) into requested_sets
      from jsonb_array_elements(requested)
      where nullif(value->>'sourceExerciseId', '')::uuid = exercise_row.id limit 1;
    requested_sets := coalesce(requested_sets, '[]'::jsonb);
    select coalesce(max((value->>'position')::integer), -1) + 1
      into final_tail from jsonb_array_elements(requested_sets);
    select greatest(coalesce(max(position), 0), final_tail + count(*)::integer) + 1
      into temporary_base from public.workout_sets where workout_exercise_id = exercise_row.id;
    for set_row in select id from public.workout_sets
      where workout_exercise_id = exercise_row.id order by position, id loop
      update public.workout_sets set position = temporary_base where id = set_row.id;
      temporary_base := temporary_base + 1;
    end loop;
    for set_row in select id from public.workout_sets
      where workout_exercise_id = exercise_row.id order by position, id loop
      if not exists (select 1 from jsonb_array_elements(requested_sets)
        where nullif(value->>'sourceSetId', '')::uuid = set_row.id) then
        update public.workout_sets set position = final_tail where id = set_row.id;
        final_tail := final_tail + 1;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.remove_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_expected_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  next_version bigint;
begin
  perform public.authorize_workout_mutation(p_workout_id, true);
  update public.workouts set version = version + 1, updated_by = auth.uid()
    where id = p_workout_id and status = 'in_progress'
      and deleted_at is null and version = p_expected_version
    returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  delete from public.workout_exercises
    where id = p_exercise_id and workout_id = p_workout_id;
  if not found then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;
  -- FK cascade removes only this occurrence's sets, never the catalog or
  -- another workout. Gaps in order do not require rewriting surviving rows.
  return next_version;
end;
$$;
revoke all on function private.park_completed_workout_positions(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_live_exercise(uuid, uuid, bigint) from public, anon;
grant execute on function public.remove_live_exercise(uuid, uuid, bigint) to authenticated;
