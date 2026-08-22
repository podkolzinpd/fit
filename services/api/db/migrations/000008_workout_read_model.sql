-- Up Migration

create table public.custom_exercises (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  name text not null,
  muscle_group text not null,
  input_kind text not null,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_exercises_name_not_blank check (btrim(name) <> ''),
  constraint custom_exercises_group_allowed check (
    muscle_group in (
      'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
      'cardio', 'other'
    )
  ),
  constraint custom_exercises_kind_allowed check (
    input_kind in ('strength', 'distance', 'reps', 'duration')
  ),
  constraint custom_exercises_id_trainer_unique unique (id, trainer_id)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  workout_date date not null,
  start_time time,
  end_time time,
  status text not null default 'planned',
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workouts_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete restrict,
  constraint workouts_status_allowed check (
    status in ('planned', 'in_progress', 'done', 'cancelled')
  ),
  constraint workouts_time_order check (
    (start_time is null and end_time is null)
    or (start_time is not null and (end_time is null or end_time > start_time))
  ),
  constraint workouts_status_timestamps check (
    (status in ('planned', 'cancelled') and started_at is null and completed_at is null)
    or (status = 'in_progress' and started_at is not null and completed_at is null)
    or (status = 'done' and completed_at is not null)
  ),
  constraint workouts_identity_unique unique (id, trainer_id, client_id)
);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  position smallint not null,
  exercise_source text not null,
  exercise_ref text not null,
  custom_exercise_id uuid,
  exercise_name text not null,
  muscle_group text not null,
  input_kind text not null,
  block_id uuid not null default gen_random_uuid(),
  block_type text not null default 'single',
  block_preset text not null default 'set',
  block_rounds smallint not null default 1,
  rest_between_exercises_sec smallint not null default 0,
  rest_between_rounds_sec smallint not null default 90,
  rest_between_sets_sec smallint not null default 90,
  trainer_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercises_workout_fk
    foreign key (workout_id, trainer_id, client_id)
    references public.workouts (id, trainer_id, client_id) on delete cascade,
  constraint workout_exercises_custom_fk
    foreign key (custom_exercise_id, trainer_id)
    references public.custom_exercises (id, trainer_id) on delete restrict,
  constraint workout_exercises_position_non_negative check (position >= 0),
  constraint workout_exercises_source_allowed check (
    exercise_source in ('system', 'custom')
  ),
  constraint workout_exercises_source_consistent check (
    (exercise_source = 'system' and custom_exercise_id is null)
    or (exercise_source = 'custom' and custom_exercise_id is not null)
  ),
  constraint workout_exercises_ref_not_blank check (btrim(exercise_ref) <> ''),
  constraint workout_exercises_name_not_blank check (btrim(exercise_name) <> ''),
  constraint workout_exercises_group_allowed check (
    muscle_group in (
      'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
      'cardio', 'other'
    )
  ),
  constraint workout_exercises_kind_allowed check (
    input_kind in ('strength', 'distance', 'reps', 'duration')
  ),
  constraint workout_exercises_block_type_allowed check (
    block_type in ('single', 'group')
  ),
  constraint workout_exercises_block_preset_allowed check (
    block_preset in ('set', 'circuit', 'interval')
  ),
  constraint workout_exercises_block_rounds_positive check (block_rounds >= 1),
  constraint workout_exercises_rest_non_negative check (
    rest_between_exercises_sec >= 0
    and rest_between_rounds_sec >= 0
    and rest_between_sets_sec >= 0
  ),
  constraint workout_exercises_position_unique unique (workout_id, position),
  constraint workout_exercises_identity_unique unique (id, trainer_id, client_id)
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  position smallint not null,
  plan_weight_kg numeric(7, 2),
  plan_reps integer,
  plan_duration_min numeric(8, 2),
  plan_duration_sec integer,
  plan_distance_km numeric(9, 3),
  plan_rpe numeric(3, 1),
  fact_weight_kg numeric(7, 2),
  fact_reps integer,
  fact_duration_min numeric(8, 2),
  fact_duration_sec integer,
  fact_distance_km numeric(9, 3),
  fact_rpe numeric(3, 1),
  confirmed_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sets_exercise_fk
    foreign key (workout_exercise_id, trainer_id, client_id)
    references public.workout_exercises (id, trainer_id, client_id) on delete cascade,
  constraint workout_sets_position_non_negative check (position >= 0),
  constraint workout_sets_values_non_negative check (
    coalesce(plan_weight_kg, 0) >= 0
    and coalesce(plan_reps, 0) >= 0
    and coalesce(plan_duration_min, 0) >= 0
    and coalesce(plan_duration_sec, 0) >= 0
    and coalesce(plan_distance_km, 0) >= 0
    and coalesce(fact_weight_kg, 0) >= 0
    and coalesce(fact_reps, 0) >= 0
    and coalesce(fact_duration_min, 0) >= 0
    and coalesce(fact_duration_sec, 0) >= 0
    and coalesce(fact_distance_km, 0) >= 0
  ),
  constraint workout_sets_rpe_valid check (
    (plan_rpe is null or (
      plan_rpe between 6 and 10 and mod(plan_rpe * 10, 5) = 0
    ))
    and (fact_rpe is null or (
      fact_rpe between 6 and 10 and mod(fact_rpe * 10, 5) = 0
    ))
  ),
  constraint workout_sets_position_unique unique (workout_exercise_id, position)
);

