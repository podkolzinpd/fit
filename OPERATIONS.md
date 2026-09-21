# Эксплуатация Fit V2

## Локальная разработка

Обычный запуск выполняется командой `npm run dev`: она запускает локальный Supabase и только затем frontend. Безопасные локальные URL и publishable key хранятся в committed-файле `.env.development`.

Development-сборка программно отклоняет любой Supabase URL, кроме `localhost` и `127.0.0.1`. Production URL и publishable key задаются только в Vercel. Их запрещено копировать в `.env.local`, `.env.development` или другие локальные env-файлы. Для сброса локальных данных используйте `npm run db:reset`.

## Диагностика пользовательской ошибки

Каждый frontend-запрос к Yandex API отправляет UUID в `x-fit-request-id`. API
возвращает тот же ID в ответе и использует его как Fastify `reqId`, поэтому
один пользовательский сбой можно найти в Cloud Logging без email или UUID
профиля.

В штатном error-state пользователь видит короткий код `FIT-XXXX-XXXX-XXXX` и
действие «Скопировать диагностику». Для поиска в логах нужен не короткий код, а
поле `Request ID` из скопированного блока: ищите его как точное значение JSON
поля `reqId` в логах API-контейнера. Рядом передаются время, безопасное имя
операции, стадия, HTTP-статус, error code/category и release, если они были в
ответе. При `stage=network` запрос мог не дойти до API; тогда отсутствие этого
`reqId` в серверных логах является ожидаемым результатом и поиск продолжается
по времени, release и состоянию сети клиента.

Диагностический блок и серверные correlation logs не должны содержать session
token, Authorization, email, имя, UUID профиля, URL/query с идентификаторами,
request/response body или пользовательский текст. Диагностика копируется только
по явному действию пользователя и не сохраняется в отдельной таблице.

## Проверка доступности Yandex API после deployment

`.github/workflows/deploy-yandex-stage.yml` проверяет обновлённую ревизию в два
этапа. Сначала health/readiness и продуктовый smoke доказывают контракт самого
кандидата. Ошибка этого этапа безопасно возвращает предыдущую ревизию. Затем,
после пятиминутного окна применения scaling policy, отдельный verifier выполняет
последовательные запросы `/health` строго без retry.

Обычный push в `main` выполняет 50 запросов. Для длительного наблюдения используйте
отдельный ручной workflow `.github/workflows/verify-yandex-stage-availability.yml`.
Он не выполняет `terraform plan/apply`, не создаёт новую ревизию и не меняет IAM:
читает активный URL, release и `min_instances` из remote state, требует
`min_instances=1`, а затем запускает verifier. Значения по умолчанию:

```text
probe_count=1000
probe_interval_seconds=3
```

Такой запуск занимает около 50 минут и выполняет ровно 1 000 отдельных
запросов. Успех требует HTTP 200, `status=ok` и точный `releaseId` кандидата на
каждом запросе. Отчёт содержит только количества, безопасные request ID и тип
сбоя; Authorization и response body в него не попадают.

Если ответ несёт `x-fit-request-id`, запрос дошёл до приложения: нарушение
health-контракта считается ошибкой кандидата и допускает rollback. Сетевой сбой
или HTTP 5xx без `x-fit-request-id` считается отказом платформенного invocation:
deployment остаётся красным, но уже прошедшая продуктовый smoke ревизия не
откатывается. Возврат к предыдущей непрогретой ревизии не устранил бы такой
upstream-сбой и снова вернул бы `min_instances=0`.

## Перенос одного tenant в Yandex PostgreSQL

CLI `npm run tenant:migrate` подготавливает и проверяет перенос одного
изолированного trainer cohort. Он не меняет frontend routing, rollout assignment
или cloud resources. До двух отдельных репетиций и согласованного окна его
нельзя считать разрешением production cutover.

Секреты передаются только через окружение и не добавляются в аргументы, `.env`,
репозиторий или логи:

```text
FIT_TENANT_SOURCE_DATABASE_URL=<source PostgreSQL URL>
FIT_TENANT_TARGET_DATABASE_URL=<target PostgreSQL URL>
FIT_TENANT_MIGRATION_PASSPHRASE=<at least 20 characters>
FIT_TENANT_SOURCE_SSL_ROOT_CERT=<source CA file, required for remote>
FIT_TENANT_TARGET_SSL_ROOT_CERT=<target CA file, required for remote>
```

Базовая последовательность сначала выполняется только на локальных базах в
Podman:

```text
npm run tenant:migrate -- export --trainer-id <trainer-auth-uuid> --out <artifact.fit>
npm run tenant:migrate -- import --in <artifact.fit>
npm run tenant:migrate -- import --in <artifact.fit> --apply
npm run tenant:migrate -- validate --in <artifact.fit>
```

Для повторяемой проверки всего цикла одной командой используйте:

```text
npm run tenant:rehearse:local
```

Команда работает только с loopback-портами локального Podman, дополняет
исключительно синтетический demo cohort production-like данными, дважды создаёт
чистую временную PostgreSQL 17 базу и для каждой выполняет export, dry-run,
проверку rollback, apply, повторный apply и validate всех 35 таблиц.
Для isolated trainer/client повторный apply остаётся insert-only и показывает
`inserted=0`; full-cohort повторно пересобирает переносимый слой и доказывает
идемпотентность совпадением полного checksum snapshot-а. Зашифрованные
artifacts и обе временные базы удаляются после прогона.
Подключить этой командой stage или production нельзя. Она проверяет данные,
чистую цепочку миграций и идемпотентность, но не заменяет отдельную проверку
сетевого доступа, IAM, remote credentials и согласованного окна переноса.

