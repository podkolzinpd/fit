begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (
  id, instance_id, aud, role, encrypted_password
) values (
  '77000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  ''
);
insert into public.profiles (id, account_role)
values ('77000000-0000-4000-8000-000000000001', 'trainer');
insert into public.trainers (profile_id)
values ('77000000-0000-4000-8000-000000000001');
insert into public.clients (
  id, trainer_id, full_name, updated_at
) values (
  '77000000-0000-4000-8000-000000000002',
  '77000000-0000-4000-8000-000000000001',
  'Migration fixture',
  timestamptz '2026-01-01 00:00:00+00'
);

select set_config('fit.tenant_migration_restore', 'on', true);
insert into public.client_progress (
  trainer_id, client_id, created_by, recorded_on, weight_kg
) values (
  '77000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000002',
  '77000000-0000-4000-8000-000000000001',
  date '2026-01-01',
  70
);
select ok(
  (
    select updated_at = timestamptz '2026-01-01 00:00:00+00'
    from public.clients
    where id = '77000000-0000-4000-8000-000000000002'
  ),
  'tenant migration restore preserves the snapshot client timestamp'
);

select set_config('fit.tenant_migration_restore', 'off', true);
insert into public.client_progress (
  trainer_id, client_id, created_by, recorded_on, weight_kg
) values (
  '77000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000002',
  '77000000-0000-4000-8000-000000000001',
  date '2026-01-02',
  69
);
select ok(
  (
    select updated_at > timestamptz '2026-01-01 00:00:00+00'
    from public.clients
    where id = '77000000-0000-4000-8000-000000000002'
  ),
  'ordinary product progress writes still advance the client source timestamp'
);

select * from finish();
rollback;
