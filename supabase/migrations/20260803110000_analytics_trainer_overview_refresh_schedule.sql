-- analytics.trainer_overview: расписание refresh меняется с раза в сутки
-- (02:10 UTC) на 5 раз в день — 05:00/10:00/15:00/20:00/00:00 по МСК.
--
-- pg_cron работает в UTC (cron.timezone не переопределён), МСК = UTC+3
-- круглый год (без перехода на летнее время):
--   05:00 МСК -> 02:00 UTC
--   10:00 МСК -> 07:00 UTC
--   15:00 МСК -> 12:00 UTC
--   20:00 МСК -> 17:00 UTC
--   00:00 МСК -> 21:00 UTC (предыдущего календарного дня по UTC)
--
-- cron.schedule с уже существующим job name обновляет расписание той же
-- задачи (upsert по jobname), не создаёт дубликат — саму матвью трогать не
-- нужно, drop/create не требуется.

select cron.schedule(
  'refresh-analytics-trainer-overview',
  '0 2,7,12,17,21 * * *',
  $$refresh materialized view analytics.trainer_overview$$
);
