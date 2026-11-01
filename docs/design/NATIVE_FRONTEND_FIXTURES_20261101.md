# Native frontend fixtures — 01.11.2026

Подготовительный этап вывода Supabase. Runtime legacy SDK, composition,
queries/repositories и существующие unit-тесты сохраняются. Production API,
AI prompts и Cloud Functions не меняются. Исходная полная работа сохранена
в `codex/remove-legacy-frontend` (`f406f293`), большой PR1909 закрыт.

## Контракт

- Browser fixture executable слушает loopback и создаёт отдельную локальную
  PostgreSQL17 DB на worker; production DSN запрещены проверкой host/port.
- Применяется native migration chain; реальные actor/RLS adapters работают
  через fit_api. Синтетическая app-session выдаётся fixture endpoint.
- Перед сценарием reset удерживает runtime connection до завершения seed;
  предыдущий browser context закрывается. Worker удаляет только свою DB.
- Playwright `native-e2e` mode выбирает уже существующие native aliases.
  Обычный development/test mode и production runtime не переписываются.
- Явный DataBackendContext экспортируется для трёх изолированных UI harnesses.
- CI browser lanes получают PostgreSQL17 и API build вместо GoTrue/PostgREST;
  frozen legacy SQL checks остаются без изменения.

## Сохранение покрытия

| Прежний setup/проверка | Сохраняющий native сценарий |
| --- | --- |
| GoTrue signup/signin для двух ролей | nativeSignIn/nativeRegister, настоящая opaque app-session |
| Supabase RPC CRUD клиентов/тренировок/прогресса | trainer-flow, clients/workouts/progress через native API/RLS |
| Realtime channel как триггер обновления | client-realtime: существующий native visibility refresh после writer commit |
| Приглашения/смена тренера | auth/invitation-links с настоящими native привязками |
| PostgREST-shaped UI fixtures | typed native training/progress/summary DTO fixtures |
| Legacy email/password snapshots | native Yandex welcome; local password unit coverage остаётся |
| Общие form harnesses со скрытым legacy backend | явный native DataBackendContext, прежние assertions |

Все роли, состояния доступа, Chromium/WebKit и visual viewports сохраняются.
37 PNG старых password-экранов прекращают участвовать в product E2E; unit tests
этих локальных экранов пока не удалены. Linux native PNG получены в pinned CI
runtime; thresholds, retries и таймауты не ослаблены. Идентичность native body-map
проверена с main93784374:0 разных RGB pixels. Две touch-правки native-форм
44px sport options/48px preparation select включены явно вместе с эталонами.
Anonymous AccountDeletion показывает существующее «Сначала войдите» до обращения
к обязательному authenticated backend. Тест online coaching задаёт обе даты
периода, чтобы смена календарного месяца не ломала submit.

## Проверки и ограничения

Проверки самостоятельного первого этапа публикуются в его PR. Полные замеры
скорости старого и нового suite на одинаковом окружении отсутствуют. Матрица
браузеров и CI shards не расширялась; product сценарии не размножены.
Production, настоящий OAuth и физические телефоны не проверяются этим fixture
набором. Отключение удалённых Supabase ресурсов не входит в этот этап.

Самостоятельный первый этап локально прошёл `npm run check`:333 unit files /
2972 tests; coverage81.43/76.35/81.16/86.03 при прежних порогах80/75/80/80;
API1549 passed/238 skipped, lint/typecheck/policies/build passed. E2E TypeScript
и Node syntax check fixture executable прошли. Chromium create-client/workout/
progress и WebKit empty Live обеих ролей/reload:4/4. Native welcome visual390
без update:1/1, обе сохранённые theme preferences. CI публикуется в PR.

## Исправление CI и синхронизация main — 01.11.2026

Repository-quality упал в merge checkout из-за превышения бюджета
CURRENT_STATE после параллельных обновлений main. Подлит main dba30d2b
с новым верхом календаря/четырьмя видами. Повторные сведения об уже слитом
PR1842 сжаты в индексе без изменения статуса, ссылок и ограничений проверки.
Лимиты документа и CI gates сохранены. Точные проверки нового head — в PR1928.

Дополнительные CI failures: desktop completion оставлял native attendance
confirmation открытым; push diagnostics не доходил до browser failure без
VAPID public key. Browser-only env теперь получает существующий synthetic
public key из unit fixtures; trainer сценарии подтверждают проведение через
действующую кнопку. Product runtime, PNG, thresholds, retries и protected
Fit Lime spec не изменены.

Локально на main dba30d2b: полный `npm run check` —336 files/3007 unit tests,
coverage81.52/76.54/81.13/86.11; API1551 passed/242 skipped; build, lint,
typecheck и policies passed. Browser TypeScript/targeted lint passed; Node
workflow/doc policy52/52; desktop completion visual1/1 без update; push
diagnostics с FIT_SCHEDULE_V2_VISUAL=1 —1/1; связанные native trainer finish/
calendar Back/active-input flush Chromium/WebKit —6/6. Финальный CI — в PR1928.
