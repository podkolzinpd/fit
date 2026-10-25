# Полный остаточный инвентарь Supabase — 23.10.2026

Статус: аудит исходников и GitHub metadata завершён; remote runtime/data audit **НЕ ВЫПОЛНЕН**. Это реестр для конечного [плана отключения](SUPABASE_DECOMMISSION_PLAN_20261023.md), не разрешение удалить данные или облачный проект.

## Зафиксированный baseline и метод

- `main` / commit `831fde5465f459a3f47a69e3db975b58ef4fd1cd`, 3805 tracked-файлов. Новые документы этого аудита не входят в baseline и не увеличивают его счётчик.
- Проверены все tracked text-файлы на `supabase` без учёта регистра, весь каталог `supabase/`, generated DB types, импорты SDK, протокольные маркеры `/auth/v1`, `/rest/v1`, `/storage/v1`, локальный порт и local composition aliases. Secret values и `.env.local` не читались.
- Дополнительно построен консервативный reverse graph относительных статических/dynamic literal imports, включая type-only; `.js` разрешается в TS. Семь корней: query client/environment, generated types, server bridge, два media adapters, media migrator. Alias composition проверена отдельно по Vite.
- `ast-index` недоступен в окружении: использованы tracked-file text scan, scoped поиск и относительный import graph. Это инвентарь кандидатов и влияния, **не доказательство точного production bundle graph**. Неисполняемые совпадения, комментарии и отрицательные тесты оставлены видимыми.
- 626 прямых файлов; 12 файлов с `database.types`; 248 файлов в reverse closure. Их union — 805 файлов, не сумма. Дополнительный протокольный проход — 37 файлов, из них 21 вне этого union; 22 файла прохода находятся в `e2e/`. В приложениях ниже перечислены также все 23 файла tenant migration; union всех приложений — **843 уникальных tracked paths**.
- Нет утверждения, что каждый файл надо удалить: смешанные native/legacy модули разделяются, native consumers и проверки запрета Supabase сохраняются. Число файлов не является оценкой трудозатрат.

## Реестр зависимостей и решений

ID используются в плане и в будущих PR. Один ID может объединять несколько связанных файлов; полный список путей ниже. Все пункты пока **OPEN**, кроме явно пассивных исключений `S10`.

| ID | Остаток и доказательство в baseline | Решение / этап | Условие закрытия |
|---|---|---|---|
| S01 | `services/api/src/server.ts:235` выбирает Supabase chat store/Vital signer при отсутствии native storage; bridge при двух config. `supabase-{bridge,chat-media,vital-media}.ts`, `legacy-chat-media.ts`; три POST `/v1/legacy/chat-media/{upload,sign,remove}` в `app.ts:374`; frontend `chat-media-bridge.queries.ts`; proxy/CORS `x-supabase-authorization` | P1: удалить bridge/fallback после S02, оставить native storage обязательным в соответствующем runtime | Native upload/sign/read/delete и ownership; старые ссылки читаются; нет legacy routes/header/RPC или возможности fallback при ошибке |
| S02 | Три source buckets: `chat-media`, `fit-exercise-media`, `custom-exercise-media`. `media-migration.ts:115` перечисляет только первые два; `object-storage-media.ts:62` не имеет custom namespace. Legacy queries загружают custom photos (`exercises.queries.ts:64`). Snapshot говорит, что Vital перенесён, но это не свежий object audit | P0/P1: census referenced objects и URLs; перенос остатков с целостностью; custom — условная ветка по фактам | Для каждого нужного объекта native location/доступ/права доказаны; ноль missing без `allow-missing`; custom zero-use доказан либо явно решена судьба ненулевых данных |
| S03 | `local-auth-composition.ts`, `local-data-composition.ts`, `auth-context.tsx`, `data-backend-context.tsx`, `AuthPages.tsx`, Vite aliases. Local data object имеет 21 слот, включая unsupported nutrition; старые auth/GoTrue, CRUD/RPC и realtime queries | P2: один native local auth/data путь; удалить retired Supabase auth и adapters после переноса tests | `npm run dev` использует локальный native API/PG; Yandex ID/app-session и обе роли сохраняются; нет local backend выбора Supabase |
| S04 | `src/data/database.types.ts`; общие JSON/workout/summary/progress mappers и mixed queries. Native `exercises.queries.ts` содержит AI parse/suggest, public-trainer-profile — native HTTP + local legacy RPC. 248 reverse candidates включают UI и type-only | P2: выделить neutral DTO/helpers, затем удалить generated types и legacy-only части | Native контракт и вычисления прежние; no SDK/type import leakage; не удалены native AI/общие мапперы |
| S05 | 202 migrations, 107 SQL tests, config/seed; CLI db scripts; `run-local-stack.mjs` требует две БД; `check-db-types.mjs` и legacy migration digest | P3: native fixture/seed/actor проверки; legacy chain в ограниченный inert archive после backup | Чистая PostgreSQL 17 chain, actor/RLS/grants и `local:verify` без Supabase; `dev` только Podman PG; legacy CLI/generated DB scripts исключены из активных checks |
| S06 | `.github/workflows/ci.yml`: database и три browser-семейства запускают legacy stack. Visual 5 + Chromium 2 + WebKit 4 = 11 browser jobs. Native Yandex-auth/Fit Lime уже без него. Протокольные ссылки в 22 E2E файлах включают отрицательный guard | P3: старая assertion → сохраняющая native проверка; retired email auth → явное прекращение obsolete контракта; убрать legacy setup | Те же уникальные product assertions/движки/viewports, нет ослабления gates; полный native CI и network-deny rehearsal |
| S07 | 23 файла `services/api/src/tenant-migration/`; source write gate, rehearsal, media migrator/CLI. Native identity unlink/rollout используют `fingerprintTenant` из `bundle.ts`; migration-app/server также обслуживают native maintenance | P4: после финальных сверок архивировать exporter/importer, neutral fingerprint вынести; сохранить native maintenance | Ни одного operational source-reader; identity unlink/rollout и native migrations/Vital deploy работают; source import не запускается на nonempty target |
| S08 | Auth admin contact/audit readers: `email-audience-audit.ts`, `ops/send_recovery_email.py`, `inspect-nutrition-pilot.mjs`, `cloudru-account-history-audit.mjs`; diagnose auth logs и old schedule pilot workflow | P0/P4: решение по каждой служебной операции, retire source-reader либо отдельный одобренный neutral источник | Нужные Cloud.ru diagnostics/native push сохранены; нет Supabase Auth как адресной книги, CLI/API key lookup или DB reader |
| S09 | deploy-stage дважды зеркалит bridge credentials; Terraform mounts/IAM/variables; root+API SDK и root CLI; 5 GitHub secret instances; remote mounts/старые revisions неизвестны | P4: сначала прекратить readers/старые revisions, потом revoke/delete credentials и packages | Lockfiles/build/runtime/local/CI не требуют SDK/CLI/secrets; IaC plan не затрагивает native DB/S3/AI; все хранилища секретов сверены |
| S10 | 134 docs; 11 native SQL files с историческими упоминаниями; native `auth.uid()` из migration000001; negative import/network guards; backup restore extension allowlist; общий AI Lockbox с историческим именем | P4/P5: сохранить нужные neutral guards/history, обновить operative docs, ограничить archive allowlist | Разрешённые совпадения перечислены; ни одно не читает Supabase. Native migration history и AI credentials не удалены ради имени |
| S11 | Уже удалённые из Git Edge Functions могут оставаться deployed; SQL содержит 8 имен cron; возможны Vault, webhooks, auth/OAuth config, integrations, outboxes, analytics consumers | P0/P5/P6: remote metadata inventory, writer fence, drain/disable, backup и остановка | Полный cloud resource registry; нет автономных producers/записей/запросов; reversible pause и наблюдение завершены перед удалением |

### Media и доступ к старым файлам

`LegacyChatMediaBridge` авторизует через Supabase RPC `authorize_chat_send`, `authorize_chat_media_read`, `authorize_chat_media_remove`; upload пишет в native storage, sign/remove при отсутствии native object обращаются к старому store. Поэтому отсутствие новых Supabase upload **не доказывает**, что legacy storage больше не читается.

Нужно сопоставить DB references, storage listings, object versions и публичные/подписанные URL в legacy/current данных. Помимо bucket objects старые profile photos могли храниться как JSON/data URL; native trainer gallery — отдельный контракт. Не публиковать пути объектов, идентификаторы, URL с токенами или контакты: в отчёте только агрегированные количества/байты/статусы, закрытый manifest — в разрешённом защищённом хранилище.

Владелец сообщает, что пользовательские упражнения не используются. Это продуктовая гипотеза о нулевом использовании, а не проверенный zero-count. При нуле записей/references/objects новый custom adapter не нужен. При ненуле текущий migrator их не охватывает: необходим отдельный перенос с правами доступа либо явное решение об архивном сохранении; молча считать их перенесёнными нельзя.

### SDK, CLI и типы

- Root dependency `@supabase/supabase-js ^2.110.8`, API dependency `2.110.8`; root dev dependency `supabase 2.116.0`.
- Root lockfile имеет 16 Supabase entries, API lockfile — 7; это entries пакетов, не 23 независимых сервиса.
- Runtime imports SDK: API `media-migration.ts`, `supabase-chat-media.ts`, `supabase-vital-media.ts`; frontend `client.ts`, `realtime.queries.ts`. Type-only: auth Session/AuthChangeEvent, chat RealtimeChannel.
- Generated types используются в query client/JSON/app-feedback/workouts и repository workout/progress/summary mappers; ссылки из scripts/package/docs не равны runtime import.
- Тесты `native-ai-import-boundary`, `native-media-import-boundary`, `native-composition`, `native-repository-boundary`, build boundary mocks проверяют **запрет** SDK: их нельзя считать функциональной зависимостью и бездумно удалять.

### Workflow и secret registry

