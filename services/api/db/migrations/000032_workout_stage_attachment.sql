-- Up Migration

create or replace function public.attach_workout_stage(
  p_workout_id uuid,
  p_stage_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.workouts workout
  set stage_id = p_stage_id
  from public.clients client
  where workout.id = p_workout_id
    and client.id = workout.client_id
    and workout.deleted_at is null
    and (workout.trainer_id = actor_id or client.auth_user_id = actor_id)
    and (
      p_stage_id is null
      or exists (
        select 1
        from public.goal_stages stage
        join public.client_goals goal on goal.id = stage.goal_id
        where stage.id = p_stage_id
          and goal.client_id = workout.client_id
          and goal.status = 'active'
      )
    );

  if not found then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
end;
$$;

revoke all on function public.attach_workout_stage(uuid, uuid) from public;
grant execute on function public.attach_workout_stage(uuid, uuid) to fit_api;

-- Down Migration

revoke execute on function public.attach_workout_stage(uuid, uuid) from fit_api;
drop function public.attach_workout_stage(uuid, uuid);