Первый `import` — обязательный dry-run: он открывает транзакцию, проверяет все
FK/unique/check constraints и checksums, затем делает rollback. `--apply`
фиксирует данные только после полной проверки. Isolated trainer/client import
не перезаписывает существующие отличающиеся строки. Full-cohort import работает
иначе: под exclusive lock он временно сохраняет Yandex identity, app/pilot
sessions и rollout assignments, очищает 35 переносимых таблиц, загружает
свежий snapshot и возвращает Yandex-привязки только для профилей из этого
snapshot. Устаревшие linked identity/session/rollout строки профилей, которых
уже нет в source, удаляются вместе с ними. Любая ошибка откатывает всю
транзакцию. Операция заранее отказывается работать, если в target есть хотя бы
один нативный Yandex-профиль; поэтому этот режим предназначен только для
pre-cutover окна.

Артефакт зашифрован AES-256-GCM, создаётся с правами `0600` и не
перезаписывается. Он всё равно считается чувствительным backup-файлом: хранить
его следует только в согласованном защищённом месте, а после закрытия rollback-
окна удалить по отдельной процедуре. В выводе допустимы только имена таблиц,
количества и необратимый fingerprint tenant-а.

Удалённое чтение или подключение заблокировано без одновременных
`--allow-remote` и:

```text
FIT_TENANT_REMOTE_CONFIRMATION=I_UNDERSTAND_REMOTE_DATABASE_ACCESS
```

Для remote `--apply` дополнительно требуется:

```text
FIT_TENANT_REMOTE_APPLY_CONFIRMATION=APPLY_TENANT_TO_YANDEX_POSTGRES
```

Эти значения — предохранители, не секреты и не замена явному подтверждению
оператора. Перед isolated production export отдельно сверяются cohort,
отсутствие общих trainer-связей и pending push, freeze writes, target, backup и
rollback plan. Полный snapshot не копирует transient source push outbox; перед
финальным cutover обязательны freeze writes, ограниченное окно drain и
отключение Supabase dispatcher после него.
Точные границы manifest и ограничения описаны в
`docs/design/YANDEX_TENANT_MIGRATION_TOOLING.md`.

### Перенос приватных media в Yandex

До первого `full-cohort` dry-run с фото один раз создайте private media contour
ручным запуском `Deploy Yandex stage`: `plan_only=false`,
`approve_media_storage=true`. Terraform создаёт versioned Standard Object
Storage bucket и статический S3-ключ API service account, но записывает обе
части ключа сразу в deletion-protected `fit-stage-media-s3` Lockbox. Значения не
попадают в Terraform state, GitHub variables, repository или вывод workflow.

Чтобы stage API писал в уже созданный private bucket из другого Yandex Cloud,
задайте GitHub repository variable `YC_STAGE_MEDIA_BUCKET` его именем и выдайте
текущему stage API service account роль `storage.editor` на уровне этого bucket.
Ключ остаётся в существующем stage Lockbox; не создавайте и не добавляйте новый
статический ключ в GitHub variables. Пустая переменная возвращает штатный
stage-managed bucket.

Затем вручную запустите `Migrate Yandex media` из `main`:

- `audit` читает source objects и сравнивает target без записи;
- `apply` идемпотентно копирует отсутствующие или отличающиеся objects и
  повторно проверяет их SHA-256 и размер.

Workflow использует существующие `SUPABASE_ACCESS_TOKEN` и
`SUPABASE_PROJECT_ID`, получает source service-role key только во временный файл
с правами `0600`, а target key читает из Lockbox через short-lived GitHub OIDC.
В summary выводятся только режим, количество objects, суммарный размер,
количество скопированных/проверенных и content fingerprint. Пути, содержимое и
ключи не логируются и не сохраняются как artifact. Успешный apply обязан иметь
`objects == verified`; его можно безопасно повторять после новых source uploads.

По умолчанию после этого запускайте full-cohort `audit` → `dry-run` → pinned
`apply`. Для живого source, в котором записи продолжают меняться между двумя
GitHub runners, используйте отдельный current-snapshot apply ниже. Private
migration runner до подключения к PostgreSQL проверит наличие и точный размер
каждого chat object, указанного в snapshot. Это исключает commit строк с
неработающими вложениями. Перед финальным cutover после freeze writes повторите
media `apply`, чтобы захватить файлы, появившиеся после первой репетиции.

Если product owner явно принимает временно неработающие вложения, оба target
запуска можно выполнить с `allow_missing_media=true`. Это отдельный default-off
input workflow `Rehearse Yandex tenant migration`: runner по-прежнему проверяет
формат media metadata, но не требует наличия objects в Yandex. Пути в строках не
удаляются и не переписываются; до последующего `Migrate Yandex media: apply`
чтение таких файлов вернёт not found, а после копирования те же ссылки начнут
работать без повторной DB migration. Не используйте этот режим как неявный
fallback и фиксируйте одинаковую policy для dry-run и apply.

### Удалённая репетиция на Yandex stage

Workflow `Rehearse Yandex tenant migration` запускается только вручную из
`main`. Для `configured` он использует выбранный profile UUID из masked
repository secret `FIT_TENANT_TRAINER_ID`; автоматические режимы выбирают
cohort по данным source и требуют fingerprint успешного dry-run перед apply.
UUID не является workflow input и не выводится в команды или отчёт.
Существующие `SUPABASE_PROJECT_ID` и
`SUPABASE_DB_PASSWORD` дают source-доступ через связанный session pooler;
TLS проверяется с `verify-full`-эквивалентной настройкой и публичным корневым
сертификатом `services/api/certs/supabase-prod-ca-2021.crt`, опубликованным
Supabase для hosted PostgreSQL. Системного CA bundle для Supavisor недостаточно;
проверку сертификата отключать запрещено. Сертификат не является секретом, но
при его ротации новый файл и fingerprint должны попасть в обычный review;
target вызывается только через private `fit-stage-migration` с короткоживущим
GitHub OIDC → Yandex IAM token.

