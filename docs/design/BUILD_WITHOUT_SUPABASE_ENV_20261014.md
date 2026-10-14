# Production сборки без Supabase env — 14.10.2026

Решение владельца: «давай теперь уберем VITE_SUPABASE_ из сборок».
Поток identity-runtime; исходная база main3464f7c3, ветка обновлена от maind10c2d12 (recovery PR1628 уже merged).
Одна ветка/PR: codex/build-without-supabase-env.

1. Удалить Supabase public env и обязательные проверки из Cloud.ru frontend,
   Android production-auth build, сохранённых Yandex frontend build workflows и
   offline CI build. iOS guard проверяет native public API/OAuth/switches вместо
   Supabase settings. Не менять rollout, API origins или production feature flags.
2. Сделать frontend legacy SDK локальным и ленивым: import/два storage bucket API
   не создают SDK. Production legacy operation запрещена даже со stale env;
   без env нет dummy credentials. Локальные Supabase fixtures сохраняются.
3. Native AuthProvider не подписывается на legacy Auth и не вызывает legacy
   signOut/getSession при startup/refresh/logout. Native session, роль, expiry,
   retry, registration, legal/invitations и текущий data contract сохраняются.
4. Проверить production bundle без Supabase variables через локальный WebKit:
   существующие auth/role/registration и nutrition scenarios. CI auth lane тоже
   строит production bundle и использует preview, без legacy env/services;
   legacy Chromium/WebKit lanes и SQL baseline не сокращаются.
5. Обновить docs, выполнить targeted frontend/workflow checks, npm run check,
   diff review и полный CI; передать зелёный PR. Production rollout/secret removal
   и полный SDK/server/media decommission не входят в этот этап.

Визуальный/поведенческий референс — текущие /auth, session, registration и
client/trainer screens. Сохраняются FitLogo, Field, StatePanel, auth layouts,
Lime tokens и первичные «Продолжить с Yandex ID» / «Создать аккаунт» по состоянию.
CSS/навигация/LLM/SpeechKit/DB migrations не меняются. Нет новых data states:
loading/anonymous/restore/error/retry/logout проходят существующий native flow.

## Приёмка

| Пункт | Доказательство | Статус |
| --- | --- | --- |
| 1 | Workflow absence contracts + native iOS settings tests | Targeted passed |
| 2 | Import/SDK-singleton/storage/binding/production stale-env guards | Targeted passed |
| 3 | Native auth actions без legacy calls, legacy local contracts | Targeted passed |
| 4 | Production bundle no env, auth WebKit17/17; extended auth/nutrition | Production WebKit26/26 passed |
| 5 | Документация, полный check; remote CI в PR | Локально passed |

Targeted frontend44/44 и workflow115/115 passed; typecheck passed. Первый
production build без обеих Supabase variables прошёл, startup ordering verified,
fonts2/2 SHA256/WOFF2. Auth WebKit17/17 passed (light/dark390/430/1440 и guards).
JS artifacts не содержат VITE_SUPABASE_, local placeholder key или54321.
DB/schema/API не меняются; local:verify/clean-chain здесь не запускаются.
Реальный OAuth, remote deployment и native production install не выполнялись.

Production auth+nutrition WebKit26/26 passed. Первый расширенный прогон23/26
остановился из-за неучтённого Assistant coachmark: production defaults включают
Assistant, а прежний dev fixture его не видел. В существующий список просмотренных
navigation hints добавлены два уже применяемых Lime fixture ids; product flags,
UI, assertions и timeouts не менялись. Canary production build с синтетическим
legacy URL/key прошёл:12 JS artifacts (включая startup/service worker) без canary values/VITE_SUPABASE_/local placeholders.
Полный npm run check exit0: frontend2664/API1387+156DBskip/infra271/hosting158/build.
Первый check остановился на лишнем async синхронного auth test; async удалён,
full check повторён успешно. Production26 и typecheck проверяют фактический bundle.

После rebase maind10c2d12: infra:policy275/275 иhosting158/158 passed.
Изменения main — runner retention workflow/tests/docs/package script; frontend
source и auth bundle прежние. Полный CI подтверждается в связанном PR.

Финальный review: Vite build --mode development имеет PROD=true. Release guard
по PROD заменён явной allowlist development/test; другие modes fail-closed.
URL проверяется как локальный даже при DEV=false. Добавлены четыре контракта
local native/remote deny/unknown mode; локальный parser выбирает Edge Function
для explicit development. Release production build по-прежнему без env/SDK.

Финальный mode fix: targeted47/47 иfullcheck2668frontend/1387API+156DBskip/
infra275/hosting158/build exit0. Реальные Vite build production иdevelopment
прошли:12 release JS безsynthetic legacy values; development native artifact
сохраняет явно заданную local config.
