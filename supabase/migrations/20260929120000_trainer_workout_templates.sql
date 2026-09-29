-- YAFIT-292: trainer-owned reusable workout plans.
-- A template is a self-contained snapshot: it never keeps a client, workout,
-- result, wellbeing, comment or personal-record reference.

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (profile_id) on delete cascade,
  name text not null,
  notes text,
  exercises jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_templates_name_not_blank check (btrim(name) <> ''),
  constraint workout_templates_name_length check (char_length(name) <= 80),
  constraint workout_templates_notes_length check (notes is null or char_length(notes) <= 5000),
  constraint workout_templates_exercises_array check (jsonb_typeof(exercises) = 'array')
);

create trigger source_cutover_write_gate
before insert or update or delete on public.workout_templates
for each statement execute function private.enforce_source_cutover_write_gate();

create index workout_templates_trainer_updated_idx
  on public.workout_templates (trainer_id, updated_at desc)
  where archived_at is null;

create trigger set_updated_at before update on public.workout_templates
  for each row execute function public.set_updated_at();

alter table public.workout_templates enable row level security;

create policy "workout_templates_read_own" on public.workout_templates
  for select to authenticated using (trainer_id = (select auth.uid()));

revoke all on public.workout_templates from anon, authenticated;
grant select on public.workout_templates to authenticated;

create function public.save_workout_template(
  p_template jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  template_id uuid := nullif(p_template ->> 'id', '')::uuid;
  template_name text := btrim(coalesce(p_template ->> 'name', ''));
  template_notes text := nullif(btrim(coalesce(p_template ->> 'notes', '')), '');
  template_exercises jsonb := coalesce(p_template -> 'exercises', '[]'::jsonb);
  current_version bigint;
begin
  if actor_id is null or not exists (
    select 1 from public.trainers where profile_id = actor_id
  ) then
    raise exception 'trainer_not_initialized' using errcode = 'PT403';
  end if;
  if template_id is null or template_name = '' or char_length(template_name) > 80
    or char_length(coalesce(template_notes, '')) > 5000
    or jsonb_typeof(template_exercises) <> 'array' then
    raise exception 'invalid_workout_template' using errcode = 'PT422';
  end if;
  if jsonb_array_length(template_exercises) > 100 or exists (
    select 1 from jsonb_array_elements(template_exercises) exercise
    where jsonb_typeof(exercise) <> 'object'
      or not (exercise ?& array['source','ref','name','muscleGroup','inputKind','position','sets'])
      or exercise ?| array['sourceExerciseId','clientId','workoutId','fact','confirmedAt']
      or jsonb_typeof(exercise -> 'sets') <> 'array'
      or exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(exercise -> 'sets') = 'array'
            then exercise -> 'sets' else '[]'::jsonb end
        ) template_set
        where jsonb_typeof(template_set) <> 'object'
          or template_set ?| array['sourceSetId','fact','confirmedAt','version','id']
      )
  ) then
    raise exception 'invalid_workout_template' using errcode = 'PT422';
  end if;

  select version into current_version
  from public.workout_templates
  where id = template_id and trainer_id = actor_id and archived_at is null
  for update;

  if found then
    if p_expected_version is null or current_version <> p_expected_version then
      raise exception 'workout_template_conflict' using errcode = 'PT409';
    end if;
    update public.workout_templates
      set name = template_name,
          notes = template_notes,
          exercises = template_exercises,
          version = version + 1
      where id = template_id and trainer_id = actor_id;
  else
    if p_expected_version is not null then
      raise exception 'workout_template_not_found' using errcode = 'PT404';
    end if;
    insert into public.workout_templates (id, trainer_id, name, notes, exercises)
      values (template_id, actor_id, template_name, template_notes, template_exercises)
      on conflict (id) do nothing;
    if not found and not exists (
      select 1 from public.workout_templates
      where id = template_id and trainer_id = actor_id and archived_at is null
    ) then
      raise exception 'workout_template_conflict' using errcode = 'PT409';
    end if;
  end if;
  return template_id;
end;
$$;

create function public.archive_workout_template(
  p_template_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare next_version bigint;
begin
  update public.workout_templates
    set archived_at = now(), version = version + 1
    where id = p_template_id
      and trainer_id = auth.uid()
      and archived_at is null
      and version = p_expected_version
    returning version into next_version;
  if next_version is null then
    if exists (
      select 1 from public.workout_templates
      where id = p_template_id and trainer_id = auth.uid() and archived_at is null
    ) then
      raise exception 'workout_template_conflict' using errcode = 'PT409';
    end if;
    raise exception 'workout_template_not_found' using errcode = 'PT404';
  end if;
  return next_version;
end;
$$;

revoke all on function public.save_workout_template(jsonb, bigint) from public, anon;
revoke all on function public.archive_workout_template(uuid, bigint) from public, anon;
grant execute on function public.save_workout_template(jsonb, bigint) to authenticated;
grant execute on function public.archive_workout_template(uuid, bigint) to authenticated;
