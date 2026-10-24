# Supabase P0 — фактические ресурсы, данные и потребители, 24.10.2026

Статус: **read-only аудит доступного Supabase и GitHub выполнен; P0 целиком ещё не закрыт**. Ничего не выключено, не перенесено и не удалено. Решения о судьбе исторических данных, old-client sunset и retention не принимались за владельца.

Исходники: `main/96723f260662843d237be2639e9479ef22c4a248`. Родительский [план P0–P6](https://github.com/podkolzinpd/fit/blob/94cf8607637a8a86c544bd3d71dd25dfaa97f11d/docs/design/SUPABASE_DECOMMISSION_PLAN_20261023.md) и [инвентарь](https://github.com/podkolzinpd/fit/blob/94cf8607637a8a86c544bd3d71dd25dfaa97f11d/docs/design/SUPABASE_REMAINING_INVENTORY_20261023.md) находятся в отдельном [PR1793](https://github.com/podkolzinpd/fit/pull/1793); на момент начала P0 он открыт. Этот отчёт уточняет факты и оценки, не переписывает acceptance родительского плана.

## Прямой запрос

> Давай начнём первый этап: проверь реальные ресурсы Supabase, остатки данных и потребителей. Пока ничего не отключаем, по результатам уточни блокеры и сроки.

## Preflight и способ проверки

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
|---|---|---|---|
| CLI авторизован штатно; source write gate включён; native production frontend доступен | Supabase CLI Management API SQL, существующий S3 audit workflow, GitHub metadata | Только этот отчёт и CURRENT_STATE | Native DB/reference reconciliation, remote env/Lockbox/revisions, request logs/старые клиенты, независимый source restore |

- Локальный глобальный Supabase CLI `2.109.1` использует существующую авторизацию. Не читались `.env.local`, token files, keychain entries, secret values. GitHub secrets проверены только по именам.
- Каждая SQL проверка обёрнута в `BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; …; COMMIT;`. Probe подтвердил `transaction_read_only=on`. Это Management API чтение, не локальные тесты против production-БД.
- Временный isolated workdir содержит только project-ref и минимальный CLI config, удаляется после команды. Запросы возвращают aggregate counts и schema/resource metadata. Не выгружались DB rows, object paths/bytes, сообщения, контакты, identities, IP/user agents, decrypted Vault secrets или function bodies.
- Source наблюдения выполнены 23–24 октября UTC; GitHub/public frontend/native audit — 24 октября. Это несколько ограниченных read-only транзакций, **не единый согласованный DB snapshot**. Окно «7d» относится ко времени конкретного запроса.
- В stdout/отчёт попали только allowlisted metadata и агрегаты. Неуспешные/недоступные пробы не трактуются как ноль. CLI timeout на части metadata был повторён ограниченно; успешные результаты ниже отделены от отсутствующих.
- Внешние действия: GET/list/query; один `workflow_dispatch` существующего `migrate-yandex-media-to-cloudru.yml` с **mode=audit**. Код проверен: только LIST источника/цели, без PUT/ACL/bootstrap в этой ветке. Файлы, DB, runtime config, secret values и permissions не менялись. Workflow создаёт обычную Actions-квитанцию; это не deployment.

## Проверенный source resource registry

| Ресурс | Фактическое состояние | Значение для decommission |
|---|---|---|
| Доступные проекты | 2: один INACTIVE/eu-north-1 без Fit name match, один ACTIVE_HEALTHY/eu-west-1 с Fit name/schema match | Аудирован только подтверждённый активный Fit. Второй проект не возобновлялся и не читался; его принадлежность/retention не установлены |
| Database | 94 522 515 bytes при первом probe; 202 applied Supabase migrations; 16 089 строк в public business tables | Источник не пуст; нет основания удалять его без независимого архива и проверки native истории |
| Auth | 170 users, 172 identities, 188 sessions, 409 refresh tokens | Это числа, без identifiers/контактов; не доказательство, что identities отсутствуют в native |
| Source write gate | `writes_paused=true` | Product writes ограждены, но не все background tasks остановлены |
| Storage | 3 private buckets, versioning DISABLED, 2014 objects / 71 913 069 bytes | Малый объём, но ссылки/целостность и native наличие ещё требуют доказательства |
| Edge Functions | `parse-workout`: ACTIVE/version8; `summarize-client-training`: ACTIVE/version30; у обеих `verify_jwt=false` | Удаление исходников/deploy из Git не удалило deployed functions. Не вызывались; AI credentials/трафик/отключение — отдельные gates |
| Edge secret metadata | 10 имён, перечислены ниже | Значения не читались/не отзывались; нельзя удалить общий native AI secret по совпадению имени |
| Cron | 8 jobs, **все active=true** | Есть самостоятельные producers/consumers даже при paused product writes |
| Vault | 5 secret entries | Только count; ключи/значения и readers этих записей пока не сверены полностью |
| pg_net | Worker работает; queue=0 и 3 retained HTTP responses в момент чтения | Пустая очередь — моментный срез, не доказательство отсутствия будущих HTTP sends |
| Realtime | 14 published tables; replication slots=0 в момент чтения | Publication остаётся; отсутствие слотов не доказывает отсутствие старых клиентов |
| DB integrations | 0 foreign servers, 0 pg_subscriptions, 0 direct HTTP triggers по catalog-предикату | Не закрывает hooks/HTTP calls из вложенных routines и внешние automation |
| Storage policies | 6 policies | Сохраняются без изменений |
| Provider backup metadata | `pitr_enabled=false`, `walg_enabled=true`, `backups=null`, physical metadata не содержит restore evidence | `null` **не** равно «0 backups»; свежий независимо восстановимый source archive не доказан |
| Preview branches / domain | Branch list пуст; domain get не дал пригодного результата | Empty branches подтверждены; custom domain статус остаётся неизвестным |

Extensions: `pg_cron 1.6.4`, `pg_net 0.20.4`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`. DB statistics reset — 15.07.2026: cumulative counters с того дня нельзя выдавать за последние 7 суток.

Edge secret **names**: `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YANDEX_CLOUD_API_KEY`, `YANDEX_CLOUD_FOLDER_ID`, `YANDEX_CLOUD_MODEL_ID`. Не проверено, какие из них default managed и какие фактически используются каждым deployed handler.

## Media: не объём, а сверка ссылок

| Bucket | Objects | Bytes | References в source DB | Source exact-key missing | Source objects без соответствующей DB ссылки |
|---|---:|---:|---:|---:|---:|
| chat-media | 2 | 276 932 | 5 distinct undeleted image paths | **3** | 0 |
| custom-exercise-media | 2 | 121 707 | 2 unarchived exercise image paths | 0 | 0 |
| fit-exercise-media | 2010 | 71 514 430 | Каталожный manifest/asset contract, здесь не пересчитан | Не проверено | Не классифицировано |

Все пять chat paths относительные: не URL, без leading slash и bucket prefix. Это исключает эти простые причины exact-key расхождения, **но не доказывает потерю**: три отсутствующих source object могли сохраниться в Yandex/Cloud.ru; требуется адресная сверка. Имена/пути объектов не выгружались.

В Storage за наблюдаемое окно 7d: created/updated/accessed counts = 0; archived/delete markers = 0. `last_accessed_at=0 recent` не является надёжным доказательством отсутствия downloads/CDN/cache reads: request logs не проверены.

В source `custom_exercises`: **128 unarchived records**, image refs=2, 101 distinct exercise участвует в 340 workout_exercise entries. Из двух упражнений с фото одно связано с одной записью workout_exercises. Это **историческое использование**, не опровержение решения владельца, что функция сейчас не используется. Нулевое историческое количество не подтвердилось; новые UI/custom CRUD создавать ради миграции не требуется. История должна остаться читаемой по принятому native/archive контракту.

Дополнительный media источник: 17 из 21 `trainer_professional_profiles` содержат inline `data:image/` в draft/published JSON; Supabase URL literal в них не найден. Эти изображения не входят в Storage count. Их native/архивная сохранность пока не сверена; rows/JSON/images не выгружались.

Оба инструмента имеют gap: `media-migration.ts` перечисляет только chat/Vital source buckets; `migrate-yandex-media-to-cloudru.mjs` смотрит prefixes chat/Vital/trainer-profile, без custom. Поэтому successful общий audit не закрывает две custom photos.

### Свежий native S3 audit

Read-only run: [40090051547](https://github.com/podkolzinpd/fit/actions/runs/40090051547), `mode=audit`, current main. Run success на `main/5101b25251631b2dcac796aca10be73416f8a97e`; relevant workflow/script с исходного baseline не менялись. Он сравнивает key/size листинги **Yandex S3 → Cloud.ru** по трём известным prefixes. Это не Supabase → Cloud.ru DB-reference mapping, не SHA256 readback и не доказательство сохранности DB-inline images.

Подтверждено: source=2100 objects / 77 256 815 bytes; target=2100 / 77 256 815 bytes; `pending=0`, mode audit, complete. Первый credential format дал403/InvalidAccessKeyId, второй штатный format успешно прочитал target; это предусмотренный fallback формата, не изменение credentials/ACL. Source и target не обязаны иметь 2014 objects из Supabase: native prefixes также включают trainer-profile и новые native files. По этому числу нельзя сопоставить конкретную source DB ссылку.

## Фоновые consumers и queues

| Active cron | Schedule | Запуски за 7d |
|---|---|---:|
| `enqueue-workout-reminders` | `*/5 * * * *` | 2016 failed |
| `notify-app-feedback-telegram` | `* * * * *` | 10080 succeeded |
| `refresh-analytics-app-feedback` | `*/15 * * * *` | 672 succeeded |
| `refresh-analytics-app-feedback-with-payloads` | `*/15 * * * *` | 672 succeeded |
| `refresh-analytics-client-overview` | `0 2,7,12,17,21 * * *` | 35 succeeded |
| `refresh-analytics-trainer-overview` | `0 2,7,12,17,21 * * *` | 35 succeeded |
| `refresh-analytics-trainers-metrics` | `0 2 * * *` | 7 succeeded |
| `sync-push-notifications` | `* * * * *` | 10080 succeeded |

Все 2016 failed reminders классифицированы SQL как `source_product_writes_paused`. Остальные successful cron runs **не доказывают внешнюю доставку**: вызванная routine может ничего не сделать. Direct target inspection не обнаружила literal HTTP/Vault в трёх прямых wrapper routines; вложенные calls/hook graph полностью не развёрнуты, их нельзя считать безопасно выключенными.

В фактических cron есть `refresh-analytics-app-feedback-with-payloads`, отсутствовавший среди восьми литеральных schedule names родительского поиска. `sync-app-feedback-tracker` из исторического поиска не найден среди активных jobs. Это конкретное уточнение S11, а не ещё одна новая неизвестная система.

`private.push_notifications_outbox`: 92 rows, **4 unsent**, из них 3 attempted; created/sent за 7d=0. Не отправлялись, не дренировались и не менялись. Нельзя перенести их в native sender и получить дубли без принятого решения/idempotency сверки.

## Остатки product data и ограниченные признаки активности

Точные агрегаты, не row estimates. Остальные таблицы приложены ниже.

- workouts=672, workout_exercises=3413, workout_sets=9137;
- clients=215, profiles=166, trainers=60;
- chat_conversations=25, chat_messages=37;
- assistant_conversations=111, assistant_messages=850, assistant_actions=24;
- training summaries=109, published summaries=60;
- custom_exercises=128; trainer_professional_profiles=21.

За 7d не обнаружено новых/изменённых source workouts/custom exercises, новых chat messages, новых Auth users, sign-ins, session refresh/updates. Это проверка этих timestamp columns, **не весь traffic/writes**: не покрывает все таблицы, SELECT/failed requests/Storage/CDN, старые APK и внешние automation. Writer gate и cron ошибки показывают, что background попытки записи существуют. Заявление «Supabase больше никто не использует» не подтверждено.

## Фактические GitHub consumers

Metadata прочитана 24.10, без запуска перечисленных workflows. `state=active` означает включённый workflow, не постоянно работающий runtime. Последний run не доказывает исполнение каждого условного secret reader.

| Workflow | State | Последний run / event / результат |
|---|---|---|
| `backup-cloudru-production.yml` | active | [40074648226](https://github.com/podkolzinpd/fit/actions/runs/40074648226) / schedule / failure / 2026-10-24T07:34:06Z |
| `ci.yml` | active | [40022839467](https://github.com/podkolzinpd/fit/actions/runs/40022839467) / pull_request / success / 2026-10-23T20:54:41Z |
| `deploy-database.yml` | active | [37442924642](https://github.com/podkolzinpd/fit/actions/runs/37442924642) / push / success / 2026-10-06T09:26:09Z |
| `deploy-yandex-assistant-orchestrator.yml` | disabled_manually | [38711706852](https://github.com/podkolzinpd/fit/actions/runs/38711706852) / push / cancelled / 2026-10-15T09:16:15Z |
| `deploy-yandex-stage.yml` | active | [39728695721](https://github.com/podkolzinpd/fit/actions/runs/39728695721) / push / success / 2026-10-22T05:33:21Z |
| `deploy-yandex-summary-function.yml` | disabled_manually | [38611484881](https://github.com/podkolzinpd/fit/actions/runs/38611484881) / push / success / 2026-10-14T18:00:30Z |
| `deploy-yandex-workout-parser.yml` | active | [38611484858](https://github.com/podkolzinpd/fit/actions/runs/38611484858) / push / success / 2026-10-14T18:00:30Z |
| `diagnose-supabase-auth.yml` | active | [35114165881](https://github.com/podkolzinpd/fit/actions/runs/35114165881) / workflow_dispatch / success / 2026-09-16T15:16:02Z |
| `inspect-cloudru-operations.yml` | active | [40083315434](https://github.com/podkolzinpd/fit/actions/runs/40083315434) / schedule / failure / 2026-10-24T09:46:58Z |
| `inspect-nutrition-pilot.yml` | active | [39421990475](https://github.com/podkolzinpd/fit/actions/runs/39421990475) / workflow_dispatch / failure / 2026-10-20T12:24:21Z |
| `manage-cloudru-recovery-push.yml` | active | [39110409366](https://github.com/podkolzinpd/fit/actions/runs/39110409366) / workflow_dispatch / success / 2026-10-18T08:10:12Z |
| `manage-supabase-cutover-write-gate.yml` | active | [38916499969](https://github.com/podkolzinpd/fit/actions/runs/38916499969) / workflow_dispatch / success / 2026-10-16T14:31:49Z |
| `manage-trainer-schedule-v2-pilot.yml` | active | [36137690396](https://github.com/podkolzinpd/fit/actions/runs/36137690396) / workflow_dispatch / failure / 2026-09-25T12:54:40Z |
| `migrate-yandex-media.yml` | active | [35219895298](https://github.com/podkolzinpd/fit/actions/runs/35219895298) / workflow_dispatch / failure / 2026-09-17T12:13:24Z |
| `rehearse-yandex-tenant-migration.yml` | active | [35466744381](https://github.com/podkolzinpd/fit/actions/runs/35466744381) / workflow_dispatch / success / 2026-09-19T20:13:55Z |

Подтверждены те же 5 Supabase secret instances: repository `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`; `fit-frontend-candidate`: `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`. В проверенных production/Preview/Production/yandex-stage environments Supabase names не найдены. Значения/permissions не менялись.

Два AI workflows фактически `disabled_manually`, parser workflow — active. Это не разрешение включать/удалять Yandex Cloud Functions: сохраняем существующее native AI поведение и shared AI keys. `deploy-yandex-stage` остаётся active, latest22.10 success; source code всё ещё содержит два credential mirror блока. Существующие remote mounts/Lockbox versions/IAM и старые revisions **не прочитаны**: metadata доступа в текущем окружении нет, CLI Yandex отсутствует. В GitHub не создавались новые cloud keys/OIDC permissions.

Публичный `https://fit-training.ru` ответил200; один найденный JS asset загружен без ошибок, markers `.supabase.co`, `VITE_SUPABASE`, `/auth/v1`, `/rest/v1` не найдены. Один `@supabase` literal — dependency entry embedded package.json (`@supabase/supabase-js`), **не SDK import evidence**. Это узкая статическая проверка текущего public entry, не authenticated smoke/всех маршрутов/request tracing/старых bundles. Отдельная browser Dashboard сессия Supabase не авторизована; новый login/ToS не выполнялись. CLI read-only доступ при этом работает.

## Свежий blocker backup/operations

24.10 [backup40074648226](https://github.com/podkolzinpd/fit/actions/runs/40074648226) — failure на `Verify private media after the database restore check`; safe error class403/permission denied и `cloudru_media_verification_failed`. Следовательно общая проверка backup+private media не зелёная. Нельзя из этого вывести, что DB backup отсутствует или данные потеряны: DB restore шаги и полный media/archive gate — разные доказательства.

[Operations40083315434](https://github.com/podkolzinpd/fit/actions/runs/40083315434) — failure в runtime/backup freshness и queue aggregate checks; safe metadata: `Result=exit-code`, `ExecMainStatus=1`, `workerFailed`. Точная причина здесь не исправлялась/не устанавливалась по raw production data. Никаких restart/ACL repairs/backup reruns не выполнено.

Это усиливает B06: старая успешная restore-квитанция не заменяет свежий полный gate. Не удалять fallback source раньше закрытия этого условия; при этом сам Supabase source не содержит новых Cloud.ru writes и не является обратной миграцией.

## Уточнённые blockers, owner и критерии закрытия

| Blocker | Что уточнено P0 | Осталось / следующий проверяемый результат | Ответственный |
|---|---|---|---|
| B01 resources/readers | Fit project/EF2/cron8/Vault5/Storage3/GitHub metadata подтверждены | Native service env presence, remote Lockbox/IAM/revisions, Auth/SMTP/hooks/вложенные HTTP/integrations; принадлежность второго проекта | Infrastructure owner + исполнитель |
| B02 media/data | 2014 objects/71.9MB; custom2, chat2; 3 chat refs не найдены в source; 17 inline profiles | Адресное native reference/byte/rights сравнение, история custom/inline media; zero missing либо owner-approved independent archive | Исполнитель + владелец данных |
| B03 contact/history ops | 170 source Auth users; служебные readers и workflows существуют | Закрыть ongoing history investigation; владелец выбирает retire или нужный neutral contact источник. Контакты не копировались | Владелец продукта/данных |
| B04 local/CI | Новых изменений runtime нет; прежний объём migration legacy coverage остаётся | P2/P3 assertion mapping, neutral DTO и native fixtures/PG-only local | Исполнитель |
| B05 old clients/traffic | 7d timestamp checks тихие; cron напоминает о writer attempts | Actual request logs/clients/version sunset; одобренное окно наблюдения. Нет request history → нет доказательства нуля consumers | Исполнитель + продуктовый владелец |
| B06 backup/rollback | Source PITR false/list null; свежие native backup/media и operations красные | Свежий полный backup/media/isolated restore gate, независимый source archive, retention, shutdown runbook | Infrastructure owner + владелец данных |

Ни один blocker не закрывается удалением файлов из Git. P0 имеет техническую доказательную часть, выполненную здесь, и access/owner/native-parity часть, ещё OPEN. Не переходить к физическому отключению по этой квитанции.

## Уточнение сроков

Исходная оценка плана — 13.5–22 рабочих дня + observation/pause. Исторический custom bucket **не нулевой**, но его остаток всего два файла; автоматически добавлять 2–4 дня на разработку новой пользовательской custom-функции оснований нет. Нужны сохранность истории и фото, а не новая UI-фича. 72MB не создают многодневного copy/egress объёма; длительность полного readback зависит от доступов/проверок, не только bytes.

| Оставшаяся работа | Рабочие дни | Условие |
|---|---:|---|
| Дозакрыть P0: remote env/readers, native reference census, owner решения | 0.5–1.5 | Доступ/операционные решения предоставлены штатно |
| P1 media + server bridge/fallback retirement | 1.5–3 | Три chat refs найдены либо явно решена их судьба; source/custom/inline сохранены |
| P2 native local composition/types | 3–5 | Без новых продуктовых функций |
| P3 fixtures/tests/CI/PG-only local | 4–6 | Сохранить уникальное покрытие/браузеры, без ослабления gates |
| P4 operations/IaC/secrets/packages | 2–3 | Contact/history и shared secret readers закрыты |
| P5 full rehearsal/backup/restore | 1–2 | Текущие failures устранены отдельной согласованной работой |
| P6 pause/verification/delete execution | 0.5–1 | Только после всех gates и разрешения |
| **Осталось** | **12.5–21.5** | Не включает ожидание доступа и внешние исправления |

Резерв **+1–3 дня**, если три missing-source ссылки требуют расследования/восстановления или fresh backup/media failures требуют доработки. Это условный резерв, не утверждение, что файлы потеряны. Ожидание доступа/истории/retention/старых клиентов не имеет честной даты до решения.

Календарный ориентир сохраняется: **около 4–7 недель**, включая предложенные 7 суток наблюдения и 24–48h обратимой остановки. Считать дату полного отключения утверждённой нельзя: P0 не закрыл native parity, backups и sunset. Окно/retention остаются предложением владельцу, в этом аудите не согласованы автоматически.

Ближайший единый пакет — завершить **native reconciliation media + свежий backup/operations evidence + remote reader metadata**. После него P1 может удалять bridge без догадок. Не начинать случайное удаление cron/functions/credentials в текущей задаче.

## Приёмка P0 по исходному плану

Ниже исходный текст P0 сохранён без сокращения; статусы добавлены отдельно.

1. Составить закрытый remote resource registry для B01: каждый проект, DB/Auth/Storage/Functions/cron/Vault/hooks/integrations, reader/service/workflow/revision, кто отвечает, keep/migrate/retire и этап. В публичный Git только имена компонентов и агрегаты, без contacts/IDs/secret values/payload.
2. Проверить source writes/queues и native feature coverage. Никакой повторный full-cohort import на nonempty Cloud.ru target: он не содержит актуальные native writes. Unresolved account history recovery — отдельный blocker, не разрешение новой миграции.
3. Для трёх media buckets сопоставить objects с references legacy/current БД, проверить orphan/missing/duplicate/version/bytes, старые URL и права обеих ролей. Объект без ссылки не удалять автоматически; определить retention. Zero-use custom проверить отдельно по records, references и objects.
4. Проверить только metadata секретов GitHub/Cloud.ru/Lockbox и потребителей: candidate2/repository3 уже найдены. У старого AI Lockbox active native keys; отсутствие Supabase mounts в трёх AI workflows не даёт права удалить весь secret.
5. Зафиксировать минимальную поддерживаемую web/mobile версию, порядок обновления/запрета старых клиентов и понятный fallback до sunset; проверить отдельные APK/OTA/iOS installs, не только latest web.
6. Согласовать B03 operations и B06 retention, финальное окно: предлагается 7 полных суток после последнего runtime удаления, затем 24–48h pause. Это предложенные сроки, не уже согласованная политика.

**Выход:** все B01–B06 имеют конкретный owner/доказательство или запланированную зависимость; source/target counts известны; оценка P1 уточнена. Если ресурс не доступен для проверки, он остаётся OPEN — отключение запрещено, независимый код можно продолжать.


| Пункт P0 | Статус | Доказательство / недостающая часть |
|---|---|---|
| 1. Remote registry | PARTIAL | Source и GitHub проверены; nested calls/remote env и второй project owner OPEN |
| 2. Source writes/queues/coverage | PARTIAL | Gate, exact counts, timestamps, queues/cron проверены; native/recovery completeness OPEN; import не запускался |
| 3. Media census | PARTIAL | Три buckets/source refs/custom/inline проверены; native reference/hash/ownership сравнение OPEN |
| 4. Secrets metadata | PARTIAL | GitHub names и Edge names/Vault count; remote mounts/IAM/versions OPEN |
| 5. Старые web/mobile clients | OPEN | Только current public entry marker scan; session traffic и minimum supported version не доказаны |
| 6. Operations/retention/window решения | OPEN | Выявлены blockers, решения владельца не подменяются этим аудитом |

## Точные source table counts (не экспорт данных)

| Relation | Rows |
|---|---:|
| `app_private.training_summary_generation_guards` | 8 |
| `auth.audit_log_entries` | 0 |
| `auth.custom_oauth_providers` | 0 |
| `auth.flow_state` | 58 |
| `auth.identities` | 172 |
| `auth.instances` | 0 |
| `auth.mfa_amr_claims` | 188 |
| `auth.mfa_challenges` | 0 |
| `auth.mfa_factors` | 0 |
| `auth.mfa_recovery_code_sets` | 0 |
| `auth.mfa_recovery_codes` | 0 |
| `auth.oauth_authorizations` | 0 |
| `auth.oauth_client_states` | 0 |
| `auth.oauth_clients` | 0 |
| `auth.oauth_consents` | 0 |
| `auth.one_time_tokens` | 1 |
| `auth.refresh_tokens` | 409 |
| `auth.saml_providers` | 0 |
| `auth.saml_relay_states` | 0 |
| `auth.schema_migrations` | 82 |
| `auth.scim_tokens` | 0 |
| `auth.scim_users` | 0 |
| `auth.sessions` | 188 |
| `auth.sso_domains` | 0 |
| `auth.sso_providers` | 0 |
| `auth.users` | 170 |
| `auth.webauthn_challenges` | 0 |
| `auth.webauthn_credentials` | 0 |
| `private.assistant_program_generations` | 6 |
| `private.push_notifications_outbox` | 92 |
| `private.source_cutover_write_gate` | 1 |
| `private.trainer_schedule_v2_allowlist` | 2 |
| `private.workout_create_requests` | 320 |
| `public.account_deletion_requests` | 0 |
| `public.app_feedback` | 8 |
| `public.assistant_actions` | 24 |
| `public.assistant_conversations` | 111 |
| `public.assistant_messages` | 850 |
| `public.chat_conversations` | 25 |
| `public.chat_messages` | 37 |
| `public.client_custom_metrics` | 21 |
| `public.client_goals` | 13 |
| `public.client_invitations` | 117 |
| `public.client_merge_operations` | 31 |
| `public.client_private_details` | 215 |
| `public.client_progress` | 182 |
| `public.client_progress_custom` | 12 |
| `public.client_published_training_summaries` | 60 |
| `public.client_trainer_relationships` | 34 |
| `public.client_trainers` | 164 |
| `public.client_training_summaries` | 109 |
| `public.clients` | 215 |
| `public.custom_exercises` | 128 |
| `public.favorite_workouts` | 1 |
| `public.goal_criteria` | 9 |
| `public.goal_stages` | 20 |
| `public.notification_preferences` | 62 |
| `public.profiles` | 166 |
| `public.push_subscriptions` | 38 |
| `public.trainer_discovery_prompt_preferences` | 4 |
| `public.trainer_professional_profiles` | 21 |
| `public.trainers` | 60 |
| `public.user_feature_flags` | 2 |
| `public.user_legal_acceptances` | 128 |
| `public.workout_exercises` | 3413 |
| `public.workout_sets` | 9137 |
| `public.workout_templates` | 0 |
| `public.workouts` | 672 |

## Воспроизводимость и проверка документального PR

Для следующего bounded audit использовать штатную авторизацию CLI и isolated linked workdir. Не читать локальные production env и не печатать project-ref/токены. Все query bodies — catalog/aggregate SELECT, явная READ ONLY транзакция с ограничением statement/lock time. Не вызывать `private.set_source_cutover_write_gate`, deploy/apply/repair/send commands. Временные collector scripts не являются новым production tooling и не добавлены в активную сборку.

Примеры безопасных агрегатов для повторной сверки:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT current_setting('transaction_read_only') AS audit_read_only;
SELECT writes_paused FROM private.source_cutover_write_gate WHERE singleton;
SELECT bucket_id, count(*) AS objects,
       sum((metadata->>'size')::bigint) AS bytes
FROM storage.objects GROUP BY bucket_id;
SELECT count(*) AS records,
       count(*) FILTER (WHERE image_path IS NOT NULL AND image_path <> '') AS image_refs
FROM public.custom_exercises;
SELECT count(*) AS historical_links, count(DISTINCT custom_exercise_id) AS exercises
FROM public.workout_exercises WHERE custom_exercise_id IS NOT NULL;
SELECT count(*) FILTER (WHERE sent_at IS NULL) AS unsent
FROM private.push_notifications_outbox;
COMMIT;
```

Применимые checks: factual count/link/privacy review, `git diff --check`, штатный exact-head scope и CI. Изменения только Markdown; full runtime/npm check/DB/browser tests, production feature rollout, authenticated smoke и restore drill этим PR не выполняются и не объявляются выполненными. Remote SQL выше — read-only фактический аудит, не новый тест против production.