Поле `tenant_selection` управляет только выбором cohort-а:

- `configured` использует `FIT_TENANT_TRAINER_ID`;
- автоматические режимы доступны для `audit`, `dry-run` и `apply`. Для записи
  оператор указывает fingerprint из успешного dry-run, поэтому изменившийся
  выбор не может быть применён незаметно. `smallest-eligible` читает
  trainer UUID с клиентами, начиная с самого маленького cohort-а, пропускает
  кандидатов, не прошедших обычный tenant preflight, и не выводит найденный
  UUID. Если подходящего изолированного cohort-а нет, workflow завершается с
  `candidate_not_found`.
- `full-cohort` не использует UUID secret и переносит весь поддерживаемый
  application manifest одним согласованным snapshot. Его выбирают, когда merge
  или membership пересекает границу trainer tenant. Для замороженного source
  применяйте обычный pinned-путь: успешный `dry-run`, точный content-derived
  fingerprint и `APPLY_TENANT_TO_YANDEX_STAGE`. Для живого source используйте
  `APPLY_CURRENT_FULL_COHORT_TO_YANDEX_STAGE` с пустым fingerprint: workflow
  экспортирует один `REPEATABLE READ` snapshot и тем же encrypted envelope
  выполняет target dry-run, commit и повторную полную пересборку с тем же
  checksum. Эта фраза
  принимается только для `full-cohort`; автоматические и configured selections
  не получают ослабления fingerprint/selection guard. Режим не переносит
  `auth.users`, OAuth credentials, Yandex sessions/rollout assignments, весь
  source push outbox и Live receipts. Chat photo objects переносятся отдельным
  workflow выше и по умолчанию проверяются target runner до DB-транзакции.
  Явный `allow_missing_media=true` сохраняет ссылки, но откладывает проверку
  наличия файлов.

Автовыбор нужен только для безопасной репетиции на реальных объёмах и не
фиксирует tenant для cutover. `full-cohort` не является автовыбором: его
fingerprint фиксирует точное содержимое всего поддерживаемого snapshot.

Режимы выполняются последовательно:

- `audit` — одна `REPEATABLE READ READ ONLY` транзакция в Supabase; показывает
  только fingerprint, таблицы, количества строк и размер encrypted wire body;
- `dry-run` — повторяет audit, передаёт envelope только в памяти private runner
  и откатывает полную target-транзакцию после constraints/checksum validation;
- `apply` — сначала выполняет dry-run, затем commit и обязательный повторный
  apply того же encrypted envelope. Для isolated cohort он должен вставить ноль
  строк; для full-cohort он снова атомарно пересобирает переносимые таблицы и
  должен получить тот же checksum. Pinned
  путь требует `APPLY_TENANT_TO_YANDEX_STAGE`; current-snapshot путь требует
  `APPLY_CURRENT_FULL_COHORT_TO_YANDEX_STAGE`, `full-cohort` и пустой внешний
  fingerprint.

При отклонении target с `409` orchestration принимает и выводит только узкий
`tenant_migration_rejected` code, прошедший allowlist-проверку символов. Полное
тело ответа, значения строк и database error message в Actions logs не попадают.

