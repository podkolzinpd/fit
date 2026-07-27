create or replace function public.authorize_client_mutation(
  p_client_id uuid,
  p_allow_owner boolean
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
  select client.trainer_id into root_trainer_id
  from public.clients client
  where client.id = p_client_id
    and (
      (actor_role = 'trainer' and (
        client.trainer_id = actor_id
        or exists (
          select 1 from public.client_trainers membership
          where membership.client_id = client.id
            and membership.trainer_id = actor_id
        )
      ))
      or (p_allow_owner and actor_role = 'client' and client.auth_user_id = actor_id)
    );
  if root_trainer_id is null and actor_role = 'trainer' then
    return actor_id;
  end if;
  if root_trainer_id is null then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

revoke all on function public.authorize_client_mutation(uuid, boolean) from public, anon, authenticated;

alter function public.save_workout(jsonb, bigint) rename to legacy_save_workout;
alter function public.start_workout(uuid, bigint) rename to legacy_start_workout;
alter function public.save_live_set_draft(uuid, jsonb, bigint) rename to legacy_save_live_set_draft;
alter function public.confirm_live_set(uuid, bigint) rename to legacy_confirm_live_set;
alter function public.finish_workout(uuid, bigint) rename to legacy_finish_workout;
alter function public.save_progress(jsonb, bigint) rename to legacy_save_progress;
alter function public.soft_delete_workout(uuid, bigint) rename to legacy_soft_delete_workout;
alter function public.soft_delete_progress(uuid, bigint) rename to legacy_soft_delete_progress;
alter function public.append_live_exercise(uuid, jsonb, bigint) rename to legacy_append_live_exercise;
alter function public.append_live_set(uuid, bigint) rename to legacy_append_live_set;
alter function public.remove_live_set(uuid, bigint) rename to legacy_remove_live_set;
alter function public.reorder_live_block(uuid, uuid, smallint, bigint) rename to legacy_reorder_live_block;
alter function public.set_exercise_comment(uuid, text, bigint) rename to legacy_set_exercise_comment;
alter function public.replace_live_exercise(uuid, uuid, jsonb, bigint) rename to legacy_replace_live_exercise;

revoke all on function public.legacy_save_workout(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.legacy_start_workout(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_save_live_set_draft(uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.legacy_confirm_live_set(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_finish_workout(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_save_progress(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.legacy_soft_delete_workout(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_soft_delete_progress(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_append_live_exercise(uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.legacy_append_live_set(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_remove_live_set(uuid, bigint) from public, anon, authenticated;
revoke all on function public.legacy_reorder_live_block(uuid, uuid, smallint, bigint) from public, anon, authenticated;
revoke all on function public.legacy_set_exercise_comment(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.legacy_replace_live_exercise(uuid, uuid, jsonb, bigint) from public, anon, authenticated;

create or replace function public.save_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result uuid;
begin
  root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_save_workout(p_workout, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.start_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_start_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.save_live_set_draft(p_set_id uuid, p_draft jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workout_sets where id = p_set_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_save_live_set_draft(p_set_id, p_draft, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workout_sets where id = p_set_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_confirm_live_set(p_set_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.finish_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_finish_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.save_progress(p_progress jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result uuid;
begin
  root_trainer := public.authorize_client_mutation((p_progress->>'clientId')::uuid, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_save_progress(p_progress, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.soft_delete_workout(p_workout_id uuid, p_expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform public.legacy_soft_delete_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $$;

create or replace function public.soft_delete_progress(p_progress_id uuid, p_expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid;
begin
  select client_id into client_id_value from public.client_progress where id = p_progress_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform public.legacy_soft_delete_progress(p_progress_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $$;

create or replace function public.append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_append_live_exercise(p_workout_id, p_exercise, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.append_live_set(p_workout_exercise_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workout_exercises where id = p_workout_exercise_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_append_live_set(p_workout_exercise_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.remove_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workout_sets where id = p_set_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_remove_live_set(p_set_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.reorder_live_block(p_workout_id uuid, p_block_id uuid, p_direction smallint, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_reorder_live_block(p_workout_id, p_block_id, p_direction, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.set_exercise_comment(p_exercise_id uuid, p_comment text, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workout_exercises where id = p_exercise_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_set_exercise_comment(p_exercise_id, p_comment, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.replace_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; client_id_value uuid; result bigint;
begin
  select client_id into client_id_value from public.workouts where id = p_workout_id;
  root_trainer := public.authorize_client_mutation(client_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := public.legacy_replace_live_exercise(p_workout_id, p_exercise_id, p_exercise, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.start_workout(uuid, bigint) to authenticated;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.confirm_live_set(uuid, bigint) to authenticated;
grant execute on function public.finish_workout(uuid, bigint) to authenticated;
grant execute on function public.save_progress(jsonb, bigint) to authenticated;
grant execute on function public.soft_delete_workout(uuid, bigint) to authenticated;
grant execute on function public.soft_delete_progress(uuid, bigint) to authenticated;
grant execute on function public.append_live_exercise(uuid, jsonb, bigint) to authenticated;
grant execute on function public.append_live_set(uuid, bigint) to authenticated;
grant execute on function public.remove_live_set(uuid, bigint) to authenticated;
grant execute on function public.reorder_live_block(uuid, uuid, smallint, bigint) to authenticated;
grant execute on function public.set_exercise_comment(uuid, text, bigint) to authenticated;
grant execute on function public.replace_live_exercise(uuid, uuid, jsonb, bigint) to authenticated;
