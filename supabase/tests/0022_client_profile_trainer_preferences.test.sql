begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-root@example.test', ''),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-member@example.test', ''),
  ('d3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-client@example.test', ''),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-stranger@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('d1000000-0000-4000-8000-000000000001', 'trainer', 'Root'),
  ('d2000000-0000-4000-8000-000000000002', 'trainer', 'Member'),
  ('d3000000-0000-4000-8000-000000000003', 'client', 'Иван'),
  ('d4000000-0000-4000-8000-000000000004', 'trainer', 'Stranger');
insert into public.trainers (profile_id) values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select isnt(
  public.create_client(jsonb_build_object(
    'fullName', 'Иван', 'gender', 'male', 'ageYears', 30,
    'ageUpdatedAt', current_date, 'heightCm', 180, 'note', 'Моя заметка'
  )),
  null::uuid,
  'trainer creates a client card'
);
select is(
  (select count(*) from public.client_trainers
   where trainer_id = 'd1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'creation adds the root membership explicitly'
);
select is(
  (select alias from public.client_trainers
   where trainer_id = 'd1000000-0000-4000-8000-000000000001'),
  'Иван',
  'creation stores the initial trainer alias'
);
reset role;

update public.clients
set auth_user_id = 'd3000000-0000-4000-8000-000000000003'
where trainer_id = 'd1000000-0000-4000-8000-000000000001';
insert into public.client_trainers (client_id, trainer_id)
select id, 'd2000000-0000-4000-8000-000000000002'
from public.clients
where trainer_id = 'd1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000003', true);
select lives_ok(
  format(
    'select public.update_own_client(%L::jsonb, 1)',
    jsonb_build_object(
      'id', (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
      'fullName', 'Иван Настоящий', 'gender', 'male', 'ageYears', 31,
      'ageUpdatedAt', current_date, 'heightCm', 181, 'goal', 'Моя цель'
    )::text
  ),
  'client updates canonical profile'
);
select is(
  (select full_name from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
  'Иван Настоящий',
  'canonical name belongs to the client'
);
select is(
  (select alias from public.client_trainers
   where trainer_id = 'd1000000-0000-4000-8000-000000000001'),
  'Иван',
  'client profile edit does not overwrite trainer alias'
);
select throws_ok(
  format(
    'select public.update_own_client(%L::jsonb, 1)',
    jsonb_build_object(
      'id', (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
      'fullName', 'Конфликт', 'gender', 'male', 'ageYears', 31,
      'ageUpdatedAt', current_date, 'heightCm', 181
    )::text
  ),
  'PT409', 'client_conflict', 'client profile uses optimistic version'
);
select throws_ok(
  format(
    'select public.update_client_trainer_preferences(%L, %L, null, 1)',
    (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
    'Не моё имя'
  ),
  'PT403', 'membership_not_allowed', 'client cannot write trainer preferences'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is((select full_name from public.list_clients()), 'Иван', 'root sees its own alias');
select lives_ok(
  format(
    'select public.update_client_trainer_preferences(%L, %L, %L, 1)',
    (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
    'Иван 1',
    'Только моя заметка'
  ),
  'trainer updates own preferences'
);
select is((select full_name from public.list_clients()), 'Иван 1', 'updated alias is used in trainer list');
select is((select note from public.list_clients()), 'Только моя заметка', 'trainer sees own private note');
select throws_ok(
  format(
    'select public.update_own_client(%L::jsonb, 2)',
    jsonb_build_object(
      'id', (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
      'fullName', 'Trainer edit', 'gender', 'male', 'ageYears', 31,
      'ageUpdatedAt', current_date, 'heightCm', 181
    )::text
  ),
  'PT403', 'client_profile_access_denied', 'trainer cannot edit canonical profile'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
select is(
  (select full_name from public.list_clients()),
  'Иван Настоящий',
  'membership without alias falls back to canonical name'
);
select lives_ok(
  format(
    'select public.update_client_trainer_preferences(%L, %L, null, 1)',
    (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
    'Иван 2'
  ),
  'second trainer sets an independent alias'
);
select is((select full_name from public.list_clients()), 'Иван 2', 'second trainer sees only own alias');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.list_clients()), 0::bigint, 'unconnected trainer cannot list the card');
select throws_ok(
  format(
    'select public.update_client_trainer_preferences(%L, %L, null, 1)',
    (select id from public.clients where auth_user_id = 'd3000000-0000-4000-8000-000000000003'),
    'Чужой alias'
  ),
  'PT403', 'membership_not_allowed', 'unconnected trainer cannot write preferences'
);
reset role;

select * from finish();
rollback;
