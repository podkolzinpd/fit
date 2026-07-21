# Эксплуатация Fit V2

## GitHub Secrets

В environment `production` должны быть настроены:

- `SUPABASE_ACCESS_TOKEN` — personal access token Supabase CLI;
- `SUPABASE_DB_PASSWORD` — пароль новой БД;
- `SUPABASE_PROJECT_ID` — `xwfuzfkuhblswpdludbc`.

После merge миграции применяет `.github/workflows/deploy-database.yml`. Запуск SQL через Dashboard запрещён. Publishable key может находиться в frontend deployment environment; service role и DB password — никогда.

## Google OAuth

Создайте отдельный Google Web OAuth client для V2 и добавьте redirect URI:

```text
https://xwfuzfkuhblswpdludbc.supabase.co/auth/v1/callback
http://127.0.0.1:54321/auth/v1/callback
```

В Supabase Auth включите Google provider и сохраните Client ID/Secret там. Secret не передаётся frontend. Для локального Supabase используйте переменные `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` и `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, затем включите provider в локальном `config.toml` только в личной конфигурации.

Frontend redirect для разработки: `http://localhost:5173/auth/callback`. Production frontend URL добавляется в allow-list Supabase после выбора hosting.

## Release gates

- GitHub branch protection для `main`: PR only, обязательные `app`, `database`, `e2e`.
- Зелёный CI и воспроизводимый `supabase db reset`.
- Закрытые пункты `FEATURE_PARITY.md` и visual comparison с baseline V1.
- Реальный Google OAuth smoke на production-like URL.
- Только после этого команда переходит в V2; архивирование V1 выполняется отдельным подтверждённым действием.
