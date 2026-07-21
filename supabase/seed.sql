insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, last_sign_in_at, is_super_admin, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000009',
  'authenticated', 'authenticated', 'trainer@fit.local',
  crypt('FitLocal123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Тест","last_name":"Тренер"}', '', '', '', '', now(), false, now(), now()
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id
) values (
  'trainer@fit.local', '90000000-0000-4000-8000-000000000009',
  '{"sub":"90000000-0000-4000-8000-000000000009","email":"trainer@fit.local"}',
  'email', now(), now(), now(), '91000000-0000-4000-8000-000000000019'
) on conflict (provider_id, provider) do nothing;
