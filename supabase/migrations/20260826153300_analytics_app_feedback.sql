-- app_feedback для DataLens: команда до сих пор не имеет способа увидеть
-- фидбэк тренеров/клиентов (RLS на public.app_feedback закрыт полностью,
-- см. 20260823020000_app_feedback.sql). Попытка синхронизации в Yandex
-- Tracker (20260825180000, 20260826140000) уперлась в security-политику
-- Яндекса: робот-аккаунт с внешнего IP (Supabase Cloud) не пускают в
-- Tracker API — легитимного обхода без TVM/Security Design Review нет,
-- решили не делать. analytics.datalens_reader — уже проверенный путь
-- (analytics.trainers_metrics, analytics.client_overview): доступ только
-- у команды через выделенную роль, никакой внешней сети не требуется.

create materialized view analytics.app_feedback as
select
  af.id,
  af.created_at,
  af.account_role,
  af.kind,
  af.message,
  af.screen_path,
  af.app_version,
  af.display_mode,
  p.first_name,
  p.last_name,
  lower(u.email) as email,
  lower(u.email) = any(array['test@test.com', 'knyaz187@mail.ru']) as is_test_account
from public.app_feedback af
join public.profiles p on p.id = af.user_id
join auth.users u on u.id = af.user_id;

grant select on analytics.app_feedback to datalens_reader;

select cron.schedule(
  'refresh-analytics-app-feedback',
  '*/15 * * * *',
  $$refresh materialized view analytics.app_feedback$$
);
