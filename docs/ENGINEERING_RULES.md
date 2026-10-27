# Fit — инженерные ограничения и проверки

Читать разделы по затронутому scope; общий порядок — [FIT_WORKFLOW](FIT_WORKFLOW.md).
Перенесено из AGENTS без отмены архитектурных и safety-ограничений.
Текущая инфраструктура — [playbook](YANDEX_CUTOVER_PLAYBOOK.md).

## Тесты без избыточного дублирования

### Автоматический scope проверок PR

- Пользователь не обязан просить сокращённый прогон в промпте. Перед дорогими
  проверками агент сам получает фактический diff и запускает
  `EVENT_NAME=pull_request node scripts/e2e-scope.mjs <base-sha> <head-sha> --json`.
  Для незакоммиченных изменений учитывайте также весь working-tree diff;
  результат только для старого HEAD не разрешает пропустить новые изменения.
- Источник политики — `scripts/e2e-scope.mjs`, общий для CI и агента. Только
  явно проверенные documentation/API-only/operations-only пути разрешают
  пропустить frontend build/unit, visual/browser/WebView и пересборку native.
  Сами изменённые серверные и служебные контракты всё равно проверяются;
  repository lint/policy, API и PostgreSQL gates не отключаются.
- Documentation-only здесь означает Markdown, не всю папку `docs/`:
  `docs/design` содержит SVG и другие inputs frontend. Изменение таких assets
  или неизвестных data-файлов требует frontend/browser проверки.
- Auth, routing, API-контракты, frontend/native, общие зависимости, CI-конфиги,
  неизвестные пути, diff со frontend/shared и недоступная история требуют полного
  набора. Не добавляйте blanket skip для `scripts/`, workflows или всей infra:
  Nginx, CSP, CORS и конфигурация сборки могут менять frontend/WebView.
- При scope `frontendRequired=false` полный frontend `npm run check` и
  browser/native-прогоны не обязательны. Выполните применимые серверные и
  служебные проверки, общий lint/policy; в handoff укажите scope и основание
  пропуска. В остальных случаях действуют все прежние требования проверки.
- На main/manual CI сохраняется полный набор; итоговые `app`/`e2e` обязательны
  для приёмки (фактическую branch protection проверять отдельно) и проверяют успех классификатора и ожидаемые результаты jobs.
  Ошибка/неизвестный результат — не разрешение пропуска. Scope не выбирается
  меткой PR, текстом промпта или ручным флагом отключения.
- Изменение классификатора/CI само требует полного CI и regression-тестов
  разрешённых пропусков, смешанного/неизвестного scope и отказов gates.

### Выбор уровня и сохранение уникального покрытия

Перед добавлением или расширением тестов агент обязан:

1. Найти существующее покрытие того же контракта. Определить, какую новую
   регрессию обнаружит новый тест. «Для надёжности» без конкретного риска
   не является основанием для дублирования.

2. Выбрать подходящий уровень:

   - вычисления и правила — unit;
   - серверные права, транзакции и идемпотентность — API/БД;
   - пользовательское взаимодействие — component/browser;
   - оформление, темы и размеры — visual.

   Проверки на разных уровнях допустимы, если ловят разные классы ошибок.

3. Не размножать длинные функциональные сценарии декартовым произведением
   тем, размеров, оформления и пользователей. Поведенческий сценарий
   проверяется отдельно; визуальная матрица получает нужное состояние через
   изолированные fixtures и проверяет только соответствующий UI-контракт.

4. Повторять взаимодействие на разных размерах и темах только при конкретном
   риске: клавиатура, touch, scroll, responsive-разметка, focus или другой
   зависимый от окружения механизм. Причину записать рядом с параметризацией.
   Проверки Chromium и WebKit не считаются лишними дублями автоматически.

5. Для параметризованного теста явно проверить число фактически запускаемых
   случаев, включая браузерные проекты. Каждая ось матрицы должна иметь
   самостоятельную причину. Разные пользователи нужны для различий доступа
   или поведения, а не только для смены идентификатора.

6. Скриншот без сравнения с эталоном — диагностический артефакт, а не
   автоматическая проверка визуальной регрессии. Не подменять им assertions.

При изменении тяжёлого набора агент обязан:

- показать добавленные случаи и их уникальное назначение;
- проверить пересечение CI-частей, исключив повторный запуск одного случая
  в одинаковом окружении;
- сравнить доступные тайминги до/после; отсутствие замера указать явно.

При устранении дублей составить соответствие
«старая проверка → сохраняющая её новая проверка».
Не удалять уникальные assertions, состояния, браузеры или проверки доступа
ради скорости. Не ослаблять таймауты, retries и обязательные CI-гейты.
Изменение защищённого Fit Lime inventory требует явного повторного аудита;
его SHA256 нельзя обновлять автоматически.

