-- Preserve author ownership when a trainer or client creates a custom
-- exercise. The partition remains the root trainer/profile partition used by
-- workouts and composite foreign keys.

alter table public.custom_exercises
  add column created_by uuid;

update public.custom_exercises
set created_by = trainer_id
where created_by is null;

alter table public.custom_exercises
  alter column created_by set default auth.uid(),
  alter column created_by set not null,
  add constraint custom_exercises_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete restrict;

alter table public.custom_exercises
  drop constraint custom_exercises_trainer_id_fkey,
  add constraint custom_exercises_partition_owner_fk
    foreign key (trainer_id) references public.profiles (id) on delete restrict;

drop index custom_exercises_active_name_uidx;
create unique index custom_exercises_active_author_name_uidx
  on public.custom_exercises (created_by, lower(btrim(name)))
  where archived_at is null;

drop policy custom_exercises_read_own on public.custom_exercises;
create policy custom_exercises_read_accessible on public.custom_exercises
  for select to fit_api
  using (
    created_by = (select auth.uid())
    or trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients client
      where client.auth_user_id = custom_exercises.created_by
        and client.trainer_id = custom_exercises.trainer_id
        and public.can_access_client(client.id)
    )
    or (
      created_by = trainer_id
      and exists (
        select 1
        from public.clients client
        where client.auth_user_id = (select auth.uid())
          and client.trainer_id = custom_exercises.trainer_id
          and client.archived_at is null
      )
    )
  );

create or replace function public.create_custom_exercise(p_exercise jsonb)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  partition_owner_id uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_role = 'trainer' then
    partition_owner_id := actor_id;
  elsif actor_role = 'client' then
    select client.trainer_id into partition_owner_id
    from public.clients client
    where client.auth_user_id = actor_id
      and client.archived_at is null
      and client.merged_into_client_id is null;
  end if;

  if partition_owner_id is null then
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;

  return query
  insert into public.custom_exercises (
    trainer_id,
    created_by,
    name,
    muscle_group,
    input_kind
  ) values (
    partition_owner_id,
    actor_id,
    btrim(p_exercise->>'name'),
    p_exercise->>'muscleGroup',
    p_exercise->>'inputKind'
  )
  returning
    id,
    name,
    public.custom_exercises.muscle_group,
    public.custom_exercises.input_kind,
    public.custom_exercises.archived_at,
    public.custom_exercises.version;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
  when check_violation or foreign_key_violation then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.update_custom_exercise(
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  return query
  update public.custom_exercises exercise
  set
    name = btrim(p_exercise->>'name'),
    muscle_group = p_exercise->>'muscleGroup',
    input_kind = p_exercise->>'inputKind',
    version = exercise.version + 1
  where exercise.id = p_exercise_id
    and exercise.version = p_expected_version
    and (
      exercise.created_by = actor_id
      or exercise.trainer_id = actor_id
      or exists (
        select 1
        from public.clients client
        where client.auth_user_id = exercise.created_by
          and client.trainer_id = exercise.trainer_id
          and public.can_access_client(client.id)
      )
    )
  returning
    exercise.id,
    exercise.name,
    exercise.muscle_group,
    exercise.input_kind,
    exercise.archived_at,
    exercise.version;

  if not found then
    if exists (
      select 1
      from public.custom_exercises exercise
      where exercise.id = p_exercise_id
        and (
          exercise.created_by = actor_id
          or exercise.trainer_id = actor_id
          or exists (
            select 1
            from public.clients client
            where client.auth_user_id = exercise.created_by
              and client.trainer_id = exercise.trainer_id
              and public.can_access_client(client.id)
          )
        )
    ) then
      raise exception 'custom_exercise_conflict' using errcode = 'PT409';
    end if;
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
  when check_violation then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.set_custom_exercise_archived(
  p_exercise_id uuid,
  p_archived boolean,
  p_expected_version bigint
)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  return query
  update public.custom_exercises exercise
  set
    archived_at = case when p_archived then now() else null end,
    version = exercise.version + 1
  where exercise.id = p_exercise_id
    and exercise.version = p_expected_version
    and (
      exercise.created_by = actor_id
      or exercise.trainer_id = actor_id
      or exists (
        select 1
        from public.clients client
        where client.auth_user_id = exercise.created_by
          and client.trainer_id = exercise.trainer_id
          and public.can_access_client(client.id)
      )
    )
  returning
    exercise.id,
    exercise.name,
    exercise.muscle_group,
    exercise.input_kind,
    exercise.archived_at,
    exercise.version;

  if not found then
    if exists (
      select 1
      from public.custom_exercises exercise
      where exercise.id = p_exercise_id
        and (
          exercise.created_by = actor_id
          or exercise.trainer_id = actor_id
          or exists (
            select 1
            from public.clients client
            where client.auth_user_id = exercise.created_by
              and client.trainer_id = exercise.trainer_id
              and public.can_access_client(client.id)
          )
        )
    ) then
      raise exception 'custom_exercise_conflict' using errcode = 'PT409';
    end if;
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
end;
$$;
