-- Up Migration

-- После переезда на Cloud.ru пользователь fit_datalens создаётся в консоли
-- кластера уже после того, как условные гранты 000036/000080 отработали без
-- него. Повторяем тот же узкий контракт чтения: только схема analytics, без
-- таблиц приложения и без записи. Без роли миграция ничего не делает.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    grant usage on schema analytics to fit_datalens;
    grant select on all tables in schema analytics to fit_datalens;
    -- Новые представления analytics, созданные владельцем миграций, читаются сразу.
    alter default privileges in schema analytics grant select on tables to fit_datalens;
  end if;
end;
$$;

-- Down Migration

-- Чтение analytics — контракт 000036/000080, откат 000147 его не отнимает.
-- Снимаем только впервые добавленные права по умолчанию.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    alter default privileges in schema analytics revoke select on tables from fit_datalens;
  end if;
end;
$$;
