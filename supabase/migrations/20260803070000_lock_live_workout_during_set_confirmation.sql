-- Подтверждение подхода и завершение тренировки должны сериализоваться по
-- одной строке workouts: факт либо попадает в завершённую тренировку, либо
-- получает конфликт, если тренировка уже завершена.
create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  original_sub text := auth.uid()::text;
  root_trainer uuid;
  workout_id_value uuid;
  result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;

  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    perform 1
    from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id
      and workout.trainer_id = root_trainer
      and workout.status = 'in_progress'
      and workout.deleted_at is null
    for update of workout;
    if not found then raise exception 'live_set_conflict' using errcode = 'PT409'; end if;

    result := private.legacy_confirm_live_set(p_set_id, p_expected_version);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end;
$$;

revoke all on function public.confirm_live_set(uuid, bigint) from public, anon;
grant execute on function public.confirm_live_set(uuid, bigint) to authenticated;