| Workflow / группа | Реальная зависимость и действие |
|---|---|
| `ci.yml` | Legacy DB/browser provisioning, см. S05/S06; native API/PG/Fit Lime gates сохранить |
| `deploy-database.yml` | Ручной legacy deploy; убрать после окончательного source freeze |
| `deploy-yandex-stage.yml` | Два credential mirror блока, helper `mirror-yandex-legacy-supabase-bridge.mjs`; удалить оба после media |
| `migrate-yandex-media.yml`, `rehearse-yandex-tenant-migration.yml`, `manage-supabase-cutover-write-gate.yml` | Source migration/inspection; нужны до последнего доказательства, затем архив |
| `diagnose-supabase-auth.yml`, `manage-trainer-schedule-v2-pilot.yml` | Auth diagnostics и старый Supabase RPC; retire, не путать с native pilot managers |
| `inspect-nutrition-pilot.yml`, `inspect-cloudru-operations.yml`, `manage-cloudru-recovery-push.yml` | Есть Supabase user/contact readers; сохранить независимые Cloud.ru audits и push actions, отдельно закрыть email operations |
| `deploy-yandex-{assistant-orchestrator,summary-function,workout-parser}.yml` | Историческое имя AI Lockbox; само имя не означает Supabase credentials mounts. `read-cloudru-external-credentials.mjs` читает из него native Yandex AI keys — весь secret удалять нельзя |
| `backup-cloudru-production.yml` | `supabase_vault` в allowlist диагностируемых restore extensions; не runtime reader Supabase. Сохранить backup/restore |

