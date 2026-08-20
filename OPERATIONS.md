# Эксплуатация Fit V2

## Локальная разработка

Обычный запуск выполняется командой `npm run dev`: она запускает локальный Supabase и только затем frontend. Безопасные локальные URL и publishable key хранятся в committed-файле `.env.development`.

Development-сборка программно отклоняет любой Supabase URL, кроме `localhost` и `127.0.0.1`. Production URL и publishable key задаются только в Vercel. Их запрещено копировать в `.env.local`, `.env.development` или другие локальные env-файлы. Для сброса локальных данных используйте `npm run db:reset`.

## GitHub Secrets

В repository secrets должны быть настроены:

- `SUPABASE_ACCESS_TOKEN` — personal access token Supabase CLI;
- `SUPABASE_DB_PASSWORD` — пароль новой БД;
- `SUPABASE_PROJECT_ID` — `xwfuzfkuhblswpdludbc`.

После merge миграции применяет `.github/workflows/deploy-database.yml`. Запуск SQL через Dashboard запрещён. Publishable key может находиться в frontend deployment environment; service role и DB password — никогда.

Изменения `summarize-client-training` после merge выкатывает отдельный
`.github/workflows/deploy-summary-function.yml`. Он публикует только эту Edge
Function через Supabase API, не использует Docker и получает project id и access
token только из GitHub Secrets. `verify_jwt=false` сохраняется намеренно:
функция самостоятельно проверяет пользователя и его роль по bearer token.

Workflow не использует GitHub Environment: для приватного репозитория на GitHub Free эта возможность недоступна. Переход на environment secrets выполняется отдельно после подключения подходящего тарифа.

## Frontend hosting

Production и PR previews разворачиваются в Vercel через GitHub integration:

- repository: `podkolzinpd/fit`;
- framework preset: Vite;
- production branch: `main`;
- build command: `npm run build`;
- output directory: `dist`.

В Vercel для Production и Preview задаются только публичные frontend-переменные:

```text
VITE_SUPABASE_URL=https://xwfuzfkuhblswpdludbc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, service-role key и OAuth Client Secret в Vercel не добавляются. После первого production deploy его канонический URL фиксируется в Supabase Auth URL Configuration:

Закрытый пилот Apple Health управляется build-time переменными Vercel:

```text
VITE_WEARABLES_ENABLED=true
VITE_WEARABLES_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

По умолчанию и при пустом allowlist интеграция скрыта. Изменение списка требует
нового deployment. UUID попадают во frontend bundle, поэтому этот механизм
служит только для rollout интерфейса и не является границей авторизации.

Закрытый пилот верхней навигации тренера («Ассистент», YAFIT-317) управляется
build-time переменными Vercel:

```text
VITE_ASSISTANT_NAV_ENABLED=true
VITE_ASSISTANT_NAV_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Механизм default-off: по умолчанию, при пустом allowlist или любом значении
флага кроме точного `true` навигация тренера остаётся прежней (нижний таб-бар,
экран «Сегодня»). Изменение списка требует нового deployment. UUID попадают во
frontend bundle, поэтому этот механизм служит только для rollout интерфейса и
не является границей авторизации: данные и мутации защищаются существующими
RLS/ownership-проверками.

Закрытый пилот тёмной палитры из Figma-макета «Фит» управляется build-time
переменными Vercel:

```text
VITE_DARK_THEME_PILOT_ENABLED=true
VITE_DARK_THEME_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Механизм default-off и повторяет форму allowlist Apple Health: по умолчанию, при
пустом списке или любом значении флага кроме точного `true` тёмная тема остаётся
прежней. Список открыт и тренерским, и клиентским аккаунтам. Переменные только
открывают доступ к новой палитре: она применяется, когда участник пилота сам
включил тёмную тему в профиле, и этот выбор хранится в `localStorage` устройства,
то есть включается на каждом устройстве отдельно. Изменение списка требует нового
deployment.

Эта же пара переменных раскатывает обновлённое поле поиска в списке клиентов
(полная ширина, иконка лупы, кнопка сброса, показ от шести клиентов). В отличие
от палитры оно не зависит от выбранной темы и включается сразу для аккаунтов из
списка. Отдельного флага сознательно не заводили: аудитория закрытого пилота
одна и та же, а новая переменная потребовала бы ручной настройки в Vercel. UUID попадают во frontend bundle, поэтому этот механизм служит только
для rollout оформления и не является границей авторизации: данные и мутации
защищаются существующими RLS/ownership-проверками.

- Site URL: `https://<production-domain>`;
- Redirect URLs: `https://<production-domain>/auth/callback` и `https://<production-domain>/auth/reset`;
- локальные `http://localhost:5173/auth/callback` и `http://localhost:5173/auth/reset` остаются разрешёнными для разработки.

OAuth на произвольных preview-доменах по умолчанию не разрешается. Если позднее подключается custom domain, Supabase и Google OAuth настраиваются на него до переключения трафика.

## MVP email registration

До подключения собственного домена и production SMTP подтверждение email при регистрации отключено. В Supabase Dashboard в `Authentication → Sign In / Providers → Email` настройка **Confirm email** должна быть выключена. Локальный Supabase повторяет это поведение через `auth.email.enable_confirmations = false`.

Регистрация собирает только имя, email и пароль; фамилия не запрашивается и не передаётся в Auth metadata. Поле `profiles.last_name` остаётся nullable для обратной совместимости и будущего добровольного заполнения профиля.

Password reset остаётся доступным технически, но не считается production-ready до подключения собственного домена и SMTP. После подключения SMTP решение об обязательном email confirmation оформляется отдельным изменением продукта и тестов.

## Приглашения клиентов

Клиентский аккаунт создаёт Edge Function `invite-client`; service role key
никогда не передаётся frontend. В hosted environment задаётся:

```text
CLIENT_INVITE_REDIRECT_URL=https://<production-domain>/auth/callback
```

До production-релиза обязательны собственный SMTP, разрешённый redirect URL и
smoke-тест письма. Уже зарегистрированный email функция намеренно не привязывает:
для такого сценария нужен отдельный flow подтверждения владения аккаунтом.

## YandexGPT

`summarize-client-training` использует отдельный service account с ролью
`ai.languageModels.user` и API-ключом scope
`yc.ai.languageModels.execute`. В Supabase Edge Function secrets задаются:

```text
YANDEX_CLOUD_API_KEY=<server-only key>
YANDEX_CLOUD_FOLDER_ID=<folder id>
YANDEX_CLOUD_MODEL_ID=yandexgpt
```

Ключ нельзя добавлять в Vite/Vercel frontend variables. Функция отправляет в
Yandex Cloud только агрегаты завершённых тренировок и сохраняет usage модели
для контроля стоимости.

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
