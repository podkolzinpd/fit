# Временное ускорение Fit Lime CI — 12.10.2026

## Подтверждённое решение

Владелец подтвердил отдельный PR командой «сделай» после предложения:

1. Сразу поправить scope: для чисто инфраструктурных PR не запускать браузерные
   E2E. Изменение одного Cloud.ru workflow запускало весь набор.
2. Временно облегчить PR-проверки: критические сценарии + затронутый раздел
   в обоих браузерах. Полные 616×2 оставить обязательными перед production.
3. Для общих CSS, навигации и auth сохранить полный прогон: там изменения
   могут задеть всё приложение.

Это осознанное сокращение регрессии отдельного PR, а не удаление тестов.
Клиентские экраны, API, схема, авторизация, секреты и rollout не меняются.

## Исполняемые границы

- Временное окно: 12–25 октября включительно; с 26.10.2026 00:00 МСК
  селектор автоматически возвращает полный набор. Не нужен ручной rollback.
- Режим `scoped` доступен только для `pull_request`. На `push`/ручном CI
  Fit Lime job всегда использует `full`; существующий non-browser gate
  по-прежнему может пропускать jobs, когда browser runtime не менялся.
- Frontend deployment принимает только успешный CI текущего `main` с event
  `push`/`workflow_dispatch`, не CI PR. Эта защита сохраняется без изменений.
- Единственное постоянное расширение безопасного non-browser scope:
  `.github/workflows/deploy-cloudru-stage.yml` (VM/API bootstrap, без frontend).
  Другие Cloud.ru workflows не исключаются по широкому wildcard.
- Сокращаются только два Fit Lime jobs. Общие Chromium, iPhone WebKit,
  visual/mobile, Yandex auth, API/actor-RLS, lint/typecheck/coverage прежние.
- Узкий allowlist файлов: finance, templates, clients, goals, progress,
  profile, chat, ExercisesPage и WorkoutActualDuration. Shared transport,
  общий workout/editor/Live, index.ts, неизвестные/new файлы, package/CI/E2E
  и CSS всегда требуют полный набор. См. точные regex в selector.
- Смешанный frontend/API diff требует полный набор. Несколько известных
  разделов объединяются, а не заменяют друг друга.
- Выбор основан на явных Playwright tags, не на тексте названия теста.
  `@lime-critical` покрывает trainer/client lifecycle, narrow routes,
  scope/rollback, темы/аккаунты, отказ/retry, потерянный ответ и ключевые формы.
  Feature tags добавляют все размеченные сценарии соответствующего раздела.
- SHA256 всего проверенного spec, включая fixtures, фиксирует границу аудита.
  Любая следующая правка spec выключает сокращение до нового осознанного аудита;
  не обновлять digest автоматически ради зелёного CI.
- Перед сокращённым запуском runner собирает реальный Playwright inventory
  и требует наличие critical и каждого feature tag. Пустой/неизвестный selector,
  отсутствующий tag или ошибка collection не дают зелёный job.
- Assertions, набор полных cases, браузеры, workers=2, timeout/retries прежние.

## Acceptance / проверка

1. Cloud.ru-only PR пропускает browser jobs; Cloud.ru + UI — не пропускает.
2. Известная feature выбирает critical + свой tag в Chromium и WebKit.
3. Смешанные features объединяются, неизвестные/shared/API изменения дают full.
4. До deadline scoped доступен, ровно на deadline/после/при плохом clock — full.
5. Main/manual не сокращаются; production gate не принимает PR CI.
6. Изменение inventory, отсутствующие cases/tags и неверный selector fail closed.
7. Сборка полного inventory сохраняет 616 cases на браузер; все assertions прежние.
8. Запущены целевые policy/collection/browser проверки и полный `npm run check`.
   Конкретные результаты записываются в rolling snapshot и описании PR.

Baseline CI38275172698: Chromium616 passed/24,8min; WebKit612 passed,
3 engine-specific skips/1 flaky/32,2min. Эти прежние skips/flaky не удаляются
и не выдаются за исправленные этим PR.

## Повторный аудит разделения — 14.10.2026

По новому прямому решению владельца acceptance разделяется на behavior94 и
visual/mixed522; общий inventory616/engine и все235 callback bodies прежние.
Новый явный digest защищает оба spec и общую fixture. В full визуальная часть
имеет4 shards, в scoped — один; behavior отдельно в обоих режимах. Окно,
allowlist, tags, assertions и release gates не расширяются и не ослабляются.
Доказательства: `FIT_LIME_ACCEPTANCE_SPLIT_20261014.md`.