create unique index custom_exercises_active_name_uidx
  on public.custom_exercises (trainer_id, lower(btrim(name)))
  where archived_at is null;
create index workouts_active_client_date_idx
  on public.workouts (client_id, workout_date desc, start_time, id)
  where deleted_at is null;
create index workouts_active_author_client_date_idx
  on public.workouts (created_by, client_id, workout_date desc, id)
  where deleted_at is null;
create index workout_exercises_workout_position_idx
  on public.workout_exercises (workout_id, position);
create index workout_sets_exercise_position_idx
  on public.workout_sets (workout_exercise_id, position);

create trigger set_updated_at
before update on public.custom_exercises
for each row execute function public.set_updated_at();
create trigger set_updated_at
before update on public.workouts
for each row execute function public.set_updated_at();
create trigger set_updated_at
before update on public.workout_exercises
for each row execute function public.set_updated_at();
create trigger set_updated_at
before update on public.workout_sets
for each row execute function public.set_updated_at();

alter table public.custom_exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

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
      and workout.deleted_at is null
      and (
        client.auth_user_id = auth.uid()
        or (
          (
            client.trainer_id = auth.uid()
            or exists (
              select 1
              from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = auth.uid()
            )
          )
          and (
            workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid())
            or (
              workout.status = 'done'
              and workout.created_by = client.auth_user_id
            )
          )
        )
      )
  )
$$;

revoke all on function public.can_read_workout(uuid) from public;
grant execute on function public.can_read_workout(uuid) to fit_api;

create policy custom_exercises_read_own on public.custom_exercises
  for select to fit_api
  using (trainer_id = (select auth.uid()));

create policy workouts_read_accessible on public.workouts
  for select to fit_api
  using (public.can_read_workout(id));

create policy workout_exercises_read_accessible on public.workout_exercises
  for select to fit_api
  using (public.can_read_workout(workout_id));

create policy workout_sets_read_accessible on public.workout_sets
  for select to fit_api
  using (
    exists (
      select 1
      from public.workout_exercises exercise
      where exercise.id = workout_exercise_id
        and public.can_read_workout(exercise.workout_id)
    )
  );

revoke all on public.custom_exercises, public.workouts,
  public.workout_exercises, public.workout_sets from public;
grant select on public.custom_exercises, public.workouts,
  public.workout_exercises, public.workout_sets to fit_api;

-- Down Migration

revoke select on public.custom_exercises, public.workouts,
  public.workout_exercises, public.workout_sets from fit_api;
drop policy workout_sets_read_accessible on public.workout_sets;
drop policy workout_exercises_read_accessible on public.workout_exercises;
drop policy workouts_read_accessible on public.workouts;
drop policy custom_exercises_read_own on public.custom_exercises;
revoke execute on function public.can_read_workout(uuid) from fit_api;
drop function public.can_read_workout(uuid);
drop table public.workout_sets;
drop table public.workout_exercises;
drop table public.workouts;
drop table public.custom_exercises;
