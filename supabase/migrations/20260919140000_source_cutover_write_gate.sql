create table private.source_cutover_write_gate (
  singleton boolean primary key default true check (singleton),
  writes_paused boolean not null default false,
  changed_at timestamptz not null default now()
);

insert into private.source_cutover_write_gate (singleton, writes_paused)
values (true, false);

revoke all on table private.source_cutover_write_gate
  from public, anon, authenticated, service_role;

create or replace function private.set_source_cutover_write_gate(
  p_writes_paused boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  protected_table record;
  result boolean;
begin
  if p_writes_paused is null then
    raise exception 'source_cutover_write_gate_invalid'
      using errcode = 'PT422';
  end if;

  if p_writes_paused then
    for protected_table in
      select namespace.nspname as table_schema,
             relation.relname as table_name
      from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where trigger.tgname = 'source_cutover_write_gate'
        and not trigger.tgisinternal
      order by namespace.nspname, relation.relname
    loop
      execute format(
        'lock table %I.%I in share mode',
        protected_table.table_schema,
        protected_table.table_name
      );
    end loop;
  end if;

  update private.source_cutover_write_gate
  set writes_paused = p_writes_paused,
      changed_at = now()
  where singleton
  returning writes_paused into result;

  if result is null then
    raise exception 'source_cutover_write_gate_missing'
      using errcode = 'P0001';
  end if;

  return result;
end;
$$;

revoke all on function private.set_source_cutover_write_gate(boolean)
  from public, anon, authenticated, service_role;

create or replace function private.enforce_source_cutover_write_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  writes_allowed boolean;
begin
  select not gate.writes_paused
  into writes_allowed
  from private.source_cutover_write_gate gate
  where gate.singleton;

  if writes_allowed is distinct from true then
    raise exception 'source_product_writes_paused'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_source_cutover_write_gate()
  from public, anon, authenticated, service_role;

do $$
declare
  protected_table record;
begin
  for protected_table in
    select *
    from (values
      ('app_private', 'training_summary_generation_guards'),
      ('private', 'assistant_program_generations'),
      ('private', 'push_notifications_outbox'),
      ('private', 'workout_create_requests'),
      ('public', 'account_deletion_requests'),
      ('public', 'app_feedback'),
      ('public', 'assistant_actions'),
      ('public', 'assistant_conversations'),
      ('public', 'assistant_messages'),
      ('public', 'chat_conversations'),
      ('public', 'chat_messages'),
      ('public', 'client_custom_metrics'),
      ('public', 'client_goals'),
      ('public', 'client_invitations'),
      ('public', 'client_merge_operations'),
      ('public', 'client_private_details'),
      ('public', 'client_progress'),
      ('public', 'client_progress_custom'),
      ('public', 'client_published_training_summaries'),
      ('public', 'client_trainer_relationships'),
      ('public', 'client_trainers'),
      ('public', 'client_training_summaries'),
      ('public', 'clients'),
      ('public', 'custom_exercises'),
      ('public', 'goal_criteria'),
      ('public', 'goal_stages'),
      ('public', 'notification_preferences'),
      ('public', 'profiles'),
      ('public', 'push_subscriptions'),
      ('public', 'trainer_discovery_prompt_preferences'),
      ('public', 'trainer_professional_profiles'),
      ('public', 'trainers'),
      ('public', 'user_feature_flags'),
      ('public', 'user_legal_acceptances'),
      ('public', 'workout_exercises'),
      ('public', 'workout_sets'),
      ('public', 'workouts')
    ) as tables(table_schema, table_name)
  loop
    execute format(
      'create trigger source_cutover_write_gate before insert or update or delete or truncate on %I.%I for each statement execute function private.enforce_source_cutover_write_gate()',
      protected_table.table_schema,
      protected_table.table_name
    );
  end loop;
end;
$$;

comment on table private.source_cutover_write_gate is
  'Default-off source write freeze used only during the final Yandex cutover.';

comment on function private.set_source_cutover_write_gate(boolean) is
  'Owner-only cutover control. Never expose through Data API grants.';
