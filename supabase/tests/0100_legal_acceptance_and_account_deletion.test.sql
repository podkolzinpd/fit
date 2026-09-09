begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legal-one@example.test', ''),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legal-two@example.test', '');

select has_table('public', 'user_legal_acceptances', 'legal acceptance table exists');
select has_table('public', 'account_deletion_requests', 'account deletion request table exists');
select has_function('public', 'request_account_deletion', array[]::text[], 'account deletion request RPC exists');
select has_function('public', 'cancel_account_deletion_request', array[]::text[], 'account deletion cancellation RPC exists');
select is(has_table_privilege('anon', 'public.user_legal_acceptances', 'SELECT'), false, 'anonymous users cannot read acceptances');
select is(has_table_privilege('authenticated', 'public.account_deletion_requests', 'INSERT'), false, 'users cannot create deletion requests directly');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

insert into public.user_legal_acceptances (user_id, terms_version, privacy_version, source)
values ('a1000000-0000-4000-8000-000000000001', '2026-09-09', '2026-09-09', 'registration');

select is((select count(*) from public.user_legal_acceptances), 1::bigint, 'user reads own acceptance');
select throws_ok(
  $$insert into public.user_legal_acceptances (user_id, terms_version, privacy_version, source) values ('a1000000-0000-4000-8000-000000000002', '2026-09-09', '2026-09-09', 'existing_user')$$,
  '42501', null, 'user cannot accept for another account'
);

create temp table first_request as select public.request_account_deletion() as id;
select isnt((select id from first_request), null::uuid, 'user can request account deletion');
select is((select status from public.account_deletion_requests where id = (select id from first_request)), 'requested', 'new request is pending');

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.user_legal_acceptances), 0::bigint, 'another user cannot read acceptance');
select is((select count(*) from public.account_deletion_requests), 0::bigint, 'another user cannot read deletion request');

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select is(public.cancel_account_deletion_request(), true, 'owner can cancel pending request');
select is((select status from public.account_deletion_requests where id = (select id from first_request)), 'cancelled', 'cancelled request is retained for audit');
select is(public.cancel_account_deletion_request(), false, 'cancelling twice is harmless');

reset role;
set local role anon;
select throws_ok($$select public.request_account_deletion()$$, '42501', null, 'anonymous request is rejected before execution');

reset role;
select * from finish();
rollback;