Artifact не записывается в GitHub Artifacts, workspace или Object Storage.
Envelope v3 передаётся как raw encrypted binary body; format, salt, IV и auth
tag находятся в проверяемых служебных заголовках. Это убирает Base64/JSON
накладные расходы, не меняя шифрование, единый snapshot или атомарную target-
транзакцию. Размер binary body ограничен 3 400 000 байт: это оставляет запас
относительно неизменяемого
[лимита Yandex Serverless Containers](https://yandex.cloud/ru/docs/serverless-containers/concepts/limits)
3,5 МБ на весь HTTP-запрос вместе с заголовками. Превышение останавливает
workflow после read-only audit;
дальнейший рост требует chunk/Object Storage transport, а не повышения этого
предела. Workflow не меняет sticky routing, Yandex ID assignment,
production frontend или Supabase. Перенос на stage оплачивает только фактические
холодные вызовы уже существующего Serverless Container; новый постоянно
работающий или provisioned ресурс не создаётся.

## Окно технических работ

Глобальный build-time switch остаётся default-off:

```text
VITE_MAINTENANCE_MODE=false
```

Только точное `true` заменяет любой маршрут отдельным экраном технических
работ до монтирования auth, query и data providers. Поэтому новая сборка не
восстанавливает сессии, не читает продуктовые данные и не запускает product
mutations; это не визуальный overlay поверх работающего приложения. Единственное
действие экрана — перезагрузить страницу и повторно проверить значение флага.

Frontend-флаг меняется только после прямой команды владельца продукта и требует нового
Vercel deployment. Уже открытая вкладка со старым JS bundle не узнает о новом
build-time значении до reload, поэтому перед финальным snapshot обязателен
короткий drain: дождаться распространения deployment, обновить контролируемые
клиенты и подтвердить отсутствие незавершённых source mutations.

Старые вкладки, RPC и фоновые writers блокирует отдельный source-side gate в
Supabase. Он default-off и защищает одним statement trigger все 37 product и
background-write таблиц, включая source-only program jobs, summary guard,
private details и push outbox. Reads и полный snapshot продолжают работать.
Переключатель не опубликован через Data API и управляется только ручным
workflow `Manage Supabase cutover write gate`, сериализованным с tenant
migration:

```text
action=inspect
action=enable  confirmation=PAUSE_SUPABASE_PRODUCT_WRITES_FOR_CUTOVER
action=disable confirmation=RESUME_SUPABASE_PRODUCT_WRITES_BEFORE_YANDEX_WRITES
```

`disable` допустим только до первой пользовательской записи в Yandex. После
успешного переключения source gate остаётся включённым до decommission
Supabase. `enable` берёт краткие `SHARE` locks на защищённые таблицы: команда
дожидается завершения уже начатых DML, не пропускает новую запись между fence и
фиксацией gate и только после этого возвращает успех. Перед `enable` всё равно
остановите producers и дайте dispatcher опустошить текущий push outbox: после
включения gate любые новые и фоновые DML получают
`source_product_writes_paused`.

Порядок включения после отдельной команды:

1. Установить `VITE_MAINTENANCE_MODE=true`, выполнить production deployment и
   проверить прямые `/auth`, `/clients` и `/workouts/<id>/live` на 390/430 px.
2. Дождаться drain уже открытых клиентов, остановить producers, опустошить
   push outbox и проверить `action=inspect`; не включать Yandex routing.
3. Выполнить `action=enable`, подтвердить отказ контрольной source mutation и
   только затем снять свежий snapshot.
4. Выполнить `full-cohort` dry-run/apply/repeat/validate с одинаковой
   media policy и проверить 35 таблиц, counts и checksums.
5. Включить `linked-ready` assignments, провести smoke обеих ролей и только
   затем включать app-session/main-routing/native-registration switches.
6. После успешного smoke установить `VITE_MAINTENANCE_MODE=false` и выполнить
   ещё один production deployment.

Выключение окна до успешного smoke не означает безопасный rollback после первой
Yandex-записи: обратный перенос всё равно нужен отдельно.

## Первый запуск Yandex push pipeline

Миграция `000030` сама не отправляет уведомления. Доставку включает только
private Serverless Container `fit-stage-push-dispatcher`, вызываемый timer
trigger раз в минуту. У контейнера нет `allUsers`, постоянно прогретых
экземпляров и собственного секрета в Terraform state: пароль БД и
`PUSH_DISPATCH_SECRET` монтируются из Lockbox. Function и исходный transport
Lockbox живут в отдельном каталоге `YC_SUMMARY_FOLDER_ID`. Прямые IAM-привязки
между его security scope и stage недоступны, поэтому workflow читает только
`PUSH_DISPATCH_SECRET` во временный masked-файл runner-а, переключается на stage
OIDC и идемпотентно синхронизирует deletion-protected секрет
`fit-stage-push-transport`. Временный файл удаляется после синхронизации (а при
более раннем сбое — вместе с одноразовым runner-ом); payload не попадает в
GitHub outputs/env, логи или Terraform state. Dispatcher получает
`lockbox.payloadViewer` только на stage-копию.

Мульти-device контракт использует отдельную subscription UUID и уникальность
`(user_id, endpoint)`. Producer сразу создаёт по одной outbox-строке на каждую
активную подписку и включает `subscription_id` в dedupe key. Dispatcher
claim/finalize работает с точной подпиской; terminal Web Push response 404/410
удаляет только этот endpoint. Actor-authenticated API принимает endpoint только
в body, а tenant export/import переносит подписки по `id`. Любое изменение
producer, subscription schema или migration catalog обязано сохранять этот
контракт в Supabase и Yandex.

После merge первый автоматический `Deploy Yandex stage` ожидаемо остановится на
проверке Terraform plan. Запустите workflow вручную с `plan_only=true` и
`approve_push_pipeline=false`: такой запуск только покажет точный список
ресурсов и расчёт, ничего не применяя. Проверьте 43 200 вызовов в 30 дней,
512 МБ, 1 vCPU и ориентир 0–389 ₽/месяц при средней длительности 0,1–5 секунд;
общий free tier, вызовы sender-функции и исходящий трафик могут изменить счёт.
Только после отдельного подтверждения запустите workflow с `plan_only=false` и
`approve_push_pipeline=true`. Это одноразовое разрешение: timer создаётся лишь
после health-check точной ревизии, а последующие image-only обновления снова
выкатываются автоматически. Ручной SQL и копирование Lockbox payload не нужны.

## Feedback operations in Yandex stage

Миграция `000036` добавляет live views `analytics.trainers_metrics`,
`analytics.trainer_overview`, `analytics.client_overview` и
`analytics.app_feedback`. Для текущего небольшого объёма данных это обычные
PostgreSQL views: отдельный refresh и `pg_cron` не нужны, поэтому включение
views не перезапускает кластер. Stage сохраняет уже включённый управляемый
Yandex Cloud путь доступа DataLens (`data_lens=true`), чтобы Terraform не
отключал живую настройку. Отдельный пользователь и подключение DataLens не
создаются, а перенос существующих дашбордов из другого Yandex Cloud остаётся
отложенным шагом; сами views готовы в PostgreSQL.

Telegram и Tracker не создают новый container или timer. Уже существующий
private `fit-stage-push-dispatcher` раз в минуту забирает ограниченную lease-
пачку `app_feedback`, отправляет её в оба сервиса и независимо фиксирует два
результата. Подтверждённый канал повторно не отправляется, неуспешный имеет не
более 10 попыток. Tracker получает `unique=<feedback UUID>`, поэтому повторный
запрос не создаёт вторую задачу. Telegram Bot API не поддерживает idempotency
key: после подтверждённого ответа повтора не будет, но авария контейнера между
приёмом сообщения Telegram и записью receipt теоретически может дать дубль;
`Код сообщения` позволяет его однозначно распознать.

Создайте в каталоге stage один Lockbox secret с именем
`fit-stage-app-feedback-integrations` и одной версией, содержащей Telegram-ключи:

- `APP_FEEDBACK_TELEGRAM_BOT_TOKEN`;
- `APP_FEEDBACK_TELEGRAM_CHAT_ID`;
- `APP_FEEDBACK_TELEGRAM_MESSAGE_THREAD_ID` (optional Telegram forum topic);
- `APP_FEEDBACK_TRACKER_TOKEN` (optional);
- `APP_FEEDBACK_TRACKER_ORG_ID` (optional).

Workflow сам находит текущую immutable-версию по имени и монтирует значения
только в private dispatcher. При отсутствующем секрете deployment остаётся
рабочим, feedback сохраняется в PostgreSQL, но внешняя доставка не запускается.
Queue по умолчанию — `YAFIT`; заголовок организации — `X-Org-ID`.
Для Identity Hub задайте Terraform input
`app_feedback_tracker_org_header="X-Cloud-Org-ID"`. Секреты нельзя добавлять в
GitHub/Vercel variables, `.env`, команды или логи.

## Подготовка существующего Yandex-контура к production

Отдельный `fit-prod` stack не создаётся. Текущий контур остаётся в state
`fit/stage/terraform.tfstate` и после завершения auth/data cutover становится
production data plane. Имена ресурсов не переименовываются, чтобы не допустить
их replacement.

Workflow `Deploy Yandex stage` задаёт существующему Managed PostgreSQL 14 дней
backup retention и окно `00:30 UTC`. Automatic plan policy разрешает только это
точное in-place изменение: второй cluster, resize, новый host, public IP,
delete/replace и любые сопутствующие изменения database config остаются
заблокированы. Диск остаётся 10 GB, topology — один private host.

Этот этап не переключает routing, не переносит данные и не отключает Supabase.
Проверка восстановления в отдельный временный cluster выполняется перед
финальным cutover и не запускается автоматически, потому что временно создаёт
платный ресурс. Полный контракт: `docs/YANDEX_PRODUCTION_PLATFORM.md`.

## GitHub Secrets

В repository secrets должны быть настроены:

- `SUPABASE_ACCESS_TOKEN` — personal access token Supabase CLI;
- `SUPABASE_DB_PASSWORD` — пароль новой БД;
- `SUPABASE_PROJECT_ID` — `xwfuzfkuhblswpdludbc`.

После merge миграции применяет `.github/workflows/deploy-database.yml`. Запуск SQL через Dashboard запрещён. Publishable key может находиться в frontend deployment environment; service role и DB password — никогда.

Foundation UI Identity v1 является единственным production UI. Отдельного
rollout-переключателя, пользовательского preview allowlist и rollback-режима у
frontend больше нет. Историческая таблица `public.user_feature_flags` закрыта
для `anon` и `authenticated`; её физическое удаление выполняется только через
отдельное согласованное окно destructive migration.

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

Лицензированные Vital Gym Pro media также не требуют закрытых переменных в
Vercel. Зашифрованный bundle публикуется только workflow `Deploy Vital exercise
media`, использующим GitHub secrets `VITAL_MEDIA_KEY`, `SUPABASE_ACCESS_TOKEN`
и `SUPABASE_PROJECT_ID`. Файлы находятся в private bucket
`fit-exercise-media`; policy разрешает чтение только роли `authenticated`, а
frontend создаёт короткоживущие signed URL.

Закрытый пилот Apple Health управляется build-time переменными Vercel:

```text
VITE_WEARABLES_ENABLED=true
VITE_WEARABLES_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

По умолчанию и при пустом allowlist интеграция скрыта. Изменение списка требует
нового deployment. UUID попадают во frontend bundle, поэтому этот механизм
служит только для rollout интерфейса и не является границей авторизации.

Ассистент в production доступен тренерам и клиентам. Build-time переменная
Vercel остаётся мгновенным kill switch:

```text
VITE_ASSISTANT_NAV_ENABLED=true
```

По умолчанию production rollout включён; точное `false` скрывает вкладку и закрывает
маршрут для обеих ролей после нового deployment. `VITE_ASSISTANT_NAV_PILOT_USER_IDS`
и `VITE_ASSISTANT_NAV_PILOT_EMAILS` сохраняются только для изолированной local/preview-разработки
и в production игнорируются. Клиентский ассистент автоматически использует собственную
карточку; данные и мутации защищены серверными role/ownership-проверками.

Закрытый пилот приветствия в шапке «Сегодня»/«Кабинет» управляется build-time
переменными Vercel:

```text
VITE_TODAY_GREETING_ENABLED=true
VITE_TODAY_GREETING_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Механизм default-off: по умолчанию, при пустом allowlist или любом значении
флага кроме точного `true` заголовок вкладки остаётся прежним («Сегодня»),
а строка приветствия — отдельным элементом ниже, как раньше. Изменение списка
требует нового deployment. UUID попадают во frontend bundle, поэтому этот
механизм служит только для rollout интерфейса и не является границей
авторизации: данные и мутации защищаются существующими RLS/ownership-
проверками.

Привязка существующего FIT-аккаунта к Yandex ID использует общие публичные
настройки Yandex ID и глобальный build-time switch:

```text
VITE_YANDEX_OAUTH_CLIENT_ID=<public Yandex OAuth client id>
VITE_YANDEX_API_BASE_URL=<https Yandex stage API base URL>
VITE_YANDEX_SESSION_LINKING_ENABLED=true
VITE_YANDEX_ACCOUNT_LINK_REQUIRED=true
```

При точном значении `true` блок показывается всем непривязанным авторизованным
пользователям на главной странице. Stage API по текущей Supabase-сессии
возвращает только `linked: true/false`: непривязанный профиль видит действие,
а после успешной привязки блок полностью исчезает. Во время первичной проверки
блок не показывается; при ошибке доступен явный retry, а auth-запрос ограничен
таймаутом. Значение кроме точного `true` является глобальным аварийным
выключателем. Его изменение требует нового deployment. Публичный OAuth Client
ID виден во frontend bundle и не является границей авторизации: callback и
проверка статуса передают текущую Supabase-сессию в stage API, а данные и
мутации защищаются backend ownership/RLS-проверками. OAuth Client Secret в
Vite/Vercel frontend variables не добавляется.

Linking не требует предварительного tenant import только для корневой identity:
после проверки Supabase access token stage читает через его RLS точную строку
`profiles` и, для trainer, `trainers`, атомарно создаёт отсутствующий root в
Yandex DB и затем связывает Yandex subject. Эта операция не создаёт rollout
assignment, не переносит клиентов/тренировки и не разрешает Yandex-сессию до
отдельного `yandex/read_write` назначения.

Отдельный `VITE_YANDEX_ACCOUNT_LINK_REQUIRED=true` превращает существующую
привязку в обязательный шаг для всех пользователей с Supabase-сессией. Gate
проверяется до любого защищённого продуктового маршрута: связанный профиль и
пользователь с действующей Yandex app-session проходят без дополнительного
действия, непривязанный видит только PKCE-привязку, юридические документы и
выход. Ошибка проверки не открывает приложение автоматически и показывает
`Повторить`; отсутствие полной публичной linking-конфигурации также закрывает
доступ с явной ошибкой. Реализация остаётся default-off, но в Vercel Production
Environment глобально включены оба linking-флага: персонального allowlist нет,
а Preview и локальная разработка не затронуты. Gate не создаёт rollout
assignment, не включает Yandex app-session и не меняет выбранный data backend.
Для аварийного возврата необязательной привязки нужен новый deployment со
значением `false`.

Stage API CORS allowlist обязан содержать как production web origin, так и
точный `capacitor://localhost` origin нативной iOS-оболочки. Произвольные
`capacitor://` origins не разрешаются. Изменение выполняется через
`TF_VAR_api_cors_allowed_origins` в deployment workflow, а не вручную в
активной ревизии контейнера.

Полноценная browser-сессия после Yandex ID использует те же публичные
`VITE_YANDEX_OAUTH_CLIENT_ID` и `VITE_YANDEX_API_BASE_URL` и общий аварийный
switch:

```text
VITE_YANDEX_APP_SESSION_ENABLED=true
```

Финальный единый вход доставляется отдельным default-off набором:

```text
# Yandex API container (Terraform repository variables)
YC_STAGE_YANDEX_NATIVE_REGISTRATION_ENABLED=true
YC_STAGE_YANDEX_ONLY_AUTH_ENABLED=true

# Vercel Production Environment
VITE_YANDEX_APP_SESSION_ENABLED=true
VITE_YANDEX_MAIN_ROUTING_ENABLED=true
VITE_YANDEX_NATIVE_REGISTRATION_ENABLED=true
VITE_YANDEX_ONLY_AUTH_ENABLED=true
```

`VITE_YANDEX_ONLY_AUTH_ENABLED` эффективен только при всех трёх frontend
зависимостях и валидных OAuth/API settings. Серверные recovery/registration
handoff endpoints скрыты с `404`, пока `YANDEX_ONLY_AUTH_ENABLED` не равен
точному `true`; создание нового профиля дополнительно требует
`YANDEX_NATIVE_REGISTRATION_ENABLED=true`. Обычный merge/deploy не включает ни
один из этих switches: stage Terraform читает отсутствующие repository
variables как `false`.

Не включайте frontend раньше server revision. Порядок cutover: maintenance →
fresh 35-table apply → repeat checksum → linked-ready assignments → server
variables и успешный stage deploy → smoke linked/recovery/native/invite →
frontend variables и production deployment → снять maintenance. При неверных
старых credentials пользователь должен получить retry, а не автоматический
пустой профиль. После первой Yandex mutation rollback выполняется по playbook,
а не простым возвратом Supabase UI.

Batch `linked-ready` заранее включает уже связанные профили. Старому
domain-ready профилю без Yandex identity assignment заранее не нужен: после
успешной проверки прежних credentials функция recovery в одной транзакции
проверяет role-specific root, связывает Yandex identity, создаёт включённый
`yandex/read_write` assignment, первую app-session и расходует handoff.
Неверные credentials не вызывают эту транзакцию; отсутствующий root,
identity/profile conflict или ошибка сессии откатывают её целиком.

Без точного `true` вход через Yandex ID выключен. Публичного UUID allowlist для
app-session больше нет: настоящая персональная граница — связанная строка
`auth_identities` и включённый `profile_rollout_assignments` со значениями
`target_backend=yandex` и `access_mode=read_write`. Сервер проверяет её при
выдаче и каждом восстановлении opaque session. Изменение switch требует нового
deployment.

Opaque session token хранится в browser localStorage только для восстановления
после перезагрузки, передаётся API в `x-fit-session`, не попадает в URL, UI,
логи или аналитику и отзывается через API при выходе. Token доступен
исполняемому frontend JavaScript, поэтому защита от доступа к данным остаётся
на backend session, ownership и tenant-проверках.

Frontend ограничивает OAuth exchange, linking, восстановление и отзыв Yandex
ID-сессии 12 секундами. При таймауте сохранённый token остаётся доступен для
повтора, но экран больше не может оставаться в бесконечном loading. Действие
«Сбросить сессию Yandex ID» удаляет только ключ
`fit.yandexAppSession.v1` на текущем устройстве и сразу возвращает обычный вход;
прочие localStorage-настройки и черновики не очищаются. Это аварийный локальный
сброс: серверная сессия остаётся действительной до штатного отзыва или истечения
14-дневного срока.

Sticky routing основного Trainer Assistant имеет отдельный default-off rollout:

```text
VITE_YANDEX_ASSISTANT_ROUTING_ENABLED=true
VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS=<one-auth-user-uuid>
```

Общий `VITE_ASSISTANT_NAV_ENABLED=false` остаётся глобальным kill switch:
sticky-флаг выбирает backend и не может сам открыть скрытую вкладку
или прямой маршрут.

Флаг включается только при точном `true`; пустой/отсутствующий allowlist или
профиль вне него сохраняет прежний Supabase Assistant. Для первой репетиции в
списке должен быть ровно один заранее перенесённый тестовый trainer UUID. Этот
же UUID обязан иметь действующую `read_write` app-session и серверное назначение `provider=yandex`,
`access_mode=read_write`. UUID виден во frontend bundle и не
является авторизацией: Yandex API повторно разрешает actor через opaque session,
ownership и tenant-проверки.

После выбора backend все зависимости Assistant — история, turns/actions,
упражнения, разбор тренировки и сводки — используют только `x-fit-session` и
Yandex API. Ошибка Yandex показывается пользователю; автоматического fallback
на Supabase для отдельного запроса нет, чтобы один сценарий не создал записи в
двух БД. Несовпадение UUID текущего FIT actor и Yandex app-session блокирует
загрузку данных. Остальные вкладки и все пользователи вне rollout продолжают
работать через Supabase.

Изменение обеих build-time переменных требует нового deployment. Безопасный
rollback — установить `VITE_YANDEX_ASSISTANT_ROUTING_ENABLED=false` (или убрать
pilot UUID) и выполнить новый deployment; данные между backend автоматически
не синхронизируются, поэтому переключение допускается только после проверки
export/import и отсутствия незавершённых mutations.

Sticky routing всего основного интерфейса имеет собственный общий kill switch:

```text
VITE_YANDEX_MAIN_ROUTING_ENABLED=true
```

Флаг работает только при точном `true`. Он применяется только к уже выданной
Yandex app-session, поэтому профиль всё равно обязан иметь серверное назначение
`provider=yandex`, `access_mode=read_write` и уже перенесённые данные. Также обязательны публичные
`VITE_YANDEX_OAUTH_CLIENT_ID` и `VITE_YANDEX_API_BASE_URL`.

После входа выбранный профиль использует Yandex API во всех основных вкладках:
профиль, клиенты, цели, прогресс, упражнения, расписание, полный workout
lifecycle, связи/приглашения, Assistant, сводки, feedback и push state. Выбор
делается один раз на уровне app-session; ошибка отдельного Yandex-запроса не
включает Supabase fallback. Старая browser Supabase-сессия завершается после
успешного выбора Yandex backend, чтобы истечение Yandex token не переключило
источник данных скрыто. Интерфейс и маршруты приложения остаются прежними.

Выключенный флаг сохраняет Supabase для пользователей без активной Yandex
app-session. Каждое чтение и изменение повторно защищается opaque session,
actor/tenant ownership и правами БД. Изменение флага требует нового Vercel
deployment. До завершения full-cohort export/import и rehearsal включать его
нельзя. Rollback после начала mutations требует согласованного окна и проверки
расхождений данных, а не только выключения frontend-флага.

Серверное назначение для первого перенесённого tenant управляется отдельно от
Vercel через ручной GitHub Actions workflow `Manage Yandex stage rollout`.
Workflow использует repository variable
`FIT_YANDEX_ROLLOUT_TENANT_FINGERPRINT`, сохранённую из успешного apply, а
private runner однозначно сопоставляет fingerprint с уже перенесённым
role-specific profile root. UUID не передаётся как workflow input и не
печатается.
Запускать его можно только из `main`:

- `inspect` без confirmation только проверяет наличие role-specific domain root,
  привязки Yandex ID и активного `yandex/read_write` назначения;
- `enable` требует confirmation `ENABLE_YANDEX_READ_WRITE` и идемпотентно
  включает назначение только для уже перенесённого профиля;
- `disable` требует confirmation `DISABLE_YANDEX_READ_WRITE`, немедленно
  выключает разрешение новых и существующих app-session, но не удаляет данные и
  не меняет Vercel-флаги.

Операция использует short-lived GitHub OIDC и private migration runner. Она не
создаёт облачные ресурсы, не запускает DB migration и не требует Dashboard SQL.
Для полного rollback сначала выключите frontend sticky routing новым Vercel
deployment, затем выполните `disable`; обратный порядок мгновенно завершит
доступ выбранного пользователя к Yandex API.

После подтверждённого `full-cohort` dry-run и pinned apply тот же workflow
можно запустить со scope `linked-ready`. Он никогда не принимает список UUID и
работает только с профилями, у которых одновременно существуют role-specific
domain root и связанная Yandex identity:

- `inspect` возвращает только агрегированные количества domain-ready,
  linked-ready и уже включённых профилей;
- `enable` требует `ENABLE_ALL_LINKED_YANDEX_READ_WRITE` и идемпотентно включает
  `yandex/read_write` всем linked-ready профилям;
- `disable` требует `DISABLE_ALL_YANDEX_READ_WRITE` и выключает все активные
  read-write назначения как аварийный rollback.

Batch workflow не доказывает полноту данных сам по себе: перед `enable`
обязательны успешные full-cohort validation и apply. Ни UUID, ни Yandex subject
в ответ и GitHub summary не выводятся.

`linked-ready` batch не обязан включать ещё не связанные старые аккаунты.
Первый успешный recovery создаёт их assignment атомарно после proof-of-control;
поэтому domain-ready count может быть больше linked/read-write count до входа
таких пользователей и это само по себе не является drift.

Светлая и тёмная палитры Foundation UI Identity v1 доступны всем пользователям
и выбираются обычной настройкой темы в профиле. Отдельных Figma/dark pilot
переменных и allowlist нет. Обновлённый поиск клиентов также является штатным
интерфейсом и появляется по продуктовой логике списка.

- Site URL: `https://<production-domain>`;
- Redirect URLs: `https://<production-domain>/auth/callback` и `https://<production-domain>/auth/reset`;
- локальные `http://localhost:5173/auth/callback` и `http://localhost:5173/auth/reset` остаются разрешёнными для разработки.

OAuth на произвольных preview-доменах по умолчанию не разрешается. Если позднее подключается custom domain, Supabase и Google OAuth настраиваются на него до переключения трафика.

## MVP email registration

До подключения собственного домена и production SMTP подтверждение email при регистрации отключено. В Supabase Dashboard в `Authentication → Sign In / Providers → Email` настройка **Confirm email** должна быть выключена. Локальный Supabase повторяет это поведение через `auth.email.enable_confirmations = false`.

Регистрация собирает только имя, email и пароль; фамилия не запрашивается и не передаётся в Auth metadata. Поле `profiles.last_name` остаётся nullable для обратной совместимости и будущего добровольного заполнения профиля.

Password reset остаётся доступным технически, но не считается production-ready до подключения собственного домена и SMTP. После подключения SMTP решение об обязательном email confirmation оформляется отдельным изменением продукта и тестов.

## Приглашения клиентов

Тренер создаёт одноразовый 12-символьный код в карточке клиента и передаёт его
вне Fit. Код действует семь дней, хранится в БД только как SHA-256 и после
принятия атомарно связывает уже аутентифицированный аккаунт с карточкой. Новый
код той же роли отзывает предыдущий активный код; создатель может отозвать его
раньше вручную.

Email, Supabase service role и отправка письма в этом сценарии не используются.
Для production Supabase и Yandex stage действует один продуктовый контракт,
поэтому отдельная Edge Function `invite-client` и
`CLIENT_INVITE_REDIRECT_URL` больше не нужны.

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

Stage API для Assistant turn (`POST /v1/assistant/turn`) принимает ровно один
opaque credential: read-only `x-fit-pilot-session` для изолированного pilot UI
или read-write `x-fit-session` для sticky-routed основного Assistant. Оба вместе
отклоняются. Actor-context задаётся PostgreSQL-транзакцией; отдельный Supabase
JWT, OAuth Client secret или новый YandexGPT secret endpoint-у не нужны.

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

### Assistant four-week program pilot

The production Supabase Assistant orchestrator calls the private Yandex Cloud
Function `fit-generate-program`. Its input is an actor-scoped training aggregate
and the explicitly confirmed quiz. The generator has no database credentials.
For the pilot, a model router selects `record_workout`, `create_program_draft`,
or a chat reply. The tools retain separate state and write paths. Switching
away from an unfinished draft asks the trainer to finish or cancel it; the
new request is never appended to the wrong tool. Clarifications stay in chat.
The model proposes the full plan, individual sets/reps/time/RPE, rest and four
weekly prescriptions. Code validates the catalog, observed load, time and
progression constraints without replacing model doses. Every new exercise row
requires a progression explanation, including a reason when doses stay unchanged.
A model draft that fails validation is rejected.

Program access (trainers and clients):

- `ASSISTANT_PROGRAM_ENABLED=true` enables the authenticated program flow and
  private generator. The Yandex API container sets it for backend parity; user
  access remains controlled by the existing frontend Assistant flag and Yandex
  routing assignment. A missing/false flag disables new quiz/generator calls.
- `VITE_ASSISTANT_PROGRAM_ENABLED=true` in `vercel.json` enables existing chat
  controls for both signed-in product roles. Trainers can select only connected
  clients; a client is bound to their own active card. The server checks
  authentication, conversation ownership, role and target ownership.
- The former `*_PROGRAM_PILOT_USER_IDS` variables are no longer read. No per-user
  deployment configuration is needed. Generator IAM remains private; client
  selection still uses the actor-scoped client list; client program apply also
  requires the validated `program-v1` payload in both databases.
- Disable the server flag and redeploy to stop new calls. Existing planned
  workouts and server-created action confirmation keep their normal lifecycle.

One-time bootstrap before the first release: create a private function and runtime
service account named `fit-generate-program` in the existing summary folder.
Grant that runtime only `ai.languageModels.user` on the folder. Usage is
returned to the orchestrator, which records it using its existing Monitoring role. On the function, grant `serverless.functions.invoker` only to the existing
`fit-assistant-orchestrator` runtime SA. Do not grant `allUsers` or Lockbox access.
The normal deployment workflow resolves these resources and publishes versions;
it does not create or expand their IAM bindings. Keep the previous function
versions for rollback and do not include quiz/client text in logs.

The pilot supports 4 weeks × 1–3 trainer-supervised sessions (30+ minutes, a rest
day between sessions): full body for one day, related A/B or A/B/C for two/three
days, with simple repeated days permitted. It uses the bounded system-exercise catalog
and adult clients without reported current limitations. Confirming an updated
quiz explicitly creates a new full draft. The original canonical workout JSON
is the only accepted apply payload; it expires after 24 hours and is rejected
when client/history updates are newer than the captured source. All workouts
save atomically with stable request IDs. Five explicit generation attempts per
rolling 24 hours per trainer. A service-only generation job keyed by actor,
client, brief and source fingerprint deduplicates retries across turns with a
three-minute lease and completed-result cache. A revised draft atomically
withdraws older proposed/failed actions for the same program. Scoped edits
preserve unaffected workouts and IDs and revalidate the result before save.

Native Yandex Assistant generation is not enabled in this first pilot. Its
program-save RPC has the same 4/8/12 canonical-payload checks, but the native
chat does not run the new quiz/loader. There is no cross-backend fallback.
