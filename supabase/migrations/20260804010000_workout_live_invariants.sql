-- Server-side guardrails for the live workout state.

create or replace function private.legacy_start_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_archived boolean;
  next_version bigint;
begin
  select c.archived_at is not null into client_archived
  from public.workouts w
  join public.clients c on c.id = w.client_id and c.trainer_id = w.trainer_id
  where w.id = p_workout_id and w.trainer_id = actor_id and w.deleted_at is null;

  if client_archived is null or client_archived then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;

  update public.workouts set status = 'in_progress', started_at = now(), version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'planned'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;