## Границы архитектуры

- UI, hooks и feature-код зависят только от provider-neutral доменных
  контрактов: они не импортируют SDK, не вызывают Supabase/Yandex API и не
  ветвятся по имени backend. Provider-specific transport остаётся в
  queries/repositories и серверных adapters.
- `src/data/queries` — единственное место с Data API/RPC вызовами.
- `src/data/repositories` преобразует DB rows/errors в доменные DTO; SQL там запрещён.
- Feature использует другую feature только через её публичный `index.ts`.
- Не добавляйте generic repository/service, Redux или глобальный mutable state без ADR.
- Server state хранится в TanStack Query; route state — в URL; form state — в React Hook Form.
- Календарная дата — `LocalDate`, а не результат `toISOString()`.

## База данных

- Источник истины для новых изменений схемы — numbered migrations в
  `services/api/db/migrations` (PostgreSQL 17, `node-pg-migrate`). Новые файлы в
  `supabase/migrations` не добавляйте. Существующую Supabase-цепочку не
  переписывайте: она остаётся для локальных legacy-тестов и rollback-архива.
  Ручной SQL в production Dashboard/WebSQL запрещён.
- `npm run dev` автоматически применяет pending Yandex migrations только к
  локальному Podman PostgreSQL. `npm run local:verify` проверяет локальную
  цепочку и actor/RLS. `.github/workflows/release-cloudru-api-stage.yml`
  после зелёного current-main CI применяет только pending forward migrations
  к Cloud.ru до запуска кандидата API, с отдельной owner-ролью, backup и
  advisory lock. Автоматический выпуск требует CLOUDRU_API_AUTODEPLOY_ENABLED=true;
  иначе он ручной. Build workflow не применяет миграции. Не повторяйте initial
  import на nonempty target; откат API не откатывает уже применённую схему.
- PK бизнес-сущностей: `uuid default gen_random_uuid()`.
- `created_at`: `default now()`; единственный trigger — общий `updated_at` trigger.
- Бизнес- и auth-trigger запрещены. Инициализация пользователя вызывается явно.
- Простая запись выполняется через Yandex API с actor context; aggregate из
  нескольких таблиц — в одной транзакции. SQL не размещайте в UI/repository.
- Команда не принимает `trainer_id` как основание прав: actor определяется
  серверной app-session, ownership проверяется в транзакции; root при update
  блокируется.
- На доступных runtime таблицах обязательны RLS, минимальные grants, `USING`
  и `WITH CHECK`; роль `fit_api` не получает owner/BYPASSRLS.
- FK обязательны для aggregate children; snapshot/optional links могут быть логическими UUID.
- Архивные записи не участвуют в новых операциях, но история остаётся читаемой.

## Production Cloud.ru и замороженный Supabase

- Yandex ID — внешний вход; app-session/API и PostgreSQL работают в Cloud.ru.
  Имена Yandex в коде обозначают сохранённые контракты. Dual-write и fallback на Supabase после ошибки запрещены.
  Новая функция получает один доменный контракт и Yandex implementation;
  создавать ради неё Supabase adapter или парную migration не нужно.
- Supabase ещё задействован в ограниченных legacy-путях (recovery, оставшиеся
  media и локальные тесты). Не удаляйте их или старые таблицы до отдельного
  decommission/rollback-решения. Если изменение пересекается с таким путём,
  зафиксируйте конкретную совместимость и целевой тест; не расширяйте старую
  схему молча и не направляйте новые production-данные обратно в Supabase.
- Для новой Yandex-схемы в том же PR обновите API/DTO, repository/queries,
  actor/RLS/grants и проверку clean migration chain. При необходимости переноса
  **уже существующих** legacy-данных обновите tenant catalog,
  export/import/validation и локальную rehearsal; для Yandex-only данных
  не добавляйте фиктивное mapping в Supabase.
- Когда старый Supabase-based UI/E2E не умеет создать новые данные, добавьте
  локальный Yandex API/PostgreSQL fixture или contract test. Не считайте
  зелёный Supabase-тест доказательством работы новой production-функции.
- Выявленный gap Yandex-сценария нельзя обходить Supabase fallback. Оставьте
  пользовательский вход default-off или явно заблокированным, зафиксируйте
  блокер в `docs/CURRENT_STATE.md`/`FEATURE_PARITY.md` и закройте его до rollout.
