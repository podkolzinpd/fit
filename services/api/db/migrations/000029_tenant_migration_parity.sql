-- Up Migration

-- Preserve the V1 goal-stage binding during tenant migration. The relation is
-- nullable and intentionally becomes null when a stage is deleted.
alter table public.workouts
  add column stage_id uuid references public.goal_stages (id) on delete set null;

create index workouts_stage_idx
  on public.workouts (stage_id)
  where stage_id is not null;

-- Preserve the actor that last changed a progress record. Analytics uses this
-- separately from created_by to distinguish client activity from trainer work.
alter table public.client_progress
  add column updated_by uuid references public.profiles (id) on delete set null;

-- Down Migration

drop index if exists public.workouts_stage_idx;

alter table public.client_progress
  drop column if exists updated_by;

alter table public.workouts
  drop column if exists stage_id;
