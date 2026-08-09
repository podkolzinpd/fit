-- A client can have one live workout at a time, regardless of who started it.
-- Keep the most recently started legacy workout live; older duplicate records
-- remain as plans so no exercises or entered values are deleted during rollout.
with ranked_active_workouts as (
  select
    id,
    row_number() over (
      partition by client_id
      order by started_at desc nulls last, updated_at desc, created_at desc, id desc
    ) as position
  from public.workouts
  where status = 'in_progress' and deleted_at is null
)
update public.workouts workout
set
  status = 'planned',
  started_at = null,
  version = workout.version + 1,
  updated_at = now()
from ranked_active_workouts ranked
where workout.id = ranked.id and ranked.position > 1;

create unique index workouts_one_active_per_client_uidx
  on public.workouts (client_id)
  where status = 'in_progress' and deleted_at is null;

create or replace function public.start_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_sub text := auth.uid()::text;
  root_trainer uuid;
  target_client_id uuid;
  active_workout_id uuid;
  result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);

  select client_id into target_client_id
  from public.workouts
  where id = p_workout_id and deleted_at is null;

  select id into active_workout_id
  from public.workouts
  where client_id = target_client_id
    and id <> p_workout_id
    and status = 'in_progress'
    and deleted_at is null;

  if active_workout_id is not null then
    raise exception 'active_workout_exists' using errcode = 'PT409';
  end if;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_start_workout(p_workout_id, p_expected_version);
  exception
    when unique_violation then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise exception 'active_workout_exists' using errcode = 'PT409';
    when others then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end;
$$;
