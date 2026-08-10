-- Во время выполнения тренировки клиент и тренер корректируют один live-план
-- одинаковыми действиями. p_client_can_execute=true сохраняет проверку связи
-- client.auth_user_id с карточкой и не открывает доступ чужим пользователям.

create or replace function public.append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_append_live_exercise(p_workout_id, p_exercise, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.append_live_set(p_workout_exercise_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select workout_id into workout_id_value from public.workout_exercises where id = p_workout_exercise_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_append_live_set(p_workout_exercise_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.remove_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_remove_live_set(p_set_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.reorder_live_block(p_workout_id uuid, p_block_id uuid, p_direction smallint, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_reorder_live_block(p_workout_id, p_block_id, p_direction, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.replace_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_replace_live_exercise(p_workout_id, p_exercise_id, p_exercise, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;