- Никогда не подключайте локальные тесты к production-БД. Не выводите PII в
  логи, fixtures и отчёты. Исторический Supabase snapshot сохраняется до
  завершения observation/backup/rollback-гейтов; это не работающая копия новых
  Yandex-записей.

## Push-уведомления пользователям

Production использует PostgreSQL в Cloud.ru; кодовый контракт — `app_private.push_notifications_outbox`
и Yandex dispatcher/sender. Для нового сценария ориентируйтесь на
`services/api/db/migrations/000030_yandex_push_pipeline.sql` и последующие
Yandex migrations, а не на исторические `supabase/migrations` и `pg_cron`.

1. Добавьте actor-scoped producer в новую numbered Yandex migration: уникальный
   `kind`, fan-out на все активные `public.push_subscriptions` получателя,
   `subscription_id` в каждой строке outbox и idempotent dedupe. Уважайте
   `notification_preferences` (отсутствие строки = включено).
2. Если событие периодическое, используйте действующий background scheduler/invoker по
   [операционному контракту](YANDEX_CUTOVER_PLAYBOOK.md); не создавайте Supabase cron или Edge Function.
3. Общий dispatcher/sender меняйте лишь при доказанной необходимости. Пуш
   шифруется и отправляется серверным transport, не в SQL; размещение сверять
   с текущим playbook, не создавать старые Cloud Functions по историческому описанию.
4. Проверьте Yandex producer/dispatcher на идемпотентность, opt-out,
   отсутствие подписок, несколько устройств и отказ отправки. Legacy pgTAP
   остаётся регрессией замороженной Supabase-цепочки, не приёмкой новой функции.

## Качество и безопасность

- Не используйте `select('*')`, `any`, небезопасные casts и проглоченные ошибки.
- Не коммитьте `.env`, DB password, secret/service-role/OAuth secret.
- Локальная разработка использует только локальные Podman Supabase и PostgreSQL
  17; production URL/секреты не копируются в локальные env-файлы. Production
  frontend строится GitHub Actions для Cloud.ru Nginx, не Vercel.
- Для обычного локального запуска используйте `npm run dev`: команда сама
  запускает обе локальные базы. Не подменяйте `.env.development` удалённым проектом.
- Любая mutation должна подтверждать, что изменилась ожидаемая запись.
- Многошаговая запись обязана полностью откатываться при любой ошибке.
- Добавляйте тест на cross-tenant доступ для каждого нового tenant ID.
- Не копируйте legacy `src/db` или старые migrations; переносите только проверенное поведение.
- Старый источник называйте только `V1 baseline` или `legacy trainer-app`; не переносите в Fit V2 названия и URL исходных репозиториев.
- Не отмечайте parity-сценарий как `Implemented` по одному happy path: зафиксируйте проверяемый инвентарь V1 и тест на каждое обязательное поведение.


## Production-пилот для отдельных пользователей — через default-off флаг

- Используйте этот уровень только когда пользователь прямо просит показать
  готовую функцию выбранным production-пользователям. Самостоятельно не
  включайте пилот, не расширяйте allowlist и не меняйте build-time переменные
  production-сборки в GitHub.
- Для каждой функции создавайте независимые build-time переменные:
  `VITE_<FEATURE>_ENABLED=true` и
  `VITE_<FEATURE>_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>`, а также
  отдельную функцию `is<Feature>PilotEnabled(userId: string): boolean` в
  `src/app/feature-flags.ts`.
- Функция включена только при точном значении глобального флага `"true"` и
  наличии текущего `actor.userId` в собственном allowlist функции. При разборе
  списка убирайте пробелы и пустые элементы. Отсутствующий или пустой allowlist
  никому не включает функцию.
- Не переиспользуйте allowlist другой функции и не создавайте generic
  feature-flag framework без отдельной доказанной необходимости. Скрывайте все
  пользовательские входы вне пилота; прямые маршруты защищайте guard и
  безопасным fallback.
- Frontend allowlist не является авторизацией: UUID видны в публичном JS bundle.
  Данные и mutation по-прежнему защищаются RLS и backend ownership-проверками;
  UUID и allowlist не выводятся в UI, логи, аналитику и ошибки.
- Добавьте unit-тесты флага и тесты поведения пользователя внутри и вне пилота,
  включая прямой маршрут. Зафиксируйте переменные и default-off семантику в
  `OPERATIONS.md`, а изменившееся фактическое поведение — в релевантном разделе
  `docs/PRODUCT_WIKI.md`. Production-переменные берутся из конфигурации
  `.github/workflows/prepare-cloudru-frontend.yml`, не из Vercel.
- Изменение build-time переменных или allowlist требует нового deployment.
  Runtime-переключение без deployment в этот механизм не входит.

