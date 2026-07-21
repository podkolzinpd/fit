alter table public.profiles enable row level security;
alter table public.trainers enable row level security;
alter table public.clients enable row level security;
alter table public.client_private_details enable row level security;
alter table public.custom_exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.client_progress enable row level security;
alter table public.client_custom_metrics enable row level security;
alter table public.client_progress_custom enable row level security;

create policy "profiles_read_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "trainers_read_own" on public.trainers
  for select to authenticated using (profile_id = (select auth.uid()));

create policy "clients_read_accessible" on public.clients
  for select to authenticated using (
    trainer_id = (select auth.uid()) or auth_user_id = (select auth.uid())
  );
create policy "clients_insert_own" on public.clients
  for insert to authenticated with check (trainer_id = (select auth.uid()));
create policy "clients_update_own" on public.clients
  for update to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create policy "client_private_read_own" on public.client_private_details
  for select to authenticated using (trainer_id = (select auth.uid()));
create policy "client_private_insert_own" on public.client_private_details
  for insert to authenticated with check (trainer_id = (select auth.uid()));
create policy "client_private_update_own" on public.client_private_details
  for update to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create policy "custom_exercises_read_own" on public.custom_exercises
  for select to authenticated using (trainer_id = (select auth.uid()));
create policy "custom_exercises_insert_own" on public.custom_exercises
  for insert to authenticated with check (trainer_id = (select auth.uid()));
create policy "custom_exercises_update_own" on public.custom_exercises
  for update to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

create policy "workouts_read_accessible" on public.workouts
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.workouts.client_id
        and c.trainer_id = public.workouts.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );
create policy "workout_exercises_read_accessible" on public.workout_exercises
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.workout_exercises.client_id
        and c.trainer_id = public.workout_exercises.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );
create policy "workout_sets_read_accessible" on public.workout_sets
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.workout_sets.client_id
        and c.trainer_id = public.workout_sets.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );

create policy "progress_read_accessible" on public.client_progress
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.client_progress.client_id
        and c.trainer_id = public.client_progress.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );
create policy "metrics_read_accessible" on public.client_custom_metrics
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.client_custom_metrics.client_id
        and c.trainer_id = public.client_custom_metrics.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );
create policy "metrics_insert_own" on public.client_custom_metrics
  for insert to authenticated with check (
    trainer_id = (select auth.uid())
    and exists (
      select 1 from public.clients c
      where c.id = public.client_custom_metrics.client_id
        and c.trainer_id = (select auth.uid())
        and c.archived_at is null
    )
  );
create policy "metrics_update_own" on public.client_custom_metrics
  for update to authenticated using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));
create policy "progress_custom_read_accessible" on public.client_progress_custom
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.clients c
      where c.id = public.client_progress_custom.client_id
        and c.trainer_id = public.client_progress_custom.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.trainers to authenticated;
grant select on public.clients, public.client_private_details to authenticated;
grant update (archived_at, version) on public.clients to authenticated;
grant select, insert, update on public.custom_exercises to authenticated;
grant select on public.workouts, public.workout_exercises, public.workout_sets to authenticated;
grant select on public.client_progress, public.client_progress_custom to authenticated;
grant select, insert, update on public.client_custom_metrics to authenticated;
