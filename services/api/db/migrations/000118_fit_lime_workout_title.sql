-- Up Migration

alter table public.workouts add column title text
  check (title is null or (length(title) between 1 and 120 and title = btrim(title)));

create table app_private.lime_plan_create_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workout_id uuid references public.workouts(id) on delete cascade,
  primary key (actor_id, request_id)
);
revoke all on app_private.lime_plan_create_requests from public, fit_api;

-- Keep the existing aggregate ownership, version and snapshot checks intact.
alter function public.save_planned_workout(jsonb, bigint)
  rename to save_planned_workout_without_title;
alter function public.save_planned_workout_without_title(jsonb, bigint)
  set schema app_private;
revoke all on function app_private.save_planned_workout_without_title(jsonb, bigint)
  from public, fit_api;

create function public.save_planned_workout(
  p_workout jsonb, p_expected_version bigint default null
)
returns table (workout_id uuid, version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  saved_version bigint;
  requested_title text;
  create_request uuid;
begin
  if p_workout ? 'title' then
    if not app_private.fit_lime_enabled() then
      raise exception 'workout_forbidden' using errcode = 'PT403';
    end if;
    if jsonb_typeof(p_workout->'title') not in ('string', 'null') then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    requested_title := nullif(btrim(p_workout->>'title'), '');
    if length(requested_title) > 120 then
      raise exception 'workout_invalid' using errcode = 'PT422';
    end if;
    if nullif(p_workout->>'id', '') is null and p_expected_version is null then
      create_request := nullif(p_workout->>'requestId', '')::uuid;
      if create_request is not null then
        insert into app_private.lime_plan_create_requests(actor_id, request_id)
        values (auth.uid(), create_request) on conflict do nothing;
        select receipt.workout_id into saved_id
        from app_private.lime_plan_create_requests receipt
        where receipt.actor_id = auth.uid() and receipt.request_id = create_request
        for update;
        if saved_id is not null then
          perform 1 from app_private.authorize_workout_lifecycle(saved_id, false);
          if not exists (select 1 from public.workouts w where w.id = saved_id
            and w.client_id = (p_workout->>'clientId')::uuid) then
            raise exception 'workout_invalid' using errcode = 'PT422';
          end if;
          return query select w.id, w.version, true from public.workouts w where w.id = saved_id;
          return;
        end if;
      end if;
    end if;
  end if;

  select saved.workout_id, saved.version into saved_id, saved_version
  from app_private.save_planned_workout_without_title(p_workout, p_expected_version) saved;

  -- Omission preserves the title for older clients and non-pilot editing.
  -- The root was authorized and locked by the existing aggregate above.
  if p_workout ? 'title' then
    update public.workouts set title = requested_title where id = saved_id;
  end if;
  if create_request is not null then
    update app_private.lime_plan_create_requests receipt set workout_id = saved_id
    where receipt.actor_id = auth.uid() and receipt.request_id = create_request;
  end if;
  return query select saved_id, saved_version, false;
end;
$$;

revoke all on function public.save_planned_workout(jsonb, bigint) from public;
grant execute on function public.save_planned_workout(jsonb, bigint) to fit_api;

-- Down Migration

drop function public.save_planned_workout(jsonb, bigint);
alter function app_private.save_planned_workout_without_title(jsonb, bigint)
  set schema public;
alter function public.save_planned_workout_without_title(jsonb, bigint)
  rename to save_planned_workout;
grant execute on function public.save_planned_workout(jsonb, bigint) to fit_api;
alter table public.workouts drop column title;
drop table app_private.lime_plan_create_requests;
