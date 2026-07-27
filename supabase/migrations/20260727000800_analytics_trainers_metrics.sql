-- Бизнес-метрики для DataLens: отдельная схема analytics, не входящая в
-- api.schemas (config.toml) — недоступна через Data API ни anon, ни
-- authenticated, ни service_role. Единственный путь — прямое подключение
-- Postgres выделенной ролью datalens_reader (SELECT только на analytics.*).
-- Первая метрика для проверки пайплайна: общее число тренеров.
--
-- Пароль роли НЕ задаётся в миграции (секрет) — устанавливается отдельно
-- на проде командой `alter role datalens_reader with password '...';`
-- вне git, самим оператором. Обновление — раз в сутки через pg_cron, а не
-- на каждый запрос дашборда, чтобы не создавать нагрузку на прод.

create schema if not exists analytics;

create extension if not exists pg_cron with schema extensions;

create materialized view analytics.trainers_metrics as
select count(*)::bigint as trainers_total, now() as computed_at
from public.trainers;

do $$
begin
  create role datalens_reader login;
exception
  when duplicate_object then null;
end
$$;

grant usage on schema analytics to datalens_reader;
grant select on analytics.trainers_metrics to datalens_reader;

select cron.schedule(
  'refresh-analytics-trainers-metrics',
  '0 2 * * *',
  $$refresh materialized view analytics.trainers_metrics$$
);
