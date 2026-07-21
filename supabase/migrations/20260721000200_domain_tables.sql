create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  timezone text not null default 'Europe/Moscow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_not_blank check (first_name is null or btrim(first_name) <> ''),
  constraint profiles_last_name_not_blank check (last_name is null or btrim(last_name) <> '')
);

create table if not exists public.trainers (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  gender text not null,
  age_years smallint not null,
  age_updated_at date not null default current_date,
  height_cm numeric(5, 2) not null,
  goal text,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_full_name_not_blank check (btrim(full_name) <> ''),
  constraint clients_gender_allowed check (gender in ('male', 'female')),
  constraint clients_age_range check (age_years between 1 and 119),
  constraint clients_height_range check (height_cm > 0 and height_cm < 260),
  constraint clients_id_trainer_unique unique (id, trainer_id)
);

create table if not exists public.client_private_details (
  client_id uuid primary key,
  trainer_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_private_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade
);

create table if not exists public.custom_exercises (
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
    muscle_group in ('legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other')
  ),
  constraint custom_exercises_kind_allowed check (input_kind in ('strength', 'distance', 'reps')),
  constraint custom_exercises_id_trainer_unique unique (id, trainer_id)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
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
  constraint workouts_status_allowed check (status in ('planned', 'in_progress', 'done')),
  constraint workouts_time_order check (
    (start_time is null and end_time is null)
    or (start_time is not null and (end_time is null or end_time > start_time))
  ),
  constraint workouts_status_timestamps check (
    (status = 'planned' and completed_at is null)
    or (status = 'in_progress' and started_at is not null and completed_at is null)
    or (status = 'done' and completed_at is not null)
  ),
  constraint workouts_identity_unique unique (id, trainer_id, client_id)
);

create table if not exists public.workout_exercises (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercises_workout_fk foreign key (workout_id, trainer_id, client_id)
    references public.workouts (id, trainer_id, client_id) on delete cascade,
  constraint workout_exercises_custom_fk foreign key (custom_exercise_id, trainer_id)
    references public.custom_exercises (id, trainer_id) on delete restrict,
  constraint workout_exercises_position_non_negative check (position >= 0),
  constraint workout_exercises_source_allowed check (exercise_source in ('system', 'custom')),
  constraint workout_exercises_source_consistent check (
    (exercise_source = 'system' and custom_exercise_id is null)
    or (exercise_source = 'custom' and custom_exercise_id is not null)
  ),
  constraint workout_exercises_ref_not_blank check (btrim(exercise_ref) <> ''),
  constraint workout_exercises_name_not_blank check (btrim(exercise_name) <> ''),
  constraint workout_exercises_group_allowed check (
    muscle_group in ('legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other')
  ),
  constraint workout_exercises_kind_allowed check (input_kind in ('strength', 'distance', 'reps')),
  constraint workout_exercises_position_unique unique (workout_id, position),
  constraint workout_exercises_identity_unique unique (id, trainer_id, client_id)
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null,
  trainer_id uuid not null,
  client_id uuid not null,
  position smallint not null,
  plan_weight_kg numeric(7, 2),
  plan_reps integer,
  plan_duration_min numeric(8, 2),
  plan_distance_km numeric(9, 3),
  fact_weight_kg numeric(7, 2),
  fact_reps integer,
  fact_duration_min numeric(8, 2),
  fact_distance_km numeric(9, 3),
  confirmed_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sets_exercise_fk foreign key (workout_exercise_id, trainer_id, client_id)
    references public.workout_exercises (id, trainer_id, client_id) on delete cascade,
  constraint workout_sets_position_non_negative check (position >= 0),
  constraint workout_sets_values_non_negative check (
    coalesce(plan_weight_kg, 0) >= 0
    and coalesce(plan_reps, 0) >= 0
    and coalesce(plan_duration_min, 0) >= 0
    and coalesce(plan_distance_km, 0) >= 0
    and coalesce(fact_weight_kg, 0) >= 0
    and coalesce(fact_reps, 0) >= 0
    and coalesce(fact_duration_min, 0) >= 0
    and coalesce(fact_distance_km, 0) >= 0
  ),
  constraint workout_sets_position_unique unique (workout_exercise_id, position)
);

create table if not exists public.client_progress (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  recorded_on date not null,
  weight_kg numeric(7, 2),
  chest_cm numeric(7, 2),
  waist_cm numeric(7, 2),
  hip_cm numeric(7, 2),
  notes text,
  deleted_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_progress_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete restrict,
  constraint client_progress_values_positive check (
    (weight_kg is null or weight_kg > 0)
    and (chest_cm is null or chest_cm > 0)
    and (waist_cm is null or waist_cm > 0)
    and (hip_cm is null or hip_cm > 0)
  ),
  constraint client_progress_identity_unique unique (id, trainer_id, client_id)
);

create table if not exists public.client_custom_metrics (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  name text not null,
  unit text,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_metrics_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete restrict,
  constraint client_metrics_name_not_blank check (btrim(name) <> ''),
  constraint client_metrics_unit_not_blank check (unit is null or btrim(unit) <> ''),
  constraint client_metrics_identity_unique unique (id, trainer_id, client_id)
);

create table if not exists public.client_progress_custom (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  progress_id uuid not null,
  metric_id uuid not null,
  value numeric(12, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_custom_progress_fk foreign key (progress_id, trainer_id, client_id)
    references public.client_progress (id, trainer_id, client_id) on delete cascade,
  constraint progress_custom_metric_fk foreign key (metric_id, trainer_id, client_id)
    references public.client_custom_metrics (id, trainer_id, client_id) on delete restrict,
  constraint progress_custom_unique unique (progress_id, metric_id)
);

create unique index if not exists custom_exercises_active_name_uidx
  on public.custom_exercises (trainer_id, lower(btrim(name))) where archived_at is null;
create index if not exists clients_trainer_created_idx on public.clients (trainer_id, created_at desc);
create index if not exists clients_auth_user_idx on public.clients (auth_user_id) where auth_user_id is not null;
create index if not exists workouts_trainer_date_idx on public.workouts (trainer_id, workout_date, start_time);
create index if not exists workouts_client_date_idx on public.workouts (client_id, workout_date desc);
create index if not exists workout_exercises_workout_position_idx on public.workout_exercises (workout_id, position);
create index if not exists workout_sets_exercise_position_idx on public.workout_sets (workout_exercise_id, position);
create unique index if not exists client_progress_active_date_uidx
  on public.client_progress (client_id, recorded_on) where deleted_at is null;
create index if not exists client_progress_client_date_idx on public.client_progress (client_id, recorded_on desc);
create unique index if not exists client_metrics_active_name_uidx
  on public.client_custom_metrics (client_id, lower(btrim(name))) where archived_at is null;
create index if not exists progress_custom_metric_idx on public.client_progress_custom (metric_id, progress_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'trainers', 'clients', 'client_private_details', 'custom_exercises',
    'workouts', 'workout_exercises', 'workout_sets', 'client_progress',
    'client_custom_metrics', 'client_progress_custom'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;