Readonly GitHub metadata на 23.10.2026 (только имена): repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`; environment `fit-frontend-candidate`: `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`. Repository variables с Supabase именем не найдены. В проверенных environments `fit-frontend-production`, `Preview`, `Production`, `yandex-stage` соответствующих secret names нет. Итого **5 secret instances**, а не доказательство отсутствия секретов вне GitHub.

Активные/исторические env symbols: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. CLI/test constants `SUPABASE_DATABASE_EXCLUDE`, `SUPABASE_E2E_EXCLUDE`, `SUPABASE_INTERNAL_IMAGE_REGISTRY`, regex patterns не являются secrets. Проверять readers, а не только имена.

### Облачные ресурсы: пока только кандидаты из исходников

После удаления SQL comments обнаружены восемь литеральных cron names: `enqueue-workout-reminders`, `notify-app-feedback-telegram`, `refresh-analytics-app-feedback`, `refresh-analytics-client-overview`, `refresh-analytics-trainer-overview`, `refresh-analytics-trainers-metrics`, `sync-app-feedback-tracker`, `sync-push-notifications`. Это **не** свежий список работающих cron. Нельзя отключать одноимённый native dispatcher вместо старого producer.

Нужна закрытая read-only инвентаризация фактических Supabase projects/regions, DB/roles/permissions/size, Auth/OAuth/SMTP/hooks, Storage buckets/policies/versions, deployed Edge Functions и env **names**, cron/Vault/pg_net/webhooks/replication/integrations, pending outboxes и traffic. Также Cloud.ru service env, Yandex Lockbox payload **names**/IAM/старые revisions, внешние automation и cached web/mobile clients. Наличие/отсутствие этих ресурсов и свежесть backups в этом аудите **НЕ ПРОВЕРЕНЫ**. Не читать secret values и не выгружать PII ради реестра.

## Количественный срез прямых совпадений

Категории — по расположению файла, не по решению delete/keep.

| Категория | Файлов |
|---|---:|
| `api-runtime-tooling` | 15 |
| `api-tests` | 10 |
| `browser-tests-fixtures` | 3 |
| `documentation-archive` | 134 |
| `frontend-composition-domain-ui` | 14 |
| `frontend-queries` | 18 |
| `frontend-repositories` | 8 |
| `frontend-tests` | 35 |
| `generated-db-types` | 1 |
| `github-workflows-policy` | 15 |
| `infrastructure` | 4 |
| `legacy-db-other` | 4 |
| `legacy-db-tests` | 107 |
| `legacy-schema` | 202 |
| `lockfiles` | 2 |
| `native-db-history-compatibility` | 11 |
| `root-config-and-other` | 9 |
| `scripts-tests` | 21 |
| `scripts-tooling` | 13 |

202 migration + 107 DB tests + 134 docs = 443 из 626. Остальные 183 также включают tests/config/guards, а не только исполняемый код.

## Приложение A. Все 626 прямых файлов

`L` — строки literal match в baseline; `path-only` — файл включён по каталогу/generated types. Множественные строки сокращены до первых пяти с количеством остальных; файл включён целиком. Поиск регистронезависимый.

### api-runtime-tooling (15)

- `services/api/ops/send_recovery_email.py` — L61, 64, 69
- `services/api/package.json` — L24
- `services/api/src/app.ts` — L288, 362
- `services/api/src/email-audience-audit.ts` — L26, 27, 32, 43, 65
- `services/api/src/legacy-chat-media.ts` — L3, 17, 18, 30, 32 (+2)
- `services/api/src/media-migration-cli.ts` — L3, 14, 15, 21
- `services/api/src/media-migration.ts` — L3, 69, 89, 107, 116 (+1)
- `services/api/src/server.ts` — L14, 17, 41, 50, 235 (+7)
- `services/api/src/supabase-bridge.ts` — L1, 7, 13, 15, 16 (+9)
- `services/api/src/supabase-chat-media.ts` — L1, 4, 6, 9
- `services/api/src/supabase-vital-media.ts` — L1, 4, 6, 9
- `services/api/src/tenant-migration/catalog.ts` — L209, 633
- `services/api/src/tenant-migration/rehearsal-source-fixture.sql` — L3
- `services/api/src/tenant-migration/remote-rehearsal.ts` — L66, 67, 68, 185, 190 (+4)
- `services/api/src/tenant-migration/source-cutover-write-gate.ts` — L6, 21, 23, 53

### api-tests (10)

- `services/api/src/app.test.ts` — L1405, 1409, 1420, 1429, 1441 (+8)
- `services/api/src/db/actor-context.integration.test.ts` — L2848
- `services/api/src/legacy-chat-media.test.ts` — L4, 5, 10, 26, 32 (+1)
- `services/api/src/native-ai-import-boundary.test.ts` — L3, 4, 6
- `services/api/src/native-media-import-boundary.test.ts` — L3, 5
- `services/api/src/pilot-assistant-turn.test.ts` — L76
- `services/api/src/supabase-bridge.test.ts` — L3, 5, 7, 10, 16 (+1)
- `services/api/src/tenant-migration/remote-rehearsal.test.ts` — L6, 27, 30, 31, 56 (+6)
- `services/api/src/tenant-migration/source-cutover-write-gate.test.ts` — L14, 16, 17, 29, 50 (+1)
- `services/api/src/yandex-summary-function.test.ts` — L6, 14

### browser-tests-fixtures (3)

- `e2e/invitation-links.spec.ts` — L25, 77
- `e2e/yandex-assistant-routing.webkit.spec.ts` — L13
- `e2e/yandex-only-auth.webkit.spec.ts` — L716, 879

### documentation-archive (134)

- `.github/pull_request_template.md` — L8, 12
- `AGENTS.md` — L26, 28, 30, 86, 92 (+22)
- `ARCHITECTURE.md` — L6, 23, 45, 58, 59 (+5)
- `FEATURE_PARITY.md` — L16, 19, 194, 196, 197 (+12)
- `OPERATIONS.md` — L36, 40, 41, 48, 251 (+68)
- `README.md` — L5, 26, 30, 31, 47 (+3)
- `TECHNICAL_FLOW_AUDIT.md` — L5, 238, 308
- `docs/AI_AGENT_ONBOARDING.md` — L9, 10, 19, 104, 118 (+7)
- `docs/CURRENT_STATE.md` — L9, 25, 55, 79, 90 (+3)
- `docs/FIT_WORKFLOW.md` — L98, 99, 170, 189
- `docs/MEETINGS_CONTEXT.md` — L55, 81
- `docs/PRODUCT_WIKI.md` — L345, 456, 812, 813, 901 (+17)
- `docs/STAGE_DEPLOYMENT.md` — L4, 248, 249
- `docs/THIRD_PARTY_MEDIA.md` — L70
- `docs/YANDEX_CUTOVER_PLAYBOOK.md` — L1, 15, 18, 37, 38 (+18)
- `docs/YANDEX_FUNCTIONS_DEPLOYMENT.md` — L5
- `docs/YANDEX_PRODUCTION_PLATFORM.md` — L69
- `docs/design/API_SMOKE_SESSION_BUDGET_20261008.md` — L4
- `docs/design/ASSISTANT_PROGRAM_CONTEXT_FIX.md` — L55
- `docs/design/BACKLOG-OVERVIEW.md` — L86
- `docs/design/BUILD_WITHOUT_SUPABASE_ENV_20261014.md` — L1, 3, 5, 7, 10 (+5)
- `docs/design/CLIENT_ASSISTANT_ACCESS_2026-09-17.md` — L50
- `docs/design/CLIENT_ASSISTANT_PROGRAM_ROLLOUT_2026-09-17.md` — L21, 36, 37
- `docs/design/CLIENT_PAYMENT_DUE_DATE_20261008.md` — L30
- `docs/design/CLIENT_PROGRESS_HOME_REVIEW_AND_PLAN.md` — L73, 267, 269, 276
- `docs/design/CLIENT_READY_WORKOUTS_20261021.md` — L168, 170
- `docs/design/CLIENT_READY_WORKOUTS_RELIABILITY_20261022.md` — L178
- `docs/design/CLOUDRU_FRONTEND_BUILD_ENVIRONMENT_20261013.md` — L5
- `docs/design/CLOUDRU_STABILIZATION_20261014.md` — L34, 41, 175
- `docs/design/CLOUDRU_YANDEX_DATABASE_MIGRATION_20261012.md` — L14, 19
- `docs/design/CLOUD_RETURN_AUDIT_20261016.md` — L48, 110, 217
- `docs/design/CLOUD_RETURN_RUNBOOK_20261016.md` — L91
- `docs/design/COACH_LIVE_REFERENCE_COMPLETION_20261009.md` — L91, 93
- `docs/design/COACH_WORKOUT_REFERENCE_PILOT_20261008.md` — L212
- `docs/design/COMPLETED_WORKOUT_CUSTOM_EXERCISE_LINK_FIX.md` — L15, 56, 58
- `docs/design/DATABASE_AUDIT_CLIENT_STATS_20261006.md` — L41, 63
- `docs/design/DATABASE_AUDIT_DUPLICATE_INDEXES_20261006.md` — L6, 79
- `docs/design/DATABASE_AUDIT_HISTORY_PAGINATION_20261005.md` — L5, 23, 48
- `docs/design/DATABASE_AUDIT_PROFILE_PHOTO_CONCURRENCY_20261005.md` — L11, 50
- `docs/design/DATABASE_AUDIT_WORKOUT_SNAPSHOT_20261005.md` — L14, 62
- `docs/design/DATABASE_GOAL_STAGE_DELETE_20261007.md` — L4, 40
- `docs/design/DATABASE_HOME_READS_20261008.md` — L12
- `docs/design/DATABASE_SESSION_CLEANUP_20261007.md` — L23, 43, 57
- `docs/design/DATABASE_WORKOUT_RECORDS_20261007.md` — L12, 21, 48, 55, 56
- `docs/design/FAVORITE_SAVE_FAILURE_20261020.md` — L17
- `docs/design/FINANCE_RELIABILITY_PLAN_20261002.md` — L56
- `docs/design/FINANCE_TEMPLATE_TEST_DEDUPLICATION_20261015.md` — L84
- `docs/design/FIT7_TRAINER_DISCONNECT.md` — L38
- `docs/design/FIT_LIME_DAY_UX_20261003.md` — L76
- `docs/design/FIT_LIME_FIGMA_ROLLOUT_20261002.md` — L238
- `docs/design/FIT_LIME_FLAG_OPERATIONS_2026-09-27.md` — L10
- `docs/design/LIME_GLOBAL_ROLLOUT_20261007.md` — L6
- `docs/design/LIVE_TIMER_NOTES_STABILITY.md` — L49
- `docs/design/MONOCHROME_GATE_0_BASELINE.md` — L224
- `docs/design/MONOCHROME_GATE_3_CLIENT_HOME.md` — L59
- `docs/design/MONOCHROME_GATE_8_AUTH_FLOW.md` — L60
- `docs/design/NATIVE_AI_SUPABASE_BOUNDARY_20261016.md` — L1, 7
- `docs/design/NATIVE_FRONTEND_COMPOSITION_20261015.md` — L13, 43
- `docs/design/NATIVE_MEDIA_SUPABASE_BOUNDARY_20261020.md` — L1, 11, 19, 24, 38
- `docs/design/NATIVE_ONLY_ASSISTANT_BACKEND_20261021.md` — L9, 32, 55
- `docs/design/NATIVE_ONLY_FRONTEND_AI_20261021.md` — L8, 14, 17, 26, 38
- `docs/design/NEUTRAL_REPOSITORY_HELPERS_20261015.md` — L5
- `docs/design/NUTRITION_DIARY_PILOT_20261010.md` — L296, 665
- `docs/design/PARSER_DEPLOY_WITHOUT_SUPABASE_20261021.md` — L1, 5, 7, 15, 16
- `docs/design/PRODUCT_USABILITY_AUDIT_2026-08-18.md` — L55
- `docs/design/PROGRESS_AI_AGGREGATE_CACHE_RELIABILITY.md` — L26, 58, 68
- `docs/design/PROGRESS_AI_AGGREGATION_AND_DEDUPLICATION.md` — L80
- `docs/design/PROGRESS_AI_JSON_RESILIENCE.md` — L79, 102
- `docs/design/PROGRESS_AI_SERVICE_ROLE_RPC_FIX.md` — L18, 47
- `docs/design/PROGRESS_AI_SESSION_RECOVERY.md` — L1, 9, 23, 29, 60
- `docs/design/PROGRESS_AI_TECHNIQUE_QUALITY_GATE_FIX.md` — L34
- `docs/design/PROGRESS_AI_WHOLE_PERIOD_ANALYSIS.md` — L37
- `docs/design/PROGRESS_NEUTRAL_ADDRESS_20261018.md` — L39, 40, 75
- `docs/design/PROGRESS_SUMMARY_QUALITY_REPAIR.md` — L11
- `docs/design/PUSH_SETTINGS_SIMPLE_20261018.md` — L61
- `docs/design/REMOVE_LEGACY_AI_API_20261020.md` — L21, 26, 36, 50
- `docs/design/REMOVE_SERVER_LEGACY_AI_ADAPTERS_20261021.md` — L20, 33, 42, 45, 47 (+1)
- `docs/design/REMOVE_SUPABASE_EDGE_AI_20261021.md` — L1, 5, 10, 21, 24 (+1)
- `docs/design/REMOVE_SUPABASE_FUNCTION_DEPLOY_CREDENTIALS_20261021.md` — L1, 4, 11, 17, 24 (+1)
- `docs/design/REMOVE_SUPABASE_LINKING_20261020.md` — L1, 4, 9, 15, 38
- `docs/design/REMOVE_SUPABASE_PROGRAM_HELPERS_20261021.md` — L1, 3, 8, 15, 24 (+2)
- `docs/design/REMOVE_SUPABASE_RECOVERY_20261014.md` — L40
- `docs/design/REMOVE_SUPABASE_VITAL_DEPLOY_20261022.md` — L1, 5, 11, 13
- `docs/design/REMOVE_SUPABASE_WORKOUT_PARSER_20261020.md` — L1, 3, 9, 15, 26 (+3)
- `docs/design/SELECTED_TRAINER_DISCONNECT_20261007.md` — L30
- `docs/design/SINGLE_ACTIVE_TRAINER_20261019.md` — L99, 104
- `docs/design/SUMMARY_PRIVATE_DIAGNOSTIC.md` — L25, 57
- `docs/design/SUPABASE_DECOMMISSION_INVENTORY_2026-09-25.md` — L1, 6, 11, 12, 13 (+8)
- `docs/design/SUPERSET_LIVE_ROUNDS_SPLIT_UX_2026-10-02.md` — L5
- `docs/design/TEMPLATE_SLOW_CONNECTION_20261008.md` — L15
- `docs/design/TRAINER_CLIENT_SWIPE_ARCHIVE.md` — L15, 27, 50
- `docs/design/TRAINER_METRO_LOCATIONS_PLAN.md` — L24
- `docs/design/TRAINER_SCHEDULE_SELF_LED.md` — L10, 23, 32, 33, 44
- `docs/design/UI_IDENTITY_LEGACY_CLEANUP_2026-08-30.md` — L10, 45, 77
- `docs/design/VITAL_GYM_PRO_CATALOG.md` — L10
- `docs/design/VITAL_YANDEX_MEDIA_DEPLOYMENT.md` — L7, 19, 27, 69
- `docs/design/WORKOUT_ACTIVE_CALORIES_V2_2026-10-01.md` — L45
- `docs/design/WORKOUT_ACTUAL_DURATION_EDIT_20261006.md` — L42
- `docs/design/WORKOUT_COPY_CATALOG_NAMES.md` — L38
- `docs/design/WORKOUT_FACT_METRICS_20261002.md` — L43
- `docs/design/WORKOUT_FEEDBACK_COMPACT_20261010.md` — L20, 39
- `docs/design/WORKOUT_PLAN_ACCESS_DRAFTS_20261022.md` — L50
- `docs/design/WORKOUT_SUMMARY_NEUTRAL_CARD.md` — L24
- `docs/design/YAFIT-414_PROGRESS_GOAL_CRITERIA_FOUNDATION.md` — L12
- `docs/design/YAFIT-493_TRAINER_CATALOG.md` — L34
- `docs/design/YAFIT-510_CHAT_PRODUCTIVITY_2026-09-11.md` — L92
- `docs/design/YAFIT-511_TRAINER_DISCOVERY_AND_CHAT.md` — L35, 47
- `docs/design/YAFIT-513_TRAINER_DISCOVERY_AUDIT_FIXES.md` — L108
- `docs/design/YAFIT-526_YANDEX_INVITATION_RELIABILITY.md` — L12, 24
- `docs/design/YAFIT-537_SAINT_PETERSBURG_METRO.md` — L11
- `docs/design/YAFIT-578-FRACTIONAL-DISTANCE.md` — L15, 32
- `docs/design/YAFIT-600_ATHLETE_SPORT_PROFILE.md` — L22
- `docs/design/YAFIT_465_WORKOUT_EXERCISE_REMOVAL.md` — L21, 33
- `docs/design/YAFIT_479_LIVE_MOBILE_RELIABILITY.md` — L50
- `docs/design/YAFIT_488_LEGAL_AUTH.md` — L19
- `docs/design/YAFIT_524_METRIKA_AUTHENTICATED_USERS.md` — L4, 25
- `docs/design/YANDEX_FRONTEND_CLOUD_PROBE.md` — L143
- `docs/design/YANDEX_FRONTEND_FOUNDATION.md` — L6, 70
- `docs/design/YANDEX_FRONTEND_RELEASE_REHEARSAL.md` — L7
- `docs/design/YANDEX_ID_GLOBAL_LOGIN_ROLLOUT.md` — L44, 50, 52
- `docs/design/YANDEX_INVITATION_AUTH_HANDOFF.md` — L29, 69
- `docs/design/YANDEX_NATIVE_REGISTRATION.md` — L6
- `docs/design/YANDEX_ONLY_AUTH_RECOVERY.md` — L24, 37, 38, 62
- `docs/design/YANDEX_TENANT_MIGRATION_TOOLING.md` — L41, 89, 91, 92, 155 (+3)
- `docs/design/assistant-sandbox.md` — L92
- `docs/design/home-quick-start-both-roles-20261001.md` — L4
- `docs/design/live-phase-timer.md` — L53
- `docs/design/trainer-client-upcoming-20260928.md` — L39, 64
- `docs/design/trainer-feedback-backlog.md` — L32
- `docs/design/trainer-schedule-density-20260930.md` — L22, 79
- `docs/design/workout-origin-and-favorite-title.md` — L29, 61, 93, 123
- `docs/design/workout-time-keyboard-default-20260930.md` — L20
- `infra/yandex/README.md` — L171, 175, 183, 204, 205 (+3)
- `services/api/db/README.md` — L4, 5, 45, 72

### frontend-composition-domain-ui (14)

- `src/app/auth-context.tsx` — L36, 38, 39, 43, 58 (+28)
- `src/app/composition-build-boundary.ts` — L8
- `src/app/data-backend-context.tsx` — L30
- `src/app/feature-flags.ts` — L216
- `src/app/local-data-composition.ts` — L24, 25, 52
- `src/features/assistant/YandexAssistantRoute.tsx` — L37, 56
- `src/features/auth/invitation-link-continuation.ts` — L22, 39
- `src/features/exercises/vitalMedia.ts` — L22, 26
- `src/features/notifications/NotificationOnboarding.tsx` — L74
- `src/features/notifications/reconcile-push-subscription.ts` — L20
- `src/features/progress/SummaryDiagnosticPanel.tsx` — L5, 16
- `src/features/workouts/quick-workout-entry.ts` — L67
- `src/shared/domain.ts` — L163
- `src/shared/trainer-profile.ts` — L47

### frontend-queries (18)

- `src/data/queries/app-feedback.queries.ts` — L2, 6
- `src/data/queries/auth.queries.ts` — L1, 2, 7, 9, 13 (+12)
- `src/data/queries/chat-media-bridge.queries.ts` — L2, 9, 17
- `src/data/queries/chat.queries.ts` — L1, 2, 4, 6, 7 (+19)
- `src/data/queries/client.ts` — L1, 4, 6, 15, 17 (+3)
- `src/data/queries/clients.queries.ts` — L2, 8, 9, 10, 12 (+10)
- `src/data/queries/exercises.queries.ts` — L1, 64, 66, 67, 68 (+5)
- `src/data/queries/goals.queries.ts` — L2, 6, 7, 10, 13 (+1)
- `src/data/queries/invitations.queries.ts` — L1, 4, 8, 12, 13 (+7)
- `src/data/queries/legal.queries.ts` — L1, 4, 17, 26, 34 (+1)
- `src/data/queries/progress.queries.ts` — L2, 6, 7, 10, 13 (+6)
- `src/data/queries/public-trainer-profile.queries.ts` — L9, 10
- `src/data/queries/push-notifications.queries.ts` — L2, 8, 15, 17, 19 (+2)
- `src/data/queries/realtime.queries.ts` — L1, 2, 34, 49
- `src/data/queries/supabase-environment.ts` — L1, 3, 10, 13, 15
- `src/data/queries/training-summaries.queries.ts` — L2, 13, 21, 26, 57 (+1)
- `src/data/queries/workout-templates.queries.ts` — L2, 8, 9, 10, 13
- `src/data/queries/workouts.queries.ts` — L2, 11, 18, 19, 23 (+29)

### frontend-repositories (8)

- `src/data/repositories/auth.repository.ts` — L116
- `src/data/repositories/favorite-workouts.repository.ts` — L2, 33, 38, 46
- `src/data/repositories/legal.repository.ts` — L11, 36, 38, 59, 64 (+2)
- `src/data/repositories/trainer-discovery.repository.ts` — L6, 18, 23
- `src/data/repositories/trainer-profiles.repository.ts` — L3, 25, 30, 35, 37 (+4)
- `src/data/repositories/training-summaries.repository.ts` — L103
- `src/data/repositories/workouts.repository.ts` — L413
- `src/data/repositories/yandex-main.repository.ts` — L609, 757, 759

### frontend-tests (35)

- `src/app/auth-context.test.tsx` — L172, 200
- `src/app/composition-build-boundary.test.ts` — L14, 15
- `src/app/data-backend-context.test.tsx` — L7, 14, 15, 16, 17 (+12)
- `src/app/ios-build-contract.test.ts` — L12
- `src/app/native-composition.test.tsx` — L9
- `src/data/queries/app-feedback.queries.test.ts` — L4
- `src/data/queries/auth-fetch.test.ts` — L16, 24, 30, 42
- `src/data/queries/chat-media-bridge.queries.test.ts` — L4, 11, 15, 31
- `src/data/queries/client.test.ts` — L6, 8, 15, 16, 25 (+23)
- `src/data/queries/clients.queries.test.ts` — L6
- `src/data/queries/exercises-ai.queries.test.ts` — L7, 21, 38
- `src/data/queries/realtime.queries.test.ts` — L1, 12
- `src/data/queries/supabase-environment.test.ts` — L2, 4, 6, 8, 12 (+5)
- `src/data/queries/training-summaries.queries.test.ts` — L8
- `src/data/queries/workouts.queries.test.ts` — L15
- `src/data/repositories/auth.repository.test.ts` — L291
- `src/data/repositories/legal.repository.test.ts` — L25, 48
- `src/data/repositories/native-repository-boundary.test.ts` — L5
- `src/data/repositories/public-invitation-links.repository.test.ts` — L25, 28, 48, 64
- `src/data/repositories/push-notifications.repository.test.ts` — L29
- `src/data/repositories/trainer-profiles.repository.test.ts` — L12, 45, 55, 105, 113 (+1)
- `src/data/repositories/yandex-assistant.repository.test.ts` — L42, 111
- `src/data/repositories/yandex-main.repository.test.ts` — L517, 518, 520, 842
- `src/data/training-summary-errors.test.ts` — L44
- `src/features/assistant/YandexAssistantRoute.test.tsx` — L127
- `src/features/assistant/assistant-program-availability.test.ts` — L19
- `src/features/auth/InvitationPage.test.tsx` — L10, 68, 73, 105, 111 (+1)
- `src/features/auth/InvitationShareActions.test.tsx` — L16
- `src/features/auth/invitation-link-continuation.test.ts` — L41, 42, 72, 73, 79 (+3)
- `src/features/exercises/ExerciseImage.test.tsx` — L204, 227, 260, 284, 360 (+1)
- `src/features/exercises/vitalMedia.test.tsx` — L7, 18, 77, 85, 93 (+6)
- `src/features/legal/LegalPages.test.tsx` — L23, 71
- `src/features/progress/SummaryDiagnosticPanel.test.tsx` — L18, 42
- `src/shared/InvitationShareDialog.test.tsx` — L27, 34, 65
- `src/shared/trainer-profile.test.ts` — L45

### generated-db-types (1)

- `src/data/database.types.ts` — L3162

### github-workflows-policy (15)

- `.github/workflows/backup-cloudru-production.yml` — L125
- `.github/workflows/ci.yml` — L15, 19, 154, 161, 162 (+34)
- `.github/workflows/deploy-database.yml` — L18, 21, 23, 24, 25 (+3)
- `.github/workflows/deploy-yandex-assistant-orchestrator.yml` — L34
- `.github/workflows/deploy-yandex-stage.yml` — L13, 85, 144, 210, 212 (+22)
- `.github/workflows/deploy-yandex-summary-function.yml` — L31
- `.github/workflows/deploy-yandex-workout-parser.yml` — L20
- `.github/workflows/diagnose-supabase-auth.yml` — L1, 24, 28, 29
- `.github/workflows/inspect-cloudru-operations.yml` — L184, 185, 210
- `.github/workflows/inspect-nutrition-pilot.yml` — L31, 49, 50
- `.github/workflows/manage-cloudru-recovery-push.yml` — L36, 37, 106
- `.github/workflows/manage-supabase-cutover-write-gate.yml` — L1, 37, 41, 43, 44 (+9)
- `.github/workflows/manage-trainer-schedule-v2-pilot.yml` — L64, 75, 76, 83, 92 (+8)
- `.github/workflows/migrate-yandex-media.yml` — L42, 58, 59, 66, 72 (+6)
- `.github/workflows/rehearse-yandex-tenant-migration.yml` — L59, 63, 65, 66, 67 (+21)

### infrastructure (4)

- `infra/yandex/container.tf` — L20, 21, 23, 97, 98 (+5)
- `infra/yandex/database.tf` — L154, 155, 157
- `infra/yandex/terraform.tfvars.example` — L35, 37, 38
- `infra/yandex/variables.tf` — L274, 275, 281, 282

### legacy-db-other (4)

- `supabase/.gitignore` — L1
- `supabase/config.toml` — L2, 3, 4, 63, 70 (+16)
- `supabase/seed.sql` — path-only
- `supabase/snippets/.gitkeep` — path-only

### legacy-db-tests (107)

- `supabase/tests/0001_schema.test.sql` — path-only
- `supabase/tests/0002_rls.test.sql` — path-only
- `supabase/tests/0003_rpc.test.sql` — path-only
- `supabase/tests/0004_live_append_security.test.sql` — path-only
- `supabase/tests/0005_list_clients.test.sql` — path-only
- `supabase/tests/0006_non_retryable_conflicts.test.sql` — path-only
- `supabase/tests/0007_list_workouts.test.sql` — path-only
- `supabase/tests/0008_http_error_taxonomy.test.sql` — path-only
- `supabase/tests/0009_live_reorder.test.sql` — path-only
- `supabase/tests/0010_live_replace_exercise.test.sql` — path-only
- `supabase/tests/0010_training_summaries.test.sql` — path-only
- `supabase/tests/0011_client_progress_publication.test.sql` — path-only
- `supabase/tests/0011_exercise_comment.test.sql` — path-only
- `supabase/tests/0012_block_preset_migration.test.sql` — path-only
- `supabase/tests/0013_live_set_fact_inherit_and_remove.test.sql` — path-only
- `supabase/tests/0014_account_roles.test.sql` — path-only
- `supabase/tests/0014_confirm_inherits_plan.test.sql` — path-only
- `supabase/tests/0015_client_memberships_invitations.test.sql` — path-only
- `supabase/tests/0016_client_realtime.test.sql` — L9
- `supabase/tests/0017_analytics_trainers_metrics.test.sql` — path-only
- `supabase/tests/0018_shared_mutations.test.sql` — path-only
- `supabase/tests/0019_membership_management.test.sql` — path-only
- `supabase/tests/0020_client_self_service_workouts.test.sql` — path-only
- `supabase/tests/0021_standalone_client_card.test.sql` — path-only
- `supabase/tests/0022_analytics_trainer_overview.test.sql` — path-only
- `supabase/tests/0022_client_profile_trainer_preferences.test.sql` — path-only
- `supabase/tests/0023_multi_trainer_author_access.test.sql` — path-only
- `supabase/tests/0024_client_goals_stages.test.sql` — path-only
- `supabase/tests/0025_workout_stage_binding.test.sql` — path-only
- `supabase/tests/0026_glutes_muscle_group.test.sql` — path-only
- `supabase/tests/0027_database_performance_indexes.test.sql` — path-only
- `supabase/tests/0028_set_duration_seconds_rpe.test.sql` — path-only
- `supabase/tests/0029_latest_exercise_results.test.sql` — path-only
- `supabase/tests/0030_save_completed_workout.test.sql` — path-only
- `supabase/tests/0031_quick_client_profile.test.sql` — path-only
- `supabase/tests/0032_finish_confirm_serialization.test.sql` — path-only
- `supabase/tests/0033_idempotent_workout_creation.test.sql` — path-only
- `supabase/tests/0035_workout_live_invariants.test.sql` — path-only
- `supabase/tests/0036_workout_trainer_review.test.sql` — path-only
- `supabase/tests/0037_workout_client_comment.test.sql` — path-only
- `supabase/tests/0038_one_active_workout_per_client.test.sql` — path-only
- `supabase/tests/0039_completed_workout_goal_stage.test.sql` — path-only
- `supabase/tests/0040_connected_trainer_training_summary.test.sql` — path-only
- `supabase/tests/0041_minimal_public_grants.test.sql` — path-only
- `supabase/tests/0042_analytics_client_overview.test.sql` — path-only
- `supabase/tests/0043_workout_client_feedback.test.sql` — path-only
- `supabase/tests/0044_workout_trainer_response.test.sql` — path-only
- `supabase/tests/0045_workout_regularity.test.sql` — path-only
- `supabase/tests/0046_exercise_progress.test.sql` — path-only
- `supabase/tests/0047_workout_chronicle.test.sql` — path-only
- `supabase/tests/0048_running_intervals.test.sql` — path-only
- `supabase/tests/0049_running_progress.test.sql` — path-only
- `supabase/tests/0050_missed_workout_resolution.test.sql` — path-only
- `supabase/tests/0051_trainer_attention_queue.test.sql` — path-only
- `supabase/tests/0052_workout_question_responsible_trainer.test.sql` — path-only
- `supabase/tests/0053_workout_question_optional_reaction.test.sql` — path-only
- `supabase/tests/0054_quick_own_client_profile.test.sql` — path-only
- `supabase/tests/0055_app_feedback.test.sql` — path-only
- `supabase/tests/0056_record_planned_workout_result.test.sql` — path-only
- `supabase/tests/0057_assistant_actions.test.sql` — path-only
- `supabase/tests/0058_app_feedback_tracker_sync.test.sql` — path-only
- `supabase/tests/0059_analytics_app_feedback.test.sql` — path-only
- `supabase/tests/0060_app_feedback_telegram_notify.test.sql` — path-only
- `supabase/tests/0061_push_notifications.test.sql` — path-only
- `supabase/tests/0062_client_trainer_relationship_foundation.test.sql` — path-only
- `supabase/tests/0063_atomic_client_attach.test.sql` — path-only
- `supabase/tests/0064_safe_trainer_disconnect.test.sql` — path-only
- `supabase/tests/0065_safe_trainer_reconnect.test.sql` — path-only
- `supabase/tests/0066_trainer_disconnect_reconciliation.test.sql` — path-only
- `supabase/tests/0067_goal_criteria_foundation.test.sql` — path-only
- `supabase/tests/0068_client_goal_self_service.test.sql` — path-only
- `supabase/tests/0068_selected_trainer_disconnect.test.sql` — path-only
- `supabase/tests/0069_standard_goal_progress.test.sql` — path-only
- `supabase/tests/0070_extended_goal_criteria.test.sql` — path-only
- `supabase/tests/0071_client_custom_metric_self_service.test.sql` — path-only
- `supabase/tests/0072_push_workout_scheduled_notification.test.sql` — path-only
- `supabase/tests/0073_client_custom_exercise_self_service.test.sql` — path-only
- `supabase/tests/0074_workout_exercise_removal.test.sql` — path-only
- `supabase/tests/0075_push_test_notification.test.sql` — path-only
- `supabase/tests/0099_live_client_exercise_note.test.sql` — path-only
- `supabase/tests/0100_legal_acceptance_and_account_deletion.test.sql` — path-only
- `supabase/tests/0101_trainer_professional_profiles.test.sql` — path-only
- `supabase/tests/0102_trainer_catalog.test.sql` — path-only
- `supabase/tests/0103_reliable_chat.test.sql` — path-only
- `supabase/tests/0104_chat_productivity.test.sql` — path-only
- `supabase/tests/0105_trainer_discovery_prompt.test.sql` — path-only
- `supabase/tests/0106_public_trainer_chat_security.test.sql` — path-only
- `supabase/tests/0106_training_summary_generation_guard.test.sql` — path-only
- `supabase/tests/0107_chat_connection_invitation.test.sql` — path-only
- `supabase/tests/0108_training_summary_client_cache.test.sql` — path-only
- `supabase/tests/0109_trainer_connection_source_of_truth.test.sql` — path-only
- `supabase/tests/0110_completed_custom_exercise_snapshot.test.sql` — path-only
- `supabase/tests/0111_assistant_program_pilot.test.sql` — path-only
- `supabase/tests/0112_assistant_program_jobs.test.sql` — path-only
- `supabase/tests/0113_assistant_program_retry.test.sql` — path-only
- `supabase/tests/0114_custom_exercise_classification_and_media.test.sql` — path-only
- `supabase/tests/0115_client_assistant_actions.test.sql` — path-only
- `supabase/tests/0116_client_assistant_programs.test.sql` — path-only
- `supabase/tests/0117_live_custom_exercise_snapshot.test.sql` — path-only
- `supabase/tests/0118_client_assistant_program_jobs.test.sql` — path-only
- `supabase/tests/0119_invitation_links.test.sql` — path-only
- `supabase/tests/0120_source_cutover_write_gate.test.sql` — path-only
- `supabase/tests/0121_tenant_migration_trigger_guard.test.sql` — path-only
- `supabase/tests/0122_favorite_workouts.test.sql` — path-only
- `supabase/tests/0123_trainer_schedule_v2_pilot.test.sql` — path-only
- `supabase/tests/0124_domain_change_push_announcement.test.sql` — path-only
- `supabase/tests/0125_trainer_workout_templates.test.sql` — path-only

### legacy-schema (202)

- `supabase/migrations/20260721000100_foundation.sql` — path-only
- `supabase/migrations/20260721000200_domain_tables.sql` — path-only
- `supabase/migrations/20260721000300_security.sql` — path-only
- `supabase/migrations/20260721000400_rpc.sql` — path-only
- `supabase/migrations/20260722000100_live_append.sql` — path-only
- `supabase/migrations/20260722000200_list_clients.sql` — path-only
- `supabase/migrations/20260723000100_non_retryable_conflicts.sql` — path-only
- `supabase/migrations/20260723000200_list_workouts.sql` — path-only
- `supabase/migrations/20260723000300_list_workouts_timer.sql` — path-only
- `supabase/migrations/20260723000400_append_live_set_inherit_plan.sql` — path-only
- `supabase/migrations/20260723000500_http_error_taxonomy.sql` — path-only
- `supabase/migrations/20260724000100_exercise_blocks.sql` — path-only
- `supabase/migrations/20260724000200_block_rounds.sql` — path-only
- `supabase/migrations/20260724000300_live_reorder.sql` — path-only
- `supabase/migrations/20260724000400_progress_custom_client_index.sql` — path-only
- `supabase/migrations/20260724000500_live_replace_exercise.sql` — path-only
- `supabase/migrations/20260726000100_exercise_comment.sql` — path-only
- `supabase/migrations/20260726000200_block_presets_rest.sql` — path-only
- `supabase/migrations/20260727000100_append_live_set_inherit_fact.sql` — path-only
- `supabase/migrations/20260727000200_remove_live_set.sql` — path-only
- `supabase/migrations/20260727000300_confirm_inherits_plan_fact.sql` — path-only
- `supabase/migrations/20260727000400_account_roles.sql` — path-only
- `supabase/migrations/20260727000500_client_memberships_invitations.sql` — path-only
- `supabase/migrations/20260727000600_client_realtime.sql` — L18, 22
- `supabase/migrations/20260727000700_accessible_workout_list.sql` — path-only
- `supabase/migrations/20260727000800_analytics_trainers_metrics.sql` — path-only
- `supabase/migrations/20260727000801_shared_mutation_authorization.sql` — path-only
- `supabase/migrations/20260727000900_membership_management.sql` — path-only
- `supabase/migrations/20260727090725_client_training_summaries.sql` — path-only
- `supabase/migrations/20260727114654_client_progress_publication.sql` — path-only
- `supabase/migrations/20260727123240_client_self_service_summaries.sql` — path-only
- `supabase/migrations/20260727130000_client_self_service_workouts.sql` — path-only
- `supabase/migrations/20260727140000_author_scoped_client_data.sql` — path-only
- `supabase/migrations/20260727150000_standalone_client_card.sql` — path-only
- `supabase/migrations/20260727160000_client_profile_trainer_preferences.sql` — path-only
- `supabase/migrations/20260728000100_client_goals_stages.sql` — path-only
- `supabase/migrations/20260728000200_stage_within_goal_date.sql` — path-only
- `supabase/migrations/20260728000300_workout_stage_binding.sql` — path-only
- `supabase/migrations/20260729000100_allow_glutes_muscle_group.sql` — path-only
- `supabase/migrations/20260729000200_database_performance_indexes.sql` — path-only
- `supabase/migrations/20260729000300_optimize_list_workouts.sql` — path-only
- `supabase/migrations/20260731133000_set_duration_seconds_rpe.sql` — path-only
- `supabase/migrations/20260731150000_latest_exercise_results.sql` — path-only
- `supabase/migrations/20260731170000_save_completed_workout.sql` — path-only
- `supabase/migrations/20260731190000_edit_completed_workout.sql` — path-only
- `supabase/migrations/20260801120000_quick_client_profile.sql` — path-only
- `supabase/migrations/20260801130000_analytics_trainer_overview.sql` — path-only
- `supabase/migrations/20260802013000_client_list_last_activity.sql` — path-only
- `supabase/migrations/20260802020000_analytics_trainer_overview_refreshed_at.sql` — path-only
- `supabase/migrations/20260803010000_completed_workout_author.sql` — path-only
- `supabase/migrations/20260803020000_preserve_completed_workout_plan.sql` — path-only
- `supabase/migrations/20260803030000_prevent_workout_client_reassignment.sql` — path-only
- `supabase/migrations/20260803040000_confirmed_exercise_results.sql` — path-only
- `supabase/migrations/20260803050000_confirm_live_set_requires_values.sql` — path-only
- `supabase/migrations/20260803060000_completed_exercise_replacement_clears_fact.sql` — path-only
- `supabase/migrations/20260803070000_lock_live_workout_during_set_confirmation.sql` — path-only
- `supabase/migrations/20260803080000_idempotent_workout_creation.sql` — path-only
- `supabase/migrations/20260803090000_analytics_exclude_deleted_workouts.sql` — path-only
- `supabase/migrations/20260803100000_analytics_trainer_overview_status.sql` — path-only
- `supabase/migrations/20260803110000_analytics_trainer_overview_refresh_schedule.sql` — path-only
- `supabase/migrations/20260804010000_workout_live_invariants.sql` — path-only
- `supabase/migrations/20260807010000_workout_trainer_review.sql` — path-only
- `supabase/migrations/20260808010000_workout_client_comment.sql` — path-only
- `supabase/migrations/20260809000000_workout_creation_owner.sql` — path-only
- `supabase/migrations/20260809010000_sync_inherited_client_alias.sql` — path-only
- `supabase/migrations/20260809020000_share_completed_client_workouts.sql` — path-only
- `supabase/migrations/20260809030000_one_active_workout_per_client.sql` — path-only
- `supabase/migrations/20260809040000_validate_completed_workout_goal_stage.sql` — path-only
- `supabase/migrations/20260809050000_connected_trainer_training_summary_access.sql` — path-only
- `supabase/migrations/20260809060000_minimal_public_grants.sql` — L2
- `supabase/migrations/20260810010000_live_structural_mutations_for_connected_client.sql` — path-only
- `supabase/migrations/20260810020000_safe_completed_workout_positions.sql` — path-only
- `supabase/migrations/20260810030000_analytics_client_overview.sql` — path-only
- `supabase/migrations/20260810040000_analytics_client_overview_last_activity.sql` — path-only
- `supabase/migrations/20260811010000_live_workout_progress_updated_by.sql` — path-only
- `supabase/migrations/20260811020000_analytics_client_overview_activity_by_updated_by.sql` — path-only
- `supabase/migrations/20260811030000_restore_post_361_contract.sql` — path-only
- `supabase/migrations/20260814010000_expand_client_realtime.sql` — L20, 24
- `supabase/migrations/20260815010000_workout_client_feedback.sql` — path-only
- `supabase/migrations/20260815020000_workout_trainer_response.sql` — path-only
- `supabase/migrations/20260815030000_workout_regularity.sql` — path-only
- `supabase/migrations/20260816010000_exercise_progress.sql` — path-only
- `supabase/migrations/20260816020000_workout_chronicle.sql` — path-only
- `supabase/migrations/20260816030000_workout_attendance_and_pr_details.sql` — path-only
- `supabase/migrations/20260817010000_redo_live_workout_progress_updated_by.sql` — path-only
- `supabase/migrations/20260817020000_redo_analytics_client_overview_activity_by_updated_by.sql` — L1
- `supabase/migrations/20260817030000_running_intervals.sql` — path-only
- `supabase/migrations/20260817040000_running_progress.sql` — path-only
- `supabase/migrations/20260821010000_missed_workout_resolution.sql` — path-only
- `supabase/migrations/20260821020000_trainer_attention_queue.sql` — path-only
- `supabase/migrations/20260821030000_workout_question_responsible_trainer.sql` — path-only
- `supabase/migrations/20260822010000_workout_question_optional_reaction.sql` — path-only
- `supabase/migrations/20260823010000_quick_own_client_profile.sql` — path-only
- `supabase/migrations/20260823020000_app_feedback.sql` — path-only
- `supabase/migrations/20260824010000_record_planned_workout_result.sql` — path-only
- `supabase/migrations/20260824113736_assistant_conversation_history.sql` — L2
- `supabase/migrations/20260824150000_bodyweight_exercise_progress.sql` — path-only
- `supabase/migrations/20260825115629_assistant_actions_idempotency.sql` — path-only
- `supabase/migrations/20260825180000_app_feedback_tracker_sync.sql` — L13
- `supabase/migrations/20260826090000_assistant_summary_inline_result.sql` — path-only
- `supabase/migrations/20260826140000_enable_pg_net.sql` — L2, 4
- `supabase/migrations/20260826153300_analytics_app_feedback.sql` — L5
- `supabase/migrations/20260826180000_app_feedback_telegram_notify.sql` — L8
- `supabase/migrations/20260826190000_push_notifications.sql` — path-only
- `supabase/migrations/20260827190000_client_trainer_relationship_foundation.sql` — path-only
- `supabase/migrations/20260828100000_atomic_client_attach.sql` — path-only
- `supabase/migrations/20260828130000_safe_trainer_disconnect.sql` — path-only
- `supabase/migrations/20260828160000_safe_trainer_reconnect.sql` — path-only
- `supabase/migrations/20260828170000_safe_trainer_reconnect_registration.sql` — path-only
- `supabase/migrations/20260829010000_monochrome_preview_feature_flag.sql` — path-only
- `supabase/migrations/20260829210000_goal_criteria_foundation.sql` — path-only
- `supabase/migrations/20260829220000_client_goal_self_service.sql` — path-only
- `supabase/migrations/20260830010000_standard_goal_progress.sql` — path-only
- `supabase/migrations/20260830020000_extended_goal_criteria.sql` — path-only
- `supabase/migrations/20260830030000_client_custom_metric_self_service.sql` — path-only
- `supabase/migrations/20260830130000_retire_ui_identity_preview.sql` — path-only
- `supabase/migrations/20260830140000_push_workout_scheduled_notification.sql` — path-only
- `supabase/migrations/20260830150000_fix_push_dispatch_group_by.sql` — path-only
- `supabase/migrations/20260830160000_push_dispatch_custom_header.sql` — path-only
- `supabase/migrations/20260902180000_reconcile_disconnected_trainer_memberships.sql` — path-only
- `supabase/migrations/20260903010000_client_custom_exercise_self_service.sql` — path-only
- `supabase/migrations/20260903120000_disconnect_selected_trainer.sql` — path-only
- `supabase/migrations/20260904090000_workout_exercise_removal.sql` — path-only
- `supabase/migrations/20260905010000_completed_workout_exercise_removal.sql` — path-only
- `supabase/migrations/20260906090000_analytics_client_overview_workout_counts.sql` — path-only
- `supabase/migrations/20260906120000_analytics_client_overview_status.sql` — path-only
- `supabase/migrations/20260906130000_push_notification_url_field.sql` — path-only
- `supabase/migrations/20260907090000_push_subscriptions_multi_device.sql` — path-only
- `supabase/migrations/20260907120000_push_test_notification.sql` — path-only
- `supabase/migrations/20260907130000_vital_exercise_media_bucket.sql` — path-only
- `supabase/migrations/20260907140000_analytics_trainer_overview_membership.sql` — path-only
- `supabase/migrations/20260908090000_personal_record_requires_history.sql` — path-only
- `supabase/migrations/20260909010000_live_client_exercise_note.sql` — path-only
- `supabase/migrations/20260909020000_legal_acceptance_and_account_deletion.sql` — path-only
- `supabase/migrations/20260910120000_trainer_professional_profiles.sql` — path-only
- `supabase/migrations/20260910130000_trainer_catalog.sql` — path-only
- `supabase/migrations/20260910140000_analytics_trainer_overview_activity_breakdown.sql` — path-only
- `supabase/migrations/20260910150000_reliable_chat.sql` — L208
- `supabase/migrations/20260910230000_replace_started_live_exercise.sql` — path-only
- `supabase/migrations/20260911000000_analytics_trainer_overview_weekly_metrics.sql` — path-only
- `supabase/migrations/20260911010000_analytics_client_overview_activity_breakdown.sql` — path-only
- `supabase/migrations/20260911100000_chat_photo_attachments.sql` — path-only
- `supabase/migrations/20260911130000_chat_message_deletion.sql` — path-only
- `supabase/migrations/20260911170000_chat_productivity.sql` — path-only
- `supabase/migrations/20260912100000_trainer_discovery_prompt.sql` — path-only
- `supabase/migrations/20260912113000_public_trainer_chat_security.sql` — path-only
- `supabase/migrations/20260912120000_training_summary_generation_guard.sql` — path-only
- `supabase/migrations/20260912150000_chat_connection_invitation.sql` — path-only
- `supabase/migrations/20260912160000_training_summary_client_cache.sql` — path-only
- `supabase/migrations/20260912170000_trainer_profile_publish_catalog_default.sql` — path-only
- `supabase/migrations/20260913090000_trainer_profile_minimal_publication.sql` — path-only
- `supabase/migrations/20260913120000_trainer_connection_source_of_truth.sql` — path-only
- `supabase/migrations/20260913130000_trainer_catalog_pagination.sql` — path-only
- `supabase/migrations/20260913140000_analytics_client_overview_completed_workout_activity.sql` — path-only
- `supabase/migrations/20260914140000_reload_training_summary_rpc_schema.sql` — path-only
- `supabase/migrations/20260914150000_snapshot_cross_partition_custom_exercises.sql` — path-only
- `supabase/migrations/20260914160000_fix_training_summary_service_role_rpcs.sql` — path-only
- `supabase/migrations/20260914214119_yandex_chat_media_bridge.sql` — path-only
- `supabase/migrations/20260915170000_retry_failed_training_summary_generation.sql` — path-only
- `supabase/migrations/20260915173000_trainer_profile_metro_filter.sql` — path-only
- `supabase/migrations/20260915195509_assistant_program_pilot.sql` — path-only
- `supabase/migrations/20260915233000_allow_changed_summary_input_retry.sql` — path-only
- `supabase/migrations/20260916200000_custom_exercise_classification_and_media.sql` — path-only
- `supabase/migrations/20260916210000_assistant_program_generation_jobs.sql` — path-only
- `supabase/migrations/20260916220000_release_failed_program_generation.sql` — path-only
- `supabase/migrations/20260916230000_training_program_feedback.sql` — path-only
- `supabase/migrations/20260917120000_client_assistant_access.sql` — path-only
- `supabase/migrations/20260917130000_trainer_profile_brand_flag.sql` — path-only
- `supabase/migrations/20260917150000_client_assistant_programs.sql` — path-only
- `supabase/migrations/20260918090000_live_cross_partition_custom_exercises.sql` — path-only
- `supabase/migrations/20260918100000_workout_feedback_optional_note.sql` — path-only
- `supabase/migrations/20260918110000_client_list_archive_permission.sql` — path-only
- `supabase/migrations/20260918150000_client_assistant_program_generation_jobs.sql` — path-only
- `supabase/migrations/20260918173000_active_trainer_client_profile_edit.sql` — path-only
- `supabase/migrations/20260918190000_workout_execution_actors.sql` — path-only
- `supabase/migrations/20260918220000_invitation_links.sql` — path-only
- `supabase/migrations/20260919120000_trainer_catalog_specialties_filter.sql` — path-only
- `supabase/migrations/20260919140000_source_cutover_write_gate.sql` — path-only
- `supabase/migrations/20260919145000_source_cutover_migration_window.sql` — path-only
- `supabase/migrations/20260919150000_trainer_catalog_brand_filter.sql` — path-only
- `supabase/migrations/20260919160000_tenant_migration_trigger_guard.sql` — path-only
- `supabase/migrations/20260919170000_favorite_workouts.sql` — path-only
- `supabase/migrations/20260920120000_workout_calorie_estimate.sql` — path-only
- `supabase/migrations/20260922120000_quick_own_client_recovery.sql` — path-only
- `supabase/migrations/20260922130000_workout_origin_status.sql` — path-only
- `supabase/migrations/20260922140000_favorite_workout_title_snapshot.sql` — path-only
- `supabase/migrations/20260923150000_trainer_catalog_brand_sort.sql` — path-only
- `supabase/migrations/20260925062000_trainer_schedule_v2_pilot.sql` — path-only
- `supabase/migrations/20260925070000_close_source_cutover_migration_window.sql` — L32
- `supabase/migrations/20260925080000_trainer_schedule_v2_pilot_root_repair.sql` — path-only
- `supabase/migrations/20260925090000_trainer_schedule_v2_pilot_role_repair.sql` — path-only
- `supabase/migrations/20260925122500_reopen_source_cutover_migration_window.sql` — path-only
- `supabase/migrations/20260925123000_correct_exercise_input_kinds.sql` — path-only
- `supabase/migrations/20260925130000_trainer_schedule_v2_two_account_pilot.sql` — path-only
- `supabase/migrations/20260925131000_close_source_cutover_backfill_window.sql` — path-only
- `supabase/migrations/20260925190500_reopen_source_cutover_metric_audit_window.sql` — path-only
- `supabase/migrations/20260925191000_apply_exercise_metric_audit.sql` — path-only
- `supabase/migrations/20260925191500_close_source_cutover_metric_audit_window.sql` — path-only
- `supabase/migrations/20260928090000_domain_change_push_announcement.sql` — path-only
- `supabase/migrations/20260928133000_update_domain_change_push_copy.sql` — path-only
- `supabase/migrations/20260929120000_trainer_workout_templates.sql` — path-only
- `supabase/migrations/20261006120000_assistant_single_workout_schedule.sql` — path-only

### lockfiles (2)

- `package-lock.json` — L23, 52, 1627, 1629, 1639 (+44)
- `services/api/package-lock.json` — L13, 1072, 1074, 1084, 1086 (+16)

### native-db-history-compatibility (11)

- `services/api/db/migrations/000004_yandex_identity_rollout.sql` — L26
- `services/api/db/migrations/000020_atomic_client_attach.sql` — L11
- `services/api/db/migrations/000038_push_subscriptions_multi_device.sql` — L4
- `services/api/db/migrations/000062_custom_exercise_classification_and_media.sql` — L3
- `services/api/db/migrations/000063_trainer_profile_brand_flag.sql` — L5, 10
- `services/api/db/migrations/000075_assistant_program_generation_jobs.sql` — L111
- `services/api/db/migrations/000080_analytics_overview_parity.sql` — L5, 7, 10, 12, 15 (+2)
- `services/api/db/migrations/000087_workout_origin_status.sql` — L3
- `services/api/db/migrations/000088_favorite_workout_title_snapshot.sql` — L4
- `services/api/db/migrations/000124_assistant_single_workout_schedule.sql` — L3
- `services/api/db/migrations/000132_workout_prep_seconds.sql` — L5

### root-config-and-other (9)

- `.env.development` — L2, 3
- `.env.example` — L1, 2, 3, 23, 25 (+1)
- `.gitattributes` — L1, 2
- `.gitignore` — L154, 155, 156
- `eslint.config.js` — L7, 35, 36, 46, 47
- `index.html` — L21, 28
- `package.json` — L19, 20, 21, 22, 23 (+3)
- `services/legacy-api-proxy/server.mjs` — L8
- `vite.config.ts` — L61

### scripts-tests (21)

- `scripts/check-ios-production-env.test.mjs` — L10, 13, 14, 29, 31
- `scripts/check-yandex-terraform-plan.test.mjs` — L204, 208
- `scripts/ci-workflow.test.mjs` — L14, 20, 91, 108, 133 (+17)
- `scripts/cloudru-stabilization-workflows.test.mjs` — L294
- `scripts/configure-cloudru-ai.test.mjs` — L26, 27
- `scripts/deploy-yandex-frontend.test.mjs` — L469
- `scripts/deploy-yandex-stage-workflow.test.mjs` — L214, 265, 520, 543, 544 (+8)
- `scripts/e2e-scope.test.mjs` — L46, 50
- `scripts/fit-lime-ci-scope.test.mjs` — L48
- `scripts/inspect-nutrition-pilot.test.mjs` — L47, 96, 99, 106
- `scripts/lime-rollout-client-workflow.test.mjs` — L21
- `scripts/lime-rollout-trainer-workflow.test.mjs` — L22
- `scripts/mirror-yandex-legacy-supabase-bridge.test.mjs` — L8, 11, 13, 14, 15 (+4)
- `scripts/prepare-cloudru-frontend.test.mjs` — L212
- `scripts/prepare-yandex-frontend.test.mjs` — L68
- `scripts/query-supabase-auth-logs.test.mjs` — L3, 45
- `scripts/read-cloudru-external-credentials.test.mjs` — L13, 18, 33
- `scripts/remote-tenant-rehearsal-workflow.test.mjs` — L22, 35, 68, 87, 88 (+3)
- `scripts/supabase-database-scope.test.mjs` — L4, 8, 9, 10, 11 (+8)
- `scripts/wait-for-local-auth.test.mjs` — L6, 7, 31, 32, 70
- `scripts/yandex-lockbox-mounts.test.mjs` — L55, 67, 80

### scripts-tooling (13)

- `scripts/check-db-types.mjs` — L4
- `scripts/check-migrations.mjs` — L5
- `scripts/check-yandex-terraform-plan.mjs` — L54, 55, 604
- `scripts/cloudru-account-history-audit.mjs` — L125, 129, 260, 261
- `scripts/e2e-scope.mjs` — L39
- `scripts/inspect-nutrition-pilot.mjs` — L89, 107, 113
- `scripts/mirror-yandex-legacy-supabase-bridge.mjs` — L7, 41, 42, 46, 57 (+7)
- `scripts/query-supabase-auth-logs.mjs` — L74, 75, 88, 92, 94 (+2)
- `scripts/read-cloudru-external-credentials.mjs` — L5
- `scripts/run-local-stack.mjs` — L55, 56, 58, 60, 61 (+2)
- `scripts/run-local-tenant-rehearsal.mjs` — L16
- `scripts/supabase-database-scope.mjs` — L6, 7, 10, 14, 15 (+3)
- `scripts/wait-for-local-auth.mjs` — L19, 20, 21, 23, 27 (+5)

## Приложение B. Дополнительные протокольные файлы (37)

Проход дополняет буквальный поиск. Например, `yandex-only-auth.webkit.spec.ts` и `native-composition.test.tsx` — negative guards; `/auth/v1` в тесте не всегда означает реальный внешний запрос.

- `e2e/auth-identity.webkit.spec.ts` — L148, 258
- `e2e/auth.spec.ts` — L435
- `e2e/client-progress.spec.ts` — L12, 196, 209, 216, 219
- `e2e/client-swipe.spec.ts` — L11, 46, 57
- `e2e/client-workout-calendar.webkit.spec.ts` — L36, 86, 98, 99, 100 (+15)
- `e2e/favorite-workouts.spec.ts` — L69
- `e2e/maintenance-mode.webkit.spec.ts` — L13, 14
- `e2e/mobile-shell.webkit.spec.ts` — L28, 60, 147, 159, 168 (+20)
- `e2e/progress-results-fixture.ts` — L46, 52, 57, 62
- `e2e/results-center.webkit.spec.ts` — L6
- `e2e/trainer-catalog.webkit.spec.ts` — L12
- `e2e/trainer-flow.spec.ts` — L102, 568, 1378, 1390, 1398 (+3)
- `e2e/trainer-photo-viewer.webkit.spec.ts` — L21
- `e2e/trainer-professional-profile.spec.ts` — L194
- `e2e/trainer-profile-identity.webkit.spec.ts` — L10
- `e2e/trainer-schedule-identity.spec.ts` — L72, 117
- `e2e/trainer-workout-review.webkit.spec.ts` — L17, 26
- `e2e/ui-visual.spec.ts` — L354, 361, 379, 386, 390 (+45)
- `e2e/workout-copy-names.cases.ts` — L44, 50, 56, 58, 61
- `e2e/workout-feedback-coach-state.webkit.spec.ts` — L139, 143
- `e2e/workout-templates.spec.ts` — L9, 44, 59
- `e2e/yandex-only-auth.webkit.spec.ts` — L709
- `scripts/cloudru-account-history-audit.mjs` — L130, 132, 134
- `scripts/inspect-nutrition-pilot.mjs` — L113
- `scripts/query-supabase-auth-logs.mjs` — L28
- `scripts/wait-for-local-auth.mjs` — L23
- `scripts/wait-for-local-auth.test.mjs` — L6, 20, 54
- `src/app/auth-context.tsx` — L4
- `src/app/data-backend-context.tsx` — L1
- `src/app/native-composition.test.tsx` — L7
- `src/data/queries/auth-fetch.test.ts` — L16, 30, 42
- `src/data/queries/auth-fetch.ts` — L28, 33
- `src/data/queries/client.test.ts` — L15, 38
- `src/data/queries/client.ts` — L16
- `src/data/queries/supabase-environment.test.ts` — L5
- `src/features/auth/AuthPages.tsx` — L4
- `src/features/workouts/llm-workout-parser.ts` — L1

## Приложение C. Дополнительные type/import consumers

Только пути вне A/B; включает консервативную transitive closure и `database.types` references. Это **impact set**, не список удаления: type-only/native/UI модули сохраняются или меняют импорт. Все 248 reverse paths покрыты union A/B/C.

- `docs/design/trainer-workout-review.md`
- `e2e/client-payment-info-harness.tsx`
- `e2e/finance-client-harness.tsx`
- `e2e/finance-overview-harness.tsx`
- `e2e/workout-decimal-weight-harness.tsx`
- `e2e/workout-decimal-weight.webkit.spec.ts`
- `e2e/workout-load-fields-harness.tsx`
- `e2e/workout-time-distance-harness.tsx`
- `services/api/src/invitation-links-api.test.ts`
- `services/api/src/live-move.test.ts`
- `services/api/src/media-migration.test.ts`
- `services/api/src/workout-templates.app.test.ts`
- `src/app/App.tsx`
- `src/app/AppLayout.test.tsx`
- `src/app/AppLayout.tsx`
- `src/app/AppRoot.tsx`
- `src/app/canonical-client-route.tsx`
- `src/app/local-auth-composition.ts`
- `src/app/maintenance-mode.test.tsx`
- `src/app/native-only-composition.ts`
- `src/app/use-client-realtime.test.tsx`
- `src/app/use-client-realtime.ts`
- `src/data/queries/json.ts`
- `src/data/repositories/app-feedback.repository.test.ts`
- `src/data/repositories/app-feedback.repository.ts`
- `src/data/repositories/athlete-sport-profile.repository.ts`
- `src/data/repositories/chat.repository.test.ts`
- `src/data/repositories/chat.repository.ts`
- `src/data/repositories/clients.repository.ts`
- `src/data/repositories/exercise-progress-page.ts`
- `src/data/repositories/exercises.repository.test.ts`
- `src/data/repositories/exercises.repository.ts`
- `src/data/repositories/favorite-workouts.repository.test.ts`
- `src/data/repositories/goals.repository.test.ts`
- `src/data/repositories/goals.repository.ts`
- `src/data/repositories/invitations.repository.test.ts`
- `src/data/repositories/invitations.repository.ts`
- `src/data/repositories/nutrition.repository.test.ts`
- `src/data/repositories/progress.repository.test.ts`
- `src/data/repositories/progress.repository.ts`
- `src/data/repositories/public-invitation-links.repository.ts`
- `src/data/repositories/public-trainer-profile.repository.ts`
- `src/data/repositories/push-notifications.repository.ts`
- `src/data/repositories/realtime.repository.ts`
- `src/data/repositories/trainer-discovery.repository.test.ts`
- `src/data/repositories/training-summaries.repository.test.ts`
- `src/data/repositories/training-summary-mappers.ts`
- `src/data/repositories/workout-templates.repository.test.ts`
- `src/data/repositories/workout-templates.repository.ts`
- `src/data/repositories/workouts.repository.progress.test.ts`
- `src/data/repositories/workouts.repository.test.ts`
- `src/data/repositories/yandex-assistant.repository.ts`
- `src/features/achievements/AthleteAchievements.test.tsx`
- `src/features/achievements/AthleteAchievements.tsx`
- `src/features/assistant/AssistantHistoryPage.test.tsx`
- `src/features/assistant/AssistantHistoryPage.tsx`
- `src/features/assistant/AssistantProgramPilotCard.test.tsx`
- `src/features/assistant/AssistantProgramPilotCard.tsx`
- `src/features/assistant/AssistantWorkoutDraftSurface.test.tsx`
- `src/features/assistant/AssistantWorkoutDraftSurface.tsx`
- `src/features/assistant/ProgramFeedbackForm.test.tsx`
- `src/features/assistant/ProgramFeedbackForm.tsx`
- `src/features/assistant/index.ts`
- `src/features/assistant/program-draft.test.ts`
- `src/features/assistant/program-draft.ts`
- `src/features/assistant/workout-draft.ts`
- `src/features/auth/AuthPages.password.test.tsx`
- `src/features/auth/AuthPages.yandex-app-session.test.tsx`
- `src/features/auth/AuthPages.yandex.test.tsx`
- `src/features/auth/InvitationPage.tsx`
- `src/features/auth/InvitationShareActions.tsx`
- `src/features/auth/JoinPage.tsx`
- `src/features/auth/index.ts`
- `src/features/chat/ChatEntry.tsx`
- `src/features/chat/ChatPages.test.tsx`
- `src/features/chat/ChatPages.tsx`
- `src/features/chat/index.ts`
- `src/features/chat/use-chat-threads.ts`
- `src/features/clients/ClientFormPage.test.tsx`
- `src/features/clients/ClientPortalPages.tsx`
- `src/features/clients/ClientProfilePage.test.tsx`
- `src/features/clients/ClientProfilePage.tsx`
- `src/features/clients/ClientTrainerConnections.test.tsx`
- `src/features/clients/ClientTrainerConnections.tsx`
- `src/features/clients/ClientWorkoutHistoryCalendar.test.tsx`
- `src/features/clients/ClientWorkoutHistoryCalendar.tsx`
- `src/features/clients/ClientsListPage.tsx`
- `src/features/clients/ClientsPage.test.tsx`
- `src/features/clients/ClientsPages.test.tsx`
- `src/features/clients/ClientsPages.tsx`
- `src/features/clients/GoalPages.test.tsx`
- `src/features/clients/GoalPages.tsx`
- `src/features/clients/TrainerDiscoveryHomeCard.test.tsx`
- `src/features/clients/TrainerDiscoveryHomeCard.tsx`
- `src/features/clients/index.ts`
- `src/features/contest/ContestWinnerDialog.test.tsx`
- `src/features/contest/ContestWinnerDialog.tsx`
- `src/features/contest/index.ts`
- `src/features/exercises/ExerciseImage.tsx`
- `src/features/exercises/ExercisePicker.test.tsx`
- `src/features/exercises/ExercisePicker.tsx`
- `src/features/exercises/ExerciseTechnique.test.tsx`
- `src/features/exercises/ExerciseTechnique.tsx`
- `src/features/exercises/ExerciseThumbnail.test.tsx`
- `src/features/exercises/ExerciseThumbnail.tsx`
- `src/features/exercises/ExercisesPage.tsx`
- `src/features/exercises/custom-exercise-photo.test.ts`
- `src/features/exercises/custom-exercise-photo.ts`
- `src/features/exercises/exercise-catalog.test.ts`
- `src/features/exercises/exercise-catalog.ts`
- `src/features/exercises/index.ts`
- `src/features/exercises/selectable-exercises.test.ts`
- `src/features/finance/ClientFinancePage.test.tsx`
- `src/features/finance/ClientFinancePage.tsx`
- `src/features/finance/TrainerFinanceOverviewPage.test.tsx`
- `src/features/finance/TrainerFinanceOverviewPage.tsx`
- `src/features/finance/TrainerFinancePage.test.tsx`
- `src/features/finance/TrainerFinancePage.tsx`
- `src/features/finance/index.ts`
- `src/features/legal/LegalPages.tsx`
- `src/features/legal/index.ts`
- `src/features/notifications/NotificationOnboarding.test.tsx`
- `src/features/notifications/NotificationsSetting.test.tsx`
- `src/features/notifications/NotificationsSetting.tsx`
- `src/features/notifications/index.ts`
- `src/features/nutrition/NutritionPage.test.tsx`
- `src/features/nutrition/NutritionPage.tsx`
- `src/features/nutrition/index.ts`
- `src/features/profile/AppFeedbackForm.test.tsx`
- `src/features/profile/AppFeedbackForm.tsx`
- `src/features/profile/ProfilePage.test.tsx`
- `src/features/profile/ProfilePage.tsx`
- `src/features/profile/PublicTrainerProfilePage.test.tsx`
- `src/features/profile/PublicTrainerProfilePage.tsx`
- `src/features/profile/TrainerCatalogPage.test.tsx`
- `src/features/profile/TrainerCatalogPage.tsx`
- `src/features/profile/TrainerProfileEditorPage.test.tsx`
- `src/features/profile/TrainerProfileEditorPage.tsx`
- `src/features/profile/index.ts`
- `src/features/progress/ProgressPages.test.tsx`
- `src/features/progress/ProgressPages.tsx`
- `src/features/progress/RunningProgressCard.test.tsx`
- `src/features/progress/RunningProgressCard.tsx`
- `src/features/progress/TrainerProgressOverviewCard.test.tsx`
- `src/features/progress/TrainerProgressOverviewCard.tsx`
- `src/features/progress/TrainingSummaryCard.test.tsx`
- `src/features/progress/TrainingSummaryCard.tsx`
- `src/features/progress/WorkoutRegularityCard.test.tsx`
- `src/features/progress/WorkoutRegularityCard.tsx`
- `src/features/progress/index.ts`
- `src/features/workout-templates/FavoriteWorkoutEditorPage.test.tsx`
- `src/features/workout-templates/FavoriteWorkoutEditorPage.tsx`
- `src/features/workout-templates/WorkoutTemplatesPages.test.tsx`
- `src/features/workout-templates/WorkoutTemplatesPages.tsx`
- `src/features/workout-templates/index.ts`
- `src/features/workouts/ClientHomeOverview.test.tsx`
- `src/features/workouts/ClientHomeOverview.tsx`
- `src/features/workouts/CoachPlanEditor.test.tsx`
- `src/features/workouts/FitLimePlanComposer.tsx`
- `src/features/workouts/FitLimeWorkoutEntry.tsx`
- `src/features/workouts/LiveExerciseTechnique.test.tsx`
- `src/features/workouts/LiveExerciseTechnique.tsx`
- `src/features/workouts/QuickStartWorkout.test.tsx`
- `src/features/workouts/QuickStartWorkout.tsx`
- `src/features/workouts/QuickWorkoutEntry.test.tsx`
- `src/features/workouts/QuickWorkoutEntry.tsx`
- `src/features/workouts/TodayPage.tsx`
- `src/features/workouts/WorkoutCompletionReport.test.tsx`
- `src/features/workouts/WorkoutCompletionReport.tsx`
- `src/features/workouts/WorkoutExerciseEditor.test.tsx`
- `src/features/workouts/WorkoutExerciseEditor.tsx`
- `src/features/workouts/WorkoutsPages.tsx`
- `src/features/workouts/index.ts`
- `src/features/workouts/llm-workout-parser.test.ts`
- `src/features/workouts/use-trainer-workspace.ts`
- `src/main.tsx`

## Приложение D. Полный source migration subtree (23)

Пути могут повторяться с A/C. Для каждого требуется решение archive/extract/keep; neutral fingerprint helpers имеют native callers, удалять каталог одним действием нельзя.

- `services/api/src/tenant-migration/bundle.test.ts`
- `services/api/src/tenant-migration/bundle.ts`
- `services/api/src/tenant-migration/catalog.test.ts`
- `services/api/src/tenant-migration/catalog.ts`
- `services/api/src/tenant-migration/cli-options.test.ts`
- `services/api/src/tenant-migration/cli-options.ts`
- `services/api/src/tenant-migration/cli.ts`
- `services/api/src/tenant-migration/engine.test.ts`
- `services/api/src/tenant-migration/engine.ts`
- `services/api/src/tenant-migration/media-verifier.test.ts`
- `services/api/src/tenant-migration/media-verifier.ts`
- `services/api/src/tenant-migration/rehearsal-source-fixture.sql`
- `services/api/src/tenant-migration/remote-rehearsal-cli.ts`
- `services/api/src/tenant-migration/remote-rehearsal.test.ts`
- `services/api/src/tenant-migration/remote-rehearsal.ts`
- `services/api/src/tenant-migration/source-cutover-write-gate-cli.ts`
- `services/api/src/tenant-migration/source-cutover-write-gate.test.ts`
- `services/api/src/tenant-migration/source-cutover-write-gate.ts`
- `services/api/src/tenant-migration/stage-runner.test.ts`
- `services/api/src/tenant-migration/stage-runner.ts`
- `services/api/src/tenant-migration/transport.test.ts`
- `services/api/src/tenant-migration/transport.ts`
- `services/api/src/tenant-migration/types.ts`

## Ограничение полноты

Реестр исчерпывает описанный **tracked baseline** и выявленные связи, включая непрямые пути без literal Supabase. Он не выдаёт недоступный remote inventory за проверенный факт. Динамически вычисленные import/URL, внешние automation, неучтённые проекты и старые установленные приложения закрываются P0 и network-deny/production observation gates. При новом найденном reader обновляется существующий S-ID и его acceptance, а не начинается бесконечная серия несвязанных cleanup-задач.
