# Общие helpers без legacy SDK dependencies

Поток: identity-runtime. База: main `4fcbfe67` после PR #1630; rebase на `22e08f4e` (#1635, только правила тестов/snapshot).
Результат: импорт main и Assistant native repositories не загружает legacy
repositories, queries/client или Supabase SDK ради общих helpers.

## Acceptance

1. Округление использует существующий `progress-rules`.
2. Feedback context, trainer discovery parser и summary mappers выделены в
   независимые модули. Legacy и native adapters используют одну реализацию.
3. DTO, validation/errors, published-state и округление сохраняются.
4. Runtime boundary проверяется импортом обоих native repositories с throwing
   mocks legacy modules/client/SDK; existing repository tests остаются зелёными.
5. `npm run check` и exact-head CI зелёные перед передачей PR.

Нет новых API/SQL/schema, flags или UI состояний. Local adapters, SDK package,
server-side media/linking и rollback history сохраняются. Production/deployment
и мобильные releases в scope не входят. PostgreSQL/RLS и local:verify не нужны:
нет изменений данных, запросов или прав. UI/E2E baseline не меняется.

## Проверки

- Targeted main/Assistant/summary/feedback/discovery/progress: 86/86 passed.
- Native runtime import boundary: 2/2 passed.
- Production Rollup graph обоих native repositories: 60 modules, без legacy
  repositories/client/SDK.
- Полный `npm run check`: exit 0, frontend 2670, API 1387 passed + 156
  standard DB skips, infra 275, hosting 158; lint/typecheck/coverage/build passed.
- Production WebKit native/auth/profile/chat/registration: 17/17 passed, light/dark
  390/430/1440 px. Первый запуск 16/17: отсутствовал CI build flag
  `VITE_CLIENT_LIME_ENABLED`; повтор с CI-конфигурацией прошёл без изменения тестов.
- CI: pending. Acceptance 1–4 выполнены; локальная часть 5 выполнена.

Существующие 86 tests проверяют поведение; новые 2 import-boundary cases
ловят отдельную регрессию: transitive SDK import в main и Assistant.
Расчёты/DTO не дублируются новыми тестами; browser specs/CI matrices не меняются.
