alter table public.workouts
  add column created_by uuid references public.profiles (id) on delete set null;

update public.workouts set created_by = trainer_id where created_by is null;

create or replace function public.save_workout(p_workout jsonb, p_expected_version bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select exists (
    select 1 from public.clients client
    where client.id = client_id_value and client.auth_user_id = actor_id
  ) into owner_mode;

  if owner_mode and workout_id_value is not null and not exists (
    select 1 from public.workouts workout
    where workout.id = workout_id_value
      and workout.client_id = client_id_value
      and workout.created_by = actor_id
      and workout.deleted_at is null
  ) then
    raise exception 'client_workout_edit_denied' using errcode = 'PT403';
  end if;

  if owner_mode then
    select jsonb_set(
      p_workout,
      '{exercises}',
      coalesce(jsonb_agg(exercise_item - 'trainerComment'), '[]'::jsonb)
    )
    into effective_workout
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) exercise_item;
  end if;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_save_workout(effective_workout, p_expected_version);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);

  if workout_id_value is null then
    update public.workouts set created_by = actor_id where id = result;
    if not found then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.soft_delete_workout(p_workout_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_trainer uuid;
  client_id_value uuid;
  creator_id uuid;
  owner_mode boolean;
begin
  select workout.client_id, workout.created_by
  into client_id_value, creator_id
  from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null;

  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select exists (
    select 1 from public.clients client
    where client.id = client_id_value and client.auth_user_id = actor_id
  ) into owner_mode;

  if owner_mode and creator_id is distinct from actor_id then
    raise exception 'client_workout_delete_denied' using errcode = 'PT403';
  end if;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    perform private.legacy_soft_delete_workout(p_workout_id, p_expected_version);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end;
$$;

revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.soft_delete_workout(uuid, bigint) from public, anon;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.soft_delete_workout(uuid, bigint) to authenticated;
