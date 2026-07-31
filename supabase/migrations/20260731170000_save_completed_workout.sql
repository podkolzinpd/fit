-- Ручная запись прошедшей тренировки: введённые значения сразу становятся фактом.
create or replace function public.save_completed_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; root_trainer uuid; original_sub text := auth.uid()::text;
begin
  root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_save_workout(p_workout, p_expected_version);
    update public.workout_sets set
      fact_weight_kg = plan_weight_kg, fact_reps = plan_reps,
      fact_duration_min = plan_duration_min, fact_duration_sec = plan_duration_sec,
      fact_distance_km = plan_distance_km, fact_rpe = plan_rpe,
      confirmed_at = now(), version = version + 1
    where workout_exercise_id in (select id from public.workout_exercises where workout_id = result);
    update public.workouts set status = 'done', completed_at = now(), version = version + 1 where id = result;
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;
revoke all on function public.save_completed_workout(jsonb, bigint) from public, anon;
grant execute on function public.save_completed_workout(jsonb, bigint) to authenticated;
