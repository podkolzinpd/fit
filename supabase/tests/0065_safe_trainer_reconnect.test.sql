begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('65000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconnect-old-trainer@example.test', ''),
  ('65000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconnect-new-trainer@example.test', ''),
  ('65000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconnect-client@example.test', ''),
  ('65000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconnect-third-trainer@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('65000000-0000-4000-8000-000000000001', 'trainer', 'Old trainer'),
  ('65000000-0000-4000-8000-000000000002', 'trainer', 'New trainer'),
  ('65000000-0000-4000-8000-000000000003', 'client', 'Client'),
  ('65000000-0000-4000-8000-000000000004', 'trainer', 'Third trainer');
insert into public.trainers (profile_id) values
  ('65000000-0000-4000-8000-000000000001'),
  ('65000000-0000-4000-8000-000000000002'),
  ('65000000-0000-4000-8000-000000000004');

-- Самостоятельная каноническая карточка, уже отключённая от прежнего тренера,
-- и две предварительные карточки от потенциальных новых тренеров.
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('65000000-0000-4000-8000-000000000010', '65000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', 'Canonical client'),
  ('65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000002', null, 'New trainer card'),
  ('65000000-0000-4000-8000-000000000012', '65000000-0000-4000-8000-000000000004', null, 'Third trainer card');
insert into public.client_trainers (client_id, trainer_id, alias, note) values
  ('65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000002', 'New alias', 'New private note'),
  ('65000000-0000-4000-8000-000000000012', '65000000-0000-4000-8000-000000000004', 'Third alias', 'Third private note');
insert into public.client_trainer_relationships (
  id, client_id, trainer_id, status, connected_at, connected_by,
  disconnected_at, disconnected_by
) values (
  '65000000-0000-4000-8000-000000000020',
  '65000000-0000-4000-8000-000000000010',
  '65000000-0000-4000-8000-000000000001',
  'disconnected',
  '2026-08-01 12:00+00',
  '65000000-0000-4000-8000-000000000003',
  '2026-08-20 12:00+00',
  '65000000-0000-4000-8000-000000000003'
);

insert into public.workouts (
  id, trainer_id, client_id, created_by, updated_by, workout_date,
  status, started_at, completed_at
) values
  (
    '65000000-0000-4000-8000-000000000030', '65000000-0000-4000-8000-000000000003',
    '65000000-0000-4000-8000-000000000010', '65000000-0000-4000-8000-000000000003',
    '65000000-0000-4000-8000-000000000003', '2026-08-18', 'done',
    '2026-08-18 10:00+00', '2026-08-18 11:00+00'
  ),
  (
    '65000000-0000-4000-8000-000000000031', '65000000-0000-4000-8000-000000000002',
    '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000002',
    '65000000-0000-4000-8000-000000000002', '2026-08-29', 'planned', null, null
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
create temporary table reconnect_code as
select public.create_client_invitation('65000000-0000-4000-8000-000000000011', 'client') code;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000004', true);
create temporary table switch_code as
select public.create_client_invitation('65000000-0000-4000-8000-000000000012', 'client') code;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select is(
  public.reconnect_client_trainer((select code from reconnect_code)),
  '65000000-0000-4000-8000-000000000010'::uuid,
  'disconnected standalone client remains the canonical card'
);
reset role;

select is((select merged_into_client_id from public.clients where id = '65000000-0000-4000-8000-000000000011'), '65000000-0000-4000-8000-000000000010'::uuid, 'new trainer card redirects to canonical card');
select ok((select archived_at is not null from public.clients where id = '65000000-0000-4000-8000-000000000011'), 'new trainer card is archived after merge');
select is((select count(*) from public.workouts where id = '65000000-0000-4000-8000-000000000030' and client_id = '65000000-0000-4000-8000-000000000010'), 1::bigint, 'standalone workout history is preserved');
select is((select client_id from public.workouts where id = '65000000-0000-4000-8000-000000000031'), '65000000-0000-4000-8000-000000000010'::uuid, 'new trainer plan moves to canonical card');
select is((select created_by from public.workouts where id = '65000000-0000-4000-8000-000000000031'), '65000000-0000-4000-8000-000000000002'::uuid, 'new trainer plan authorship is preserved');
select is((select trainer_id from public.client_trainer_relationships where client_id = '65000000-0000-4000-8000-000000000010' and status = 'active'), '65000000-0000-4000-8000-000000000002'::uuid, 'new trainer becomes the only active trainer');
select is((select count(*) from public.client_trainer_relationships where client_id = '65000000-0000-4000-8000-000000000010' and status = 'active'), 1::bigint, 'canonical card has exactly one active trainer');
select is((select status from public.client_trainer_relationships where id = '65000000-0000-4000-8000-000000000020'), 'disconnected', 'old trainer relationship history stays disconnected');
select is((select note from public.client_trainers where client_id = '65000000-0000-4000-8000-000000000010' and trainer_id = '65000000-0000-4000-8000-000000000002'), 'New private note', 'new trainer membership follows the canonical card');
select is((select claimed_by from public.client_invitations where client_id = '65000000-0000-4000-8000-000000000011'), '65000000-0000-4000-8000-000000000003'::uuid, 'new invitation is claimed by the client');

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select is(public.can_access_client('65000000-0000-4000-8000-000000000010'), true, 'new trainer receives access');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select is(public.can_access_client('65000000-0000-4000-8000-000000000010'), false, 'old trainer remains without access');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select is(public.can_access_client('65000000-0000-4000-8000-000000000010'), true, 'client keeps access to own history');
select is(public.reconnect_client_trainer((select code from reconnect_code)), '65000000-0000-4000-8000-000000000010'::uuid, 'repeating the same reconnect is idempotent');
reset role;
select is((select count(*) from public.client_merge_operations where source_client_id = '65000000-0000-4000-8000-000000000011'), 1::bigint, 'idempotent retry does not duplicate merge audit');

-- Скрытая смена активного тренера отклоняется целиком.
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.reconnect_client_trainer((select code from switch_code))$$,
  'PT409', 'trainer_disconnect_required', 'active trainer must be explicitly disconnected before switching'
);
reset role;
select is((select trainer_id from public.client_trainer_relationships where client_id = '65000000-0000-4000-8000-000000000010' and status = 'active'), '65000000-0000-4000-8000-000000000002'::uuid, 'failed switch keeps current trainer active');
select ok((select claimed_at is null from public.client_invitations where client_id = '65000000-0000-4000-8000-000000000012'), 'failed switch keeps invitation usable');
select ok((select archived_at is null from public.clients where id = '65000000-0000-4000-8000-000000000012'), 'failed switch keeps third trainer card active');
select is((select count(*) from public.client_merge_operations where source_client_id = '65000000-0000-4000-8000-000000000012'), 0::bigint, 'failed switch leaves no partial merge audit');

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.reconnect_client_trainer((select code from switch_code))$$,
  'PT403', 'client_role_required', 'trainer cannot invoke client reconnect'
);
reset role;

select * from finish();
rollback;
