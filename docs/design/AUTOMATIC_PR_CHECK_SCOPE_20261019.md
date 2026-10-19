# Автоматический scope frontend/browser проверок PR — 19.10.2026

Владелец: «а можно как-то отключить проверки фронта и вебвью для пров,
которые их не затрагивают? я иногда забываю это прописать в промпте,
и он гонит все 34 теста вместо 14». Подтверждение: «Делай».

## Утверждённый результат — неизменяемая приёмка

1. Документация и проверенные служебные изменения → без frontend/browser/WebView.
2. Backend → API/БД и необходимые контрактные проверки.
3. Frontend/native → соответствующие UI/browser/WebView-проверки.
4. Общие зависимости, auth, маршрутизация или неизвестный scope → полный набор.
5. CI должен показывать причину выбора: какой файл потребовал тяжёлые проверки.
   Обязательные итоговые проверки сохраняются и контролируют корректность пропуска.
6. В `AGENTS.md` закрепить: агент сам определяет scope; пользователь не обязан
   просить сокращённый прогон.

34/14 — наблюдаемые CI jobs, не обещание неизменного количества unit/E2E cases.
API/БД, уникальные browser assertions, браузеры, retries и timeouts не сокращаются.

## Проверка существующего до реализации

Исходники main `327d9b8848989ac78ad0721690f6bc04f3e6eaa5`.
Работающая UI-сборка, роль, тема и флаги неприменимы: CI-only изменение.
Production/UI/native не открывались и не изменялись.

| Категория | Доказательство и граница |
| --- | --- |
| Уже работает | `scripts/e2e-scope.mjs`, gate `e2e`, path-filter Android debug; исходные scope tests 3/3. |
| Переиспользуем | Публичные `requiresE2E`/`changedPaths`, существующие API/PostgreSQL jobs и Fit Lime selectors. |
| Действительно меняем | Безусловный frontend build/coverage/Terraform и узкую непрозрачную E2E allowlist. Служебный тест `cloudru-stabilization-workflows.test.mjs` давал browser=true. |
| Не проверено | Новый scope в опубликованном PR CI до push; реальное skip-наблюдение другого PR после merge. |

Открытые PR на старте: #1719 SpeechKit journal (операционный workflow + policy
test), #1720 disk expansion (в том числе отдельная scope allowlist правка).
Их изменения не переписываются; перед merge требуется обновление main/CI.

## Контракт реализации

- Один `selectCheckScope` для frontend и browser, без меток/ручного skip.
  Только PR с полным проверенным diff может пропустить frontend; main/manual
  и неизвестное событие сохраняют полную приёмку.
- Whitelist относится к точным проверенным operations путям, документации,
  ограниченным API-maintenance модулям и API-only тестам. Auth/routing/contract
  границы проверяются раньше whitelist. Неизвестный API runtime/SQL/dependency
  path требует full: классификатор не обещает автоматически доказать совместимость DTO.
- Не расширяется skip на всю infra/scripts/workflows. Nginx/CSP/CORS/build и
  новый runtime остаются full. Политика/CI themselves тоже full.
- Git diff NUL-separated с `--no-renames`: удалённый frontend нельзя скрыть
  переименованием в docs; недоступная история, пустота и некорректные пути full.
- `repository-quality` всегда выполняет lint, db-types, infra/hosting/font policy;
  API/PostgreSQL прежние. Frontend quality/build, coverage и Terraform используют
  scope. Итоговый `app` проверяет scope, repository-quality и ожидаемые результаты.
  `e2e` аналогично отвергает malformed flags/failed/cancelled/неожиданный skip.
- Actions Summary и log содержат решение по каждому пути. CLI `--json` тот же
  контракт для агента; незакоммиченный diff нельзя забывать при локальном выборе.
- Android workflow уже имеет native/frontend paths; его release/auth-smoke не
  меняются. Не создаётся production rollout, UI-правок, DB migration или preview.
- Новый unit coverage проверяет уникальные причины: safe/mixed/unknown/auth,
  event boundary, Git renames/divergence, безопасный summary и действительные
  shell gates. Длинные browser matrix не расширяются. Inventory digest не меняется.

## Проверки

На base327d9b88: targeted scope/CI/compatibility69/69, включая реальные Git и
shell gates. Полный `npm run check` exit0: frontend2769/API1443+164 штатных
localDBskip, SpeechKit7, infra327, hosting169, media2/calendar12, lint/typecheck/build.
Mjs policy/test дополнительно прошли ESLint recommended: штатный lint исключает
scripts. CI test-файл использует прежний regex-style и проверяется Node/tests;
дополнительный полный recommended lint выявляет существующие no-regex-spaces,
не являющиеся обязательным lint-gate проекта. YAML parsed Ruby/Psych, все16
job declarations/dependencies валидны. Protected Lime sources/policy/runner и
Android workflow byte-identical main; inventory digest не менялся.

После main2d12d7f5 (#1720) объединены конфликты только scope policy/tests;
оба новых safe-пути сохранены, policy/tests byte-identical нашему проверенному
f527d02c после удаления merge-дубля одного fixture path. Входящий disk workflow
и его tests сохранены без изменения. Свежий combined target90/90 passed,
YAML/dependencies и diff-check passed. SQL/runtime/dependencies main не менялись,
повтор всей frontend/API сборки не требуется; полный CI нового head обязателен.

CI39314938991/head88a1476a: 31 jobs success/skipped, WebKit visual1/4 и
итоговый e2e failed. Неизменённый `Figma workout Coach reference full editor1440`
(`trainer-schedule-v2.visual.spec.ts:365`) трижды исчерпал общий30s на поздних
click/reload (строки520/539), а не на data/layout matcher. Локальная точная
диагностика repeat-each3/workers1/retries0 прошла3/3:7,7/6,8/6,8s, всего24s.
Точная причина замедления CI не установлена; нагрузка — гипотеза. Spec,
assertions, budgets и retries не менялись; красный CI не считается приёмкой.
Дальнейшая проверка нового head после включения main384ed74b — в PR1722.

Изолированный Git fixture сначала ошибался из-за отсутствующей папки после
checkout и попадания output/summary в fixture commit; изоляция исправлена,
повтор69/69 passed, продуктовые assertions не менялись. Эти промежуточные ошибки
не выдаются за ошибки продукта или успешную первую проверку.

Замер CI wall time до/после для одинакового служебного PR пока отсутствует:
новая политика должна сначала пройти полный CI. Проверяемое сокращение —
отсутствие frontend build/coverage/Terraform и browser матриц для safe PR,
не обещание точного числа jobs или минут. Финальная CI/merge фактура — в связанном PR.
Исходная диагностика: main классифицирует служебный policy-test и maintenance
workflow как browser=true, frontend jobs без scope. Новый вариант должен давать
false только для явно перечисленных безопасных PR и true для собственного CI diff.
