-- Завершённая тренировка должна иметь того же автора, что и обычная.
-- Иначе запись, созданная тренером или ассистентом, не проходит author-scoped
-- проверки доступа после первого сохранения.
create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  result uuid;
  root_trainer uuid;
  original_sub text := actor_id::text;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  saving_version bigint := p_expected_version;
  original_completed_at timestamptz;
begin
  if workout_id_value is null then
    root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  else
    root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    if workout_id_value is not null then
      select completed_at into original_completed_at from public.workouts where id = workout_id_value;
      update public.workouts set status = 'planned', completed_at = null, version = version + 1
      where id = workout_id_value and status = 'done' and deleted_at is null
        and version = p_expected_version
      returning version into saving_version;
      if saving_version is null then
        raise exception 'workout_conflict' using errcode = 'PT409';
      end if;
    end if;
    result := private.legacy_save_workout(p_workout, saving_version);
    update public.workout_sets set
      fact_weight_kg = plan_weight_kg, fact_reps = plan_reps,
      fact_duration_min = plan_duration_min, fact_duration_sec = plan_duration_sec,
      fact_distance_km = plan_distance_km, fact_rpe = plan_rpe,
      confirmed_at = now(), version = version + 1
    where workout_exercise_id in (select id from public.workout_exercises where workout_id = result);
    update public.workouts set status = 'done', completed_at = coalesce(completed_at, original_completed_at, now()), version = version + 1
    where id = result;
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  if workout_id_value is null then
    update public.workouts set created_by = actor_id where id = result;
  end if;
  return result;
end $$;

revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
