begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table(
  'private',
  'source_cutover_write_gate',
  'source cutover write gate exists outside the transferable schema'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  false,
  'source writes remain enabled by default'
);
select is(
  (
    select count(*)
    from pg_trigger trigger
    where trigger.tgname = 'source_cutover_write_gate'
      and not trigger.tgisinternal
  ),
  39::bigint,
  'one gate protects every product and background-write table'
);
select is_empty(
  $$
    select tables.table_schema, tables.table_name
    from information_schema.tables
    where tables.table_schema in ('public', 'private', 'app_private')
      and tables.table_type = 'BASE TABLE'
      and (tables.table_schema, tables.table_name)
        <> ('private', 'source_cutover_write_gate')
      and not exists (
        select 1
        from pg_trigger trigger
        join pg_class relation on relation.oid = trigger.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where trigger.tgname = 'source_cutover_write_gate'
          and not trigger.tgisinternal
          and namespace.nspname = tables.table_schema
          and relation.relname = tables.table_name
      )
  $$,
  'every application table except the gate itself is protected'
);
select is(
  has_function_privilege(
    'service_role',
    'private.set_source_cutover_write_gate(boolean)',
    'EXECUTE'
  ),
  false,
  'service role cannot operate the cutover gate'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values (
  'c1200000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'source-gate@example.test',
  'test-password'
);

insert into public.profiles (id, account_role, first_name)
values ('c1200000-0000-4000-8000-000000000001', 'trainer', 'До окна');

select is(
  private.set_source_cutover_write_gate(true),
  true,
  'database owner pauses source writes explicitly'
);
select lives_ok(
  $$select first_name from public.profiles where id = 'c1200000-0000-4000-8000-000000000001'$$,
  'reads remain available while writes are paused'
);
select throws_ok(
  $$insert into public.profiles (id) values ('c1200000-0000-4000-8000-000000000002')$$,
  'P0001',
  'source_product_writes_paused',
  'new rows are blocked'
);
select throws_ok(
  $$update public.profiles set first_name = 'Нельзя' where id = 'c1200000-0000-4000-8000-000000000001'$$,
  'P0001',
  'source_product_writes_paused',
  'updates are blocked'
);
select throws_ok(
  $$delete from public.profiles where id = 'c1200000-0000-4000-8000-000000000001'$$,
  'P0001',
  'source_product_writes_paused',
  'deletes are blocked'
);
select is(
  private.set_source_cutover_write_gate(false),
  false,
  'database owner can resume writes before the Yandex cutover'
);
select lives_ok(
  $$update public.profiles set first_name = 'Снова можно' where id = 'c1200000-0000-4000-8000-000000000001'$$,
  'writes resume after an explicit rollback'
);

select * from finish();
rollback;
