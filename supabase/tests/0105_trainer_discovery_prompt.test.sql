begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prompt-client@example.test', ''),
  ('a5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prompt-other@example.test', ''),
  ('a5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prompt-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('a5000000-0000-4000-8000-000000000001', 'client'),
  ('a5000000-0000-4000-8000-000000000002', 'client'),
  ('a5000000-0000-4000-8000-000000000003', 'trainer');

select has_table('public', 'trainer_discovery_prompt_preferences', 'prompt preference table exists');
select has_function('public', 'get_trainer_discovery_prompt', array[]::text[], 'prompt read RPC exists');
select has_function('public', 'set_trainer_discovery_prompt', array['text'], 'prompt mutation RPC exists');
select ok(has_table_privilege('authenticated', 'public.trainer_discovery_prompt_preferences', 'SELECT') = false,
  'raw prompt preferences are not exposed');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000001', true);
select is(public.get_trainer_discovery_prompt()->>'state', 'visible', 'missing preference defaults to visible');
select is(public.set_trainer_discovery_prompt('snooze')->>'state', 'snoozed', 'client snoozes the prompt');
select ok((public.get_trainer_discovery_prompt()->>'remindAt')::timestamptz > now() + interval '29 days',
  'server sets reminder later than 29 days');
select ok((public.get_trainer_discovery_prompt()->>'remindAt')::timestamptz < now() + interval '31 days',
  'server sets reminder earlier than 31 days');

reset role;
update public.trainer_discovery_prompt_preferences
set remind_at = now() - interval '1 second'
where user_id = 'a5000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000001', true);
select is(public.get_trainer_discovery_prompt()->>'state', 'visible', 'expired reminder becomes visible');
select is(public.set_trainer_discovery_prompt('dismiss')->>'state', 'dismissed', 'client dismisses the prompt permanently');
select is(public.set_trainer_discovery_prompt('snooze')->>'state', 'dismissed', 'snooze cannot revive a dismissed prompt');
select throws_like(
  $$select public.set_trainer_discovery_prompt('tomorrow')$$,
  '%invalid_trainer_discovery_prompt_action%',
  'unknown prompt action is rejected'
);

select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000002', true);
select is(public.get_trainer_discovery_prompt()->>'state', 'visible', 'preferences are isolated between clients');

select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000003', true);
select throws_like(
  $$select public.get_trainer_discovery_prompt()$$,
  '%client_role_required%',
  'trainer cannot read a client prompt preference'
);

reset role;
set local role anon;
select throws_like(
  $$select public.get_trainer_discovery_prompt()$$,
  '%permission denied for function get_trainer_discovery_prompt%',
  'anonymous actor cannot read prompt preference'
);

reset role;
select * from finish();
rollback;
