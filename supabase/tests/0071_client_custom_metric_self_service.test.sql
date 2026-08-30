begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'metric-owner@example.test', ''),
  ('f2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'metric-linked@example.test', ''),
  ('f3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'metric-trainer@example.test', ''),
  ('f4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'metric-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('f1000000-0000-4000-8000-000000000001', 'client', 'Самостоятельный'),
  ('f2000000-0000-4000-8000-000000000002', 'client', 'Связанный'),
  ('f3000000-0000-4000-8000-000000000003', 'trainer', 'Тренер'),
  ('f4000000-0000-4000-8000-000000000004', 'trainer', 'Посторонний');
insert into public.trainers (profile_id) values
  ('f3000000-0000-4000-8000-000000000003'),
  ('f4000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('f1100000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Самостоятельный клиент'),
  ('f2200000-0000-4000-8000-000000000022', 'f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000002', 'Клиент с тренером');
insert into public.client_trainers (client_id, trainer_id) values
  ('f2200000-0000-4000-8000-000000000022', 'f3000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select id as standalone_metric_id from public.create_client_custom_metric(
  'f1100000-0000-4000-8000-000000000011', '  Плечи  ', ' см '
) \gset
select ok(:'standalone_metric_id' is not null, 'standalone client creates a custom metric');
select is((select name from public.client_custom_metrics where id = :'standalone_metric_id'), 'Плечи', 'metric name is normalized');
select is((select unit from public.client_custom_metrics where id = :'standalone_metric_id'), 'см', 'metric unit is normalized');
select throws_ok(
  $$insert into public.client_custom_metrics (trainer_id, client_id, name, unit)
    values ('f1000000-0000-4000-8000-000000000001', 'f1100000-0000-4000-8000-000000000011', 'Обход RPC', 'см')$$,
  '42501', null, 'direct client insert remains blocked by RLS'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
select id as linked_metric_id from public.create_client_custom_metric(
  'f2200000-0000-4000-8000-000000000022', 'Обхват плеч', 'см'
) \gset
select ok(:'linked_metric_id' is not null, 'linked client creates a custom metric');
select is((select trainer_id from public.client_custom_metrics where id = :'linked_metric_id'), 'f3000000-0000-4000-8000-000000000003'::uuid, 'linked metric stays in the trainer partition');
select throws_ok(
  $$select public.create_client_custom_metric('f2200000-0000-4000-8000-000000000022', 'Обхват плеч', 'см')$$,
  'PT409', null, 'duplicate active metric is rejected clearly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000003', true);
select lives_ok(
  format($$select public.set_client_custom_metric_archived(%L::uuid, 1, true)$$, :'linked_metric_id'),
  'linked trainer can still archive the client-created metric'
);
select ok((select archived_at is not null from public.client_custom_metrics where id = :'linked_metric_id'), 'metric was archived');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.create_client_custom_metric('f2200000-0000-4000-8000-000000000022', 'Чужой показатель', 'см')$$,
  'PT403', null, 'unrelated trainer cannot create a metric'
);
select throws_ok(
  format($$select public.set_client_custom_metric_archived(%L::uuid, 2, false)$$, :'linked_metric_id'),
  'PT403', null, 'unrelated trainer cannot restore a metric'
);
reset role;

select * from finish();
rollback;
