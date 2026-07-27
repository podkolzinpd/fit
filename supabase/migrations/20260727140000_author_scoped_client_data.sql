alter table public.client_progress
  add column created_by uuid references public.profiles (id) on delete set null;

update public.client_progress set created_by = trainer_id where created_by is null;

create or replace function public.can_read_workout(p_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = p_workout_id
      and (
        client.auth_user_id = auth.uid()
        or (
          (workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid()))
          and (
            client.trainer_id = auth.uid()
            or exists (
              select 1 from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = auth.uid()
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_read_workout(uuid) from public, anon;
grant execute on function public.can_read_workout(uuid) to authenticated;

drop policy if exists "workouts_read_accessible" on public.workouts;
create policy "workouts_read_accessible" on public.workouts
  for select to authenticated using (public.can_read_workout(id));

drop policy if exists "workout_exercises_read_accessible" on public.workout_exercises;
create policy "workout_exercises_read_accessible" on public.workout_exercises
  for select to authenticated using (public.can_read_workout(workout_id));

drop policy if exists "workout_sets_read_accessible" on public.workout_sets;
create policy "workout_sets_read_accessible" on public.workout_sets
  for select to authenticated using (
    exists (
      select 1 from public.workout_exercises exercise
      where exercise.id = workout_exercise_id
        and public.can_read_workout(exercise.workout_id)
    )
  );

alter function public.list_workouts(date, date, uuid, integer, integer) security invoker;

create or replace function public.list_workout_summaries(p_client_id uuid)
returns table (id uuid, workout_date date, status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select workout.id, workout.workout_date, workout.status
  from public.workouts workout
  where workout.client_id = p_client_id
    and workout.deleted_at is null
  order by workout.workout_date, workout.created_at, workout.id;
$$;

create or replace function public.authorize_workout_mutation(
  p_workout_id uuid,
  p_client_can_execute boolean
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
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;

  select workout.trainer_id into root_trainer_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and (
      (
        actor_role = 'trainer'
        and (workout.created_by = actor_id
          or (workout.created_by is null and workout.trainer_id = actor_id))
        and (
          client.trainer_id = actor_id
          or exists (
            select 1 from public.client_trainers membership
            where membership.client_id = workout.client_id
              and membership.trainer_id = actor_id
          )
        )
      )
      or (
        actor_role = 'client'
        and client.auth_user_id = actor_id
        and (p_client_can_execute or workout.created_by = actor_id)
      )
    );

  if root_trainer_id is null then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

revoke all on function public.authorize_workout_mutation(uuid, boolean) from public, anon, authenticated;

create or replace function public.save_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  root_trainer uuid;
  result uuid;
  owner_mode boolean;
  effective_workout jsonb := p_workout;
begin
  if workout_id_value is null then
    root_trainer := public.authorize_client_mutation(client_id_value, true);
  else
    root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  end if;
  select exists (
    select 1 from public.clients client
    where client.id = client_id_value and client.auth_user_id = actor_id
  ) into owner_mode;
  if owner_mode then
    select jsonb_set(
      p_workout, '{exercises}',
      coalesce(jsonb_agg(exercise_item - 'trainerComment'), '[]'::jsonb)
    ) into effective_workout
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) exercise_item;
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_workout(effective_workout, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  if workout_id_value is null then
    update public.workouts set created_by = actor_id where id = result;
  end if;
  return result;
end $$;

create or replace function public.start_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_start_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.finish_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_finish_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.save_live_set_draft(p_set_id uuid, p_draft jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_live_set_draft(p_set_id, p_draft, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_confirm_live_set(p_set_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, false);
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
  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
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
  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_remove_live_set(p_set_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.reorder_live_block(p_workout_id uuid, p_block_id uuid, p_direction smallint, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_reorder_live_block(p_workout_id, p_block_id, p_direction, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.set_exercise_comment(p_exercise_id uuid, p_comment text, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select workout_id into workout_id_value from public.workout_exercises where id = p_exercise_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_set_exercise_comment(p_exercise_id, p_comment, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.replace_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_replace_live_exercise(p_workout_id, p_exercise_id, p_exercise, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $$;

create or replace function public.soft_delete_workout(p_workout_id uuid, p_expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare original_sub text := auth.uid()::text; root_trainer uuid;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform private.legacy_soft_delete_workout(p_workout_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $$;

create or replace function public.save_progress(p_progress jsonb, p_expected_version bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_id uuid := nullif(p_progress->>'id', '')::uuid;
  client_id_value uuid := (p_progress->>'clientId')::uuid;
  actor_role text;
  root_trainer uuid;
  result uuid;
begin
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select account_role into actor_role from public.profiles where id = actor_id;
  if root_id is not null and actor_role = 'trainer' and not exists (
    select 1 from public.client_progress progress
    where progress.id = root_id and progress.client_id = client_id_value
      and progress.created_by = actor_id and progress.deleted_at is null
  ) then
    raise exception 'progress_edit_denied' using errcode = 'PT403';
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_progress(p_progress, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  if root_id is null then update public.client_progress set created_by = actor_id where id = result; end if;
  return result;
end $$;

create or replace function public.soft_delete_progress(p_progress_id uuid, p_expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  actor_role text;
  root_trainer uuid;
  client_id_value uuid;
begin
  select client_id into client_id_value from public.client_progress where id = p_progress_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'trainer' and not exists (
    select 1 from public.client_progress progress
    where progress.id = p_progress_id and progress.created_by = actor_id
      and progress.deleted_at is null
  ) then
    raise exception 'progress_delete_denied' using errcode = 'PT403';
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform private.legacy_soft_delete_progress(p_progress_id, p_expected_version);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $$;
