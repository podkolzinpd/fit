begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('66000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'flag-owner@example.test', ''),
  ('66000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'flag-other@example.test', '');

insert into public.user_feature_flags (user_id, monochrome_preview) values
  ('66000000-0000-4000-8000-000000000001', true),
  ('66000000-0000-4000-8000-000000000002', false);

select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'user_feature_flags' and column_name = 'monochrome_preview'),
  'false',
  'monochrome_preview is default-off'
);

select ok(
  has_table_privilege('authenticated', 'public.user_feature_flags', 'SELECT'),
  'authenticated can read the own feature-flag row'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_feature_flags', 'INSERT,UPDATE,DELETE'),
  'authenticated cannot mutate server-managed feature flags'
);
select ok(
  not has_table_privilege('anon', 'public.user_feature_flags', 'SELECT'),
  'anonymous users cannot read feature flags'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '66000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*) from public.user_feature_flags),
  1::bigint,
  'RLS exposes only the authenticated user row'
);
select is(
  (select monochrome_preview from public.user_feature_flags where user_id = '66000000-0000-4000-8000-000000000001'),
  true,
  'the authenticated user reads the enabled flag'
);
select is(
  (select count(*) from public.user_feature_flags where user_id = '66000000-0000-4000-8000-000000000002'),
  0::bigint,
  'another user flag is not visible'
);
select throws_ok(
  $$update public.user_feature_flags set monochrome_preview = false where user_id = '66000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table user_feature_flags',
  'the user cannot disable or enable the server-managed flag'
);
select throws_ok(
  $$insert into public.user_feature_flags (user_id, monochrome_preview) values ('66000000-0000-4000-8000-000000000001', false) on conflict (user_id) do update set monochrome_preview = false$$,
  '42501',
  'permission denied for table user_feature_flags',
  'the user cannot upsert the server-managed flag'
);

select * from finish();
rollback;
