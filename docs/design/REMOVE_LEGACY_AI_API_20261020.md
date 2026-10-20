# Удаление трёх legacy AI API из основного сервера

База: main75e9dfb9. Поток: assistant-ops. Ветка codex/remove-legacy-ai-api.
Более ранний активный PR: #1736 (nutrition barcode). YAFIT не создавался.

## Подтверждённая постановка

Давай уберём эти три старых AI API и их adapters из основного сервера. Native AI, промпты и Cloud Functions не трогаем. Дождись зелёного CI.

Три API:
- POST /v1/legacy/parse-workout
- POST /v1/legacy/summarize-client-training
- POST /v1/assistant/progress-summary

## Проверка существующего

| Уже работает | Переиспользуем/сохраняем | Действительно меняем | Приёмка |
| --- | --- | --- | --- |
| Native parser/summary/goal suggestions | Все существующие handlers, core и prompts | Только удаление трёх legacy API | Native contracts / route parity |
| Cloud Functions | Их adapters/modules/entry points/deploy configs | Только wiring adapters в server.ts | Existing function tests / unchanged source |
| Legacy chat media | Bridge, routes и x-supabase-authorization | Ничего | Existing media API tests |

## Неизменяемая приёмка

1. Три legacy HTTP API удалены; возвращают404 независимо от старого/native token.
2. Основной server не импортирует legacy summary handler и не создаёт Supabase
   parser/summary adapters. Forwarder, options и его type удалены.
3. Native AI, промпты, Cloud Functions и их deploy configs не меняются.
4. Полные локальные проверки и CI зелёные до передачи PR.

## Покрытие и доказательства

- Baseline новый retirement test:3 failed (старые handlers возвращали401).
- После удаления targeted8files/299tests и API typecheck passed: API contracts,
  native AI import guard, parser/summary и Cloud Function wrapper regressions.
- Новые3 cases (по одному URL), внутри каждого none/Supabase/native credentials
  =9 HTTP assertions. Проверяется404 и отсутствие вызовов native parser/summary.
  Роли/темы/размеры не размножаются: отсутствующий route не зависит от роли.
- Удалены только8 tests старых parser/summary/wrapper handlers. Их новая
  проверка — retirement404; остальные native/media assertions сохранены.
- AST parity:169 остальных API route declarations совпадают с baseline.
- Source diff ограничен app.ts/app.test.ts/server.ts и документацией. Native
  modules, prompts, shared parser/legacy adapters, Cloud Functions и workflows
  не изменены. Adapters остаются необходимы сохранённым Cloud Functions.
- Full check exit0: frontend2785/API1451+184conditionalDBskip/infra332/
  calendar12/hosting173/lint/typecheck/API build/frontend build/startup passed.
- Compiled server static imports:114 local modules; legacy summary/Assistant/
  Cloud Function entry points не достижимы из server.js.
- Полный CI ожидается в PR. UI/БД/rollout/secrets/ресурсы/production не менялись.
  Старые Supabase-клиенты потеряют эти3 API; native backend не переключается.
  Локальный explicit legacy API override также получит404; прямые Cloud Functions
  и legacy tooling не удаляются. Полных timings before/after нет.
