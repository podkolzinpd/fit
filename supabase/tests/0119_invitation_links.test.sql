begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('52500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-root@example.test', ''),
  ('52500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-trainer@example.test', ''),
  ('52500000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-client@example.test', ''),
  ('52500000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-second-trainer@example.test', '');

insert into public.profiles (id, account_role, first_name, last_name) values
  ('52500000-0000-4000-8000-000000000001', 'trainer', 'Корневой', 'Тренер'),
  ('52500000-0000-4000-8000-000000000002', 'trainer', 'Анастасия', null),
  ('52500000-0000-4000-8000-000000000003', 'client', 'Антон', null),
  ('52500000-0000-4000-8000-000000000004', 'trainer', 'Второй', 'Тренер');

insert into public.trainers (profile_id) values
  ('52500000-0000-4000-8000-000000000001'),
  ('52500000-0000-4000-8000-000000000002'),
  ('52500000-0000-4000-8000-000000000004');

insert into public.clients (id, trainer_id, auth_user_id, full_name) values (
  '52500000-0000-4000-8000-000000000010',
  '52500000-0000-4000-8000-000000000001',
  '52500000-0000-4000-8000-000000000003',
  'Антон'
);
insert into public.client_trainers (client_id, trainer_id) values (
  '52500000-0000-4000-8000-000000000010',
  '52500000-0000-4000-8000-000000000001'
) on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
create temporary table first_share as
select * from public.create_client_invitation_share(
  '52500000-0000-4000-8000-000000000010',
  'trainer'
);
reset role;
grant select on first_share to anon;

select is(length((select invitation_code from first_share)), 12, 'share keeps the 12-character fallback code');
select matches((select invitation_token from first_share), '^[0-9A-F]{12}\.[0-9a-f]{64}$', 'share returns a high-entropy URL token');
select ok((select expires_at > now() + interval '6 days' from first_share), 'share expires in seven days');
select is((select length(link_token_hash) from public.client_invitations where id = (select invitation_id from first_share)), 64, 'database stores a SHA-256 token hash');
select isnt((select link_token_hash from public.client_invitations where id = (select invitation_id from first_share)), (select invitation_token from first_share), 'database does not store the invitation token');

set local role anon;
select is((select target_role from public.get_client_invitation_preview((select invitation_token from first_share))), 'trainer', 'anonymous preview exposes the intended role');
select is((select inviter_name from public.get_client_invitation_preview((select invitation_token from first_share))), 'Антон', 'anonymous preview exposes the inviter name for the bearer token');
select is((select invitation_status from public.get_client_invitation_preview((select invitation_token from first_share))), 'active', 'new link preview is active');
select is((select count(*) from public.get_client_invitation_preview('missing-token')), 0::bigint, 'unknown token has no preview');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.claim_client_invitation_link((select invitation_token from first_share))$$,
  'PT403', 'invitation_role_mismatch', 'wrong account role cannot claim a link'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000002', true);
select is(
  public.claim_client_invitation_link((select invitation_token from first_share)),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'trainer claims the link'
);
select is(
  (select count(*) from public.client_trainers where client_id = '52500000-0000-4000-8000-000000000010' and trainer_id = '52500000-0000-4000-8000-000000000002'),
  1::bigint,
  'link claim creates one membership'
);
select is(
  public.claim_client_invitation_link((select invitation_token from first_share)),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'repeated link claim is idempotent'
);
reset role;

set local role anon;
select is((select invitation_status from public.get_client_invitation_preview((select invitation_token from first_share))), 'claimed', 'accepted link preview is terminal');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
create temporary table fallback_share as
select * from public.create_client_invitation_share(
  '52500000-0000-4000-8000-000000000010',
  'trainer'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000004', true);
select is(
  public.claim_client_invitation((select invitation_code from fallback_share)),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'manual fallback code still works'
);
select is(
  (select count(*) from public.client_trainers where client_id = '52500000-0000-4000-8000-000000000010' and trainer_id = '52500000-0000-4000-8000-000000000004'),
  1::bigint,
  'manual fallback creates one membership'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
create temporary table revoked_share as
select * from public.create_client_invitation_share(
  '52500000-0000-4000-8000-000000000010',
  'trainer'
);
select public.revoke_client_invitation((select invitation_id from revoked_share));
reset role;
grant select on revoked_share to anon;

set local role anon;
select is((select invitation_status from public.get_client_invitation_preview((select invitation_token from revoked_share))), 'revoked', 'revoked link preview is terminal');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.claim_client_invitation_link((select invitation_token from revoked_share))$$,
  'PT404', 'invitation_invalid', 'revoked link cannot be claimed'
);
reset role;

insert into public.clients (id, trainer_id, full_name) values (
  '52500000-0000-4000-8000-000000000011',
  '52500000-0000-4000-8000-000000000001',
  'Карточка Антона'
);
update public.clients
set trainer_id = '52500000-0000-4000-8000-000000000003'
where id = '52500000-0000-4000-8000-000000000010';

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000001', true);
create temporary table client_share as
select * from public.create_client_invitation_share(
  '52500000-0000-4000-8000-000000000011',
  'client'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
select is(
  public.claim_client_invitation_link((select invitation_token from client_share)),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'client link claim keeps the existing canonical client card'
);
reset role;
select is(
  (select merged_into_client_id from public.clients where id = '52500000-0000-4000-8000-000000000011'),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'client link claim safely merges the trainer-created card'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
select is(
  public.claim_client_invitation_link((select invitation_token from client_share)),
  '52500000-0000-4000-8000-000000000010'::uuid,
  'repeated client link claim is idempotent'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000003', true);
create temporary table expired_share as
select * from public.create_client_invitation_share(
  '52500000-0000-4000-8000-000000000010',
  'trainer'
);
reset role;
update public.client_invitations
set expires_at = now() - interval '1 minute'
where id = (select invitation_id from expired_share);
grant select on expired_share to anon;

set local role anon;
select is((select invitation_status from public.get_client_invitation_preview((select invitation_token from expired_share))), 'expired', 'expired link preview is terminal');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52500000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.claim_client_invitation_link((select invitation_token from expired_share))$$,
  'PT404', 'invitation_invalid', 'expired link cannot be claimed'
);
reset role;

select * from finish();
rollback;
