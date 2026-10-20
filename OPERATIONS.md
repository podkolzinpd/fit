# Эксплуатация Fit V2

## Автоматический выбор проверок PR

`scripts/e2e-scope.mjs` определяет frontend/browser scope по полному diff PR.
Ручная просьба в промпте, метка PR или bypass-флаг не нужны и не разрешают skip.
Documentation-only — только Markdown: SVG в `docs/design` импортируются
напрямую из TS/CSS. Assets и неизвестные data-файлы не пропускают frontend.
Для проверенных documentation/API-only/operations-only путей пропускаются
frontend typecheck/build/coverage, frontend Terraform и браузерные матрицы.
Общие lint, policy/hosting-контракты, API и PostgreSQL остаются обязательными.
Android debug уже фильтруется по native/frontend/build paths в своём workflow;
служебный PR не требует ручной пересборки WebView/iOS/Android.

Auth/routing/контрактные изменения, зависимости, неизвестные пути и CI policy
требуют полный набор. Классификатор не считает все backend/infra/scripts пути
безопасными: например, Nginx/CORS/build и новый API runtime требуют проверки.
На main/manual CI frontend и browser acceptance всегда полные; временный
Fit Lime feature scope, его срок и аудит inventory не меняются.

Каждый запуск публикует решение и классификацию каждого файла в job log и
GitHub Actions Summary. Для локального dry run:

```sh
EVENT_NAME=pull_request node scripts/e2e-scope.mjs <base-sha> <head-sha> --json
```

Для незакоммиченных изменений учитывайте дополнительно working-tree diff.
Недоступный/пустой diff требует full. Required `app`/`e2e` проверяют успешность
scope и ожидаемые success/skipped состояния; failed/cancelled/пустой результат
не становится зелёным skip. Repository quality не отключается классификатором.

## Локальная разработка

Обычный запуск выполняется командой `npm run dev`: через Podman она готовит
локальные Supabase и PostgreSQL 17 для Yandex API, затем запускает API и
frontend. Безопасные локальные URL и publishable key хранятся в committed-файле
`.env.development`.

Development-сборка программно отклоняет любой Supabase URL, кроме `localhost` и
`127.0.0.1`. `VITE_SUPABASE_*` нужны только локальным legacy-сценариям, не production
web/Android/iOS build. Текущая production-конфигурация находится в
`.github/workflows/prepare-cloudru-frontend.yml`, а не в Vercel Production.
Yandex frontend workflow сохранён для прежнего контура; его наличие не означает
активный production deploy.
Production URL/ключи нельзя копировать в `.env.local`, `.env.development` или
другие локальные env-файлы. `npm run db:reset` сбрасывает только локальный
Supabase baseline, не Yandex PostgreSQL.

## Карта системы и подготовка возврата в Yandex Cloud

Актуальная проверенная точка16.10.2026, карта сервисов/доступов, матрица
работоспособности и очередь исправлений находятся в
[отчёте аудита](docs/design/CLOUD_RETURN_AUDIT_20261016.md).
[Инструкция возврата](docs/design/CLOUD_RETURN_RUNBOOK_20261016.md) — проект
будущей операции с одиночным активным writer, без потери подтверждённых записей
и с целевым окном остановки записи≤120мин. Полная приёмка возврата ещё не пройдена.
Локальная synthetic rehearsal не разрешает production migration/DNS switch.

## Cloud.ru stage: bootstrap и подготовка API

На время переноса в Cloud.ru автоматический `Deploy Yandex stage` после push в
`main` выполняет только локальную валидацию Terraform. `Review Terraform plan`,
`deploy` и публикация Yandex deployment запускаются только при точном значении
repository variable `YC_STAGE_TERRAFORM_AUTODEPLOY_ENABLED=true`; отсутствие
переменной означает `false`. Ручной `workflow_dispatch` остаётся явным
разовым запуском, включая `plan_only=true`. Это останавливает повторяющийся
remote refresh двух Yandex Cloud Functions Triggers, не удаляет их из Terraform
state и не планирует их уничтожение. Пока флаг выключен, изменения Yandex API
и инфраструктуры **не попадают автоматически в Yandex stage**; перед возвратом
туда требуется отдельный проверенный plan. Cloud.ru workflows этим флагом не
затрагиваются.

`.github/workflows/deploy-cloudru-stage.yml` — **Bootstrap Cloud.ru stage runner**,
только аварийный ручной `workflow_dispatch`. Он может временно использовать
SSH-ключ и `CLOUDRU_RUNNER_REGISTRATION_TOKEN`; после регистрации runner
registration secret и временное правило TCP/22 удаляются. Это не обычный deploy.

Обычные обновления готовит **Build Cloud.ru stage API** в
`.github/workflows/deploy-cloudru-api-stage.yml`: `push` в `main` только для
`services/api/**` или ручной `workflow_dispatch`. Job использует
`[self-hosted, cloudru-stage]`, `contents: read` и общий lock
`cloudru-stage-vm` без отмены выполняющегося задания. Автоматический запуск
разрешён только при точном `CLOUDRU_STAGE_AUTODEPLOY_ENABLED=true`; отсутствие
переменной/`false` оставляет только ручной запуск. Первую проверку выполняйте
вручную на `main` при выключенном флаге; включайте его только после success.

До checkout проверяются repository/main/SHA, hostname `fit-stage-app`, активный
`actions.runner.podkolzinpd-fit.fit-cloudru-stage.service` и `sudo podman info`.
Credentials checkout не сохраняются. Только versioned source из `git archive`
попадает в отдельный каталог `/opt/fit/releases/<SHA>/<run-id>-<attempt>`.
Образ `localhost/fit-api:<SHA>` собирается на VM через Podman и проверяется
`podman image exists`. После success отдельно атомарно заменяются ссылка
`/opt/fit/current` и файл `/opt/fit/DEPLOYED_SHA`; итог сверяется по readback.
Ошибки preflight/build не меняют прежние SHA/current; старые releases/образы
этот workflow не удаляет.

Сборка **не запускает API-контейнер**: SHA в `/opt/fit/DEPLOYED_SHA` означает
подготовленный образ, не работающий runtime. После завершения SQL-переноса и
первого loopback smoke отдельный workflow `Release Cloud.ru stage API` принимает
только зелёный CI текущего `main` (либо `workflow_dispatch` с ID такого CI).
Его автоматический режим требует `CLOUDRU_API_AUTODEPLOY_ENABLED=true`.
Workflow собирает exact-main образ, проверяет кандидата на `127.0.0.1:18082`,
переключает runtime на `127.0.0.1:18080`, проверяет `/ready` и пишет
`/opt/fit/RUNNING_SHA`; при неудаче после переключения пытается вернуть прежний
образ. До запуска кандидата он применяет только новые numbered SQL-миграции
из того же exact-main образа; DNS и публичный listener не меняет. Runtime берёт
существующий `/opt/fit/secrets/api.env`. Проверка runtime разрешает только
Cloud.ru PostgreSQL с fit_api и либо явно выключенный AI, либо согласованные
external AI credentials без Yandex VM metadata и старого function gateway.

Миграции выпуска запускает `dist/cloudru-release-migrations.js` в одноразовом
read-only Podman-контейнере без capabilities/публичного порта. Только этот
контейнер получает `MIGRATION_DATABASE_*` владельца `fit_owner` из существующего
`CLOUDRU_STAGE_DATABASE_CONFIG_JSON`; API продолжает получать только свой
`/opt/fit/secrets/api.env`. Target жёстко ограничен `10.70.10.67:5432/fit` с
прежним согласованным `SSL_MODE=require`: TLS шифруется, CA/hostname в этом
режиме не проверяются. Yandex, OIDC и source snapshot в этом выпуске не нужны.

Перед apply проверяются owner/database, существующая непустая история
`app_private.fit_migrations`, её PK и соответствие истории файлам образа.
Это не initial bootstrap, не restore и не синхронизация данных между облаками.
Стандартный advisory lock node-pg-migrate удерживается одной сессией непрерывно
при планировании, backup и apply; конкурирующий migrator получает ошибку.
Pending SQL выполняется одной транзакцией, без fake/down/no-lock. Явные
transaction boundaries в Up отвергаются. Timeout SQL120s/lock3s ограничивает
влияние DDL на работающий API. При отсутствии pending SQL backup/apply не нужны.

Если изменения есть, до apply PostgreSQL17 `pg_dump` сохраняет custom archive
`/opt/fit/db-backups/<SHA>/<run-id>-<attempt>/before-migrations.dump`;
`pg_restore --list` проверяет его читаемость. Каталоги root0700, archive0600,
backup не перезаписывается, не публикуется в GitHub artifacts и не удаляется
автоматически. Это локальная аварийная копия на той же VM, не offsite backup
и не доказательство восстановления production. Контролировать диск; retention
и offsite/restore drill — отдельные задачи. Owner env root0600 и одноразовый
контейнер удаляются EXIT trap; после SIGKILL/потери VM может понадобиться
проверка оставшегося защищённого env/container. Копии данных не трогать.

Ошибка backup/миграции останавливает выпуск до кандидата и замены старого API.
После success проверяется отсутствие pending. Ошибка API возвращает предыдущий
образ, **не** выполняет down/restore БД: forward-миграции обязаны сохранять
совместимость со старым API. Первое ручное выполнение на зелёном текущем main
проверяется до включения `CLOUDRU_API_AUTODEPLOY_ENABLED=true`; флаг запускает
тот же gated workflow после успешного CI `main`, не отдельный apply.

`Prepare Cloud.ru frontend without public routing` также требует зелёный CI
текущего `main`; его автоматический режим требует
`CLOUDRU_FRONTEND_AUTODEPLOY_ENABLED=true`. Он собирает frontend с
build environment `fit-frontend-candidate`, где уже находятся публичные startup
параметры и обязательные licensed fonts. Секреты не копируются в repository
или на VM: environment подключён только к hosted build, не к self-hosted prepare.
Сборка использует
`https://api.fit-training.ru` и устанавливает его в отдельный nginx-сервис,
слушающий только `127.0.0.1:18081`. В этой сборке программа Assistant выключена
(`VITE_ASSISTANT_PROGRAM_ENABLED=false`); runtime AI остаётся выключенным.
Сервис не меняет системный nginx, основной домен или DNS. Если отдельный public
web ingress уже включён, новая сборка будет доступна через него: loopback сам
по себе не означает отсутствия внешнего потребителя. Сначала нужны зелёные ручные
прогоны обоих workflows, затем можно включать их автоматические флаги.
Обычному job не нужны SSH, приватный ключ и registration token: runner получает
задания через исходящее HTTPS-соединение с GitHub; входящий SSH не открывается.

Frontend artifact — пакет с exact-main SHA, SHA-256/размерами и MIME/cache
каждого файла. Он материализуется только в новый immutable каталог
/opt/fit/frontend/candidates/<SHA>-<run>-<attempt>/site; existing paths и symlinks
не переиспользуются. До изменения current отдельный непривилегированный Nginx
на127.0.0.1:18083 проверяет все bytes/headers, SPA/OAuth callback, recovery старого
JS и404 отсутствующих CSS/WASM/fonts. Probe не останавливает stage18081;
public80/443 и API18080 не затрагиваются. Hosted fonts обязательны, без fallback.

Promotion сохраняет previous current/config/systemd unit, проверяет Nginx syntax
и повторяет полный HTTP-контракт на18081. При ERR/INT/TERM возвращает прежние
файлы/указатель, перезапускает ранее активный stage и завершает job с ошибкой.
Первый неудачный install убирает только созданные pointer/config/unit; releases
и backups сохраняются. Failed rollback явно сообщается; SIGKILL/потеря VM
не покрываются.

Диск self-hosted runner обслуживает shell-only workflow **Maintain Cloud.ru
runner disk**. Он не использует `actions/checkout`/`setup-node`, поэтому может
запуститься даже когда свободного места недостаточно для скачивания GitHub
Action. Ручной `inspect` только выводит `df`, inode, размеры строго известных
каталогов и `podman system df`. Ручной `apply` требует подтверждение
`APPLY_CLOUDRU_RUNNER_RETENTION`; тот же bounded apply запускается ежедневно в
05:17 МСК под общим lock `cloudru-stage-vm`.

Retention сохраняет SHA работающего API, подготовленный SHA, образы всех
контейнеров и три последних API release SHA; для frontend сохраняются текущий
candidate и три последних candidate. Удаляются только прошедшие строгую
проверку старые `/opt/fit/releases/<sha>`, frontend candidates и их
`localhost/fit-api:<sha>` tags, затем dangling image cache и воспроизводимые
GitHub Actions/Node tool caches. Volumes, контейнеры, media, secrets и
`/opt/fit/db-backups` не очищаются. После apply повторно проверяются оба current
pointer, RUNNING_SHA, API/frontend loopback smoke и минимум 2 ГБ свободного
места. Если проверка не проходит, workflow завершается ошибкой; удалённые
артефакты восстанавливаются только новой сборкой, поэтому защищённые rollback
версии являются обязательной границей.
Unit/refusal/rollback входят в npm run frontend:hosting:test. Real Nginx:
node --test scripts/cloudru-frontend-nginx.integration.test.mjs через Podman,
без production URL/БД. Это hosting-проверка, не пользовательский OAuth E2E.

Это откат frontend, не данных между облаками. Перед cutover нужны свежий
согласованный DB/media snapshot, контроль всех writers и auth/data/media
acceptance. После Cloud.ru writes возврат DNS на старый Yandex snapshot потеряет
новые данные; reverse-transfer ещё не реализован/не испытан. Yandex ресурсы
этим workflow не удаляются.

`Configure Cloud.ru public HTTPS ingress` — отдельный **ручной** шаг после
успешного CI текущего `main` и loopback smoke обоих сервисов. Вход `target=api`
открывает только `api.fit-training.ru` → `127.0.0.1:18080`; `target=web` —
`fit-training.ru`/`www` → `127.0.0.1:18081`. Перед изменением nginx workflow
требует, чтобы системный DNS VM разрешал все имена выбранной цели **только** в
`87.242.117.210`. Он получает Let's Encrypt сертификат через HTTP-01 на 80,
после чего проверяет HTTPS на 443; certbot timer и nginx reload hook обеспечивают
продление. Без валидного сертификата HTTPS-конфиг не ставится; при ошибке
предыдущий nginx site восстанавливается. Для HTTP-01 публичная делегация NS
должна уже вести в Cloud.ru и соответствующие A-записи — на VM. Прежде чем
поменять A для apex/`www` на VM, необходимо установить frontend и проверить
его на loopback, иначе сайт получит простой. Поскольку сертификат выдаётся
после смены A, короткое окно до завершения HTTP-01 возможно: следить за
workflow и вернуть прежние A, если выпуск сертификата не проходит. TLS-ключи
остаются на VM, в GitHub/artifacts не выгружаются.

## Cloud.ru: стабилизация и проверяемая эксплуатация

14.10 ручные API/frontend38633109023/38633113898 выпустили d10c2d12;
после public release/readiness readback включены оба CLOUDRU autodeploy-флага.
Production web использует `https://fit-training.ru/api` через Nginx того же
домена; новые native builds используют `https://api.fit-training.ru`. Технический
Yandex origin не принимается production native validator. Старые установленные
bundles этим не переписываются. Backend provider выбирается DNS/API, не новым
доменных контрактом. Старые Yandex DNS/API пока не изменены; владелец разрешил их совместимость.
Manual workflow `Route legacy Yandex addresses to Cloud.ru` сначала делает inspect,
затем меняет только три A/CNAME записи старой зоны и отдельно revision старого API.
API проксирует в Cloud.ru с сохранением CORS Origin и сессии; credentials/DB
в image отсутствуют. Междоменный307 отвергнут реальным Chromium-тестом:
браузер меняет Origin на null. Прокси не повторяет запрос при сетевой ошибке.
Старые DB/resources/revisions сохраняются; предыдущая revision записана в summary.
Перед запуском Cloud.ru background выполнить mode pause-background: он проверяет
единственный старый fit-stage-push-dispatcher timer и его target/path, приостанавливает
только этот timer и проверяет PAUSED. Ресурс не удаляется; не включать одновременно
старый timer и Cloud.ru timer.
Старая app-session может потребовать повторного входа в Cloud.ru. Это не объединяет
независимые изменения двух БД. Повторный Yandex Terraform apply может вернуть
старый writer, поэтому YC_STAGE_TERRAFORM_AUTODEPLOY_ENABLED должен оставаться off.

Подготовленные main-only workflows включаются после их CI и ручной приёмки:

- `Configure Cloud.ru external AI`: mode cors-only исправляет www/native CORS
  отдельным candidate/rollback без внешних ключей и без включения AI. Mode
  external-ai берёт только существующие YandexGPT key,
  folder/model из pinned Lockbox version через GitHub OIDC; Supabase credentials
  не копируются, Yandex ресурсы/IAM не меняются. Synthetic model call и API
  candidate проверяются до замены root0600 runtime env, с rollback. Prompt и
  matching прежние. После success устанавливается CLOUDRU_AI_ENABLED=true и
  заново строится frontend; до этого программа Assistant выключена в сборке.
- `Configure Cloud.ru authenticated SpeechKit relay`: отдельный непривилегированный
  Podman relay на127.0.0.1:18084, текущая app-session проверяется через loopback
  API до открытия SpeechKit stream. `/stt` проксируется через существующий API
  HTTPS. Никаких DB/media credentials в relay; ограничения payload/auth buffer,
  срока соединения и ресурсов. Верхнеуровневые статусы сессий пишутся только в
  stdout unit `fit-speechkit.service` (читать: `journalctl -u fit-speechkit.service`),
  не в БД и не в Cloud Logging. Это не потоковый лог: максимум события подключения,
  открытия upstream, его результата и закрытия; журнал ограничен 120 записями в минуту.
  В событиях нет текста, аудио, токенов, IP-адресов или заголовков. До promotion —
  synthetic upstream и unauthenticated guard. После success установить
  CLOUDRU_SPEECHKIT_RELAY_URL=wss://api.fit-training.ru/stt и пересобрать web/native.
- `Configure Cloud.ru fresh background delivery`: только существующая VAPID
  identity, runtime DB role fit_api, systemd timer раз в минуту и flock без
  параллельных batches. По прямому решению владельца старые unsent и uncertain
  recovery receipts получают terminal history marker без удаления/повторной
  отправки; первый BACKGROUND_STARTED_AT не сдвигается повторным запуском.
  Обычные push и session cleanup работают в Cloud.ru; Telegram/Tracker feedback
  credentials этим workflow не переносятся. Владелец15.10 явно оставил эту
  доставку выключенной; обращения сохраняются без внешней отправки.
  Production15.10: fresh push и session cleanup активированы на ed7969d3
  (config38788301745, ops38788159966/38788392205/38790329441 success). Постоянная граница
  создана38781475448;24 старых unsent сохранены terminal history marker,
  повторная настройка явно пропускает архивирование. Старый Yandex timer PAUSED.
  Это проверка worker/queue, не доказательство доставки на конкретное устройство.
  Cloud.ru pooler не принимает startup statement_timeout: node-postgres query
  deadline задаётся query_timeout=10000, server limit — SET LOCAL
  statement_timeout='10s' после BEGIN каждой background transaction. Timeout
  установки считается ошибкой и приводит к rollback до business query.
  Успех таймера не доказывает успех worker: проверяйте Result сервиса и queue
  aggregates. Inspect workflow читает не более100 journal records за15 минут
  через allowlist sanitizer; raw messages, SQL и ключи в job output не выводятся.
  Launcher публикует только фиксированный этап/exit code, worker — существующие
  безопасные dispatch diagnostics. Исходный публичный VAPID хранится в repo
  variable VITE_VAPID_PUBLIC_KEY; после его изменения нужен rebuild frontend.
- `Backup and restore-check Cloud.ru production`: отдельный приватный bucket
  fit-cloudru-backups-c2ad3760. Разовый bootstrap, затем ежедневно05:35МСК.
  Bootstrap также включает versioning приватного media bucket; ежедневная
  проверка читает объекты и считает безопасный общий checksum без object paths.
  Versioning защищает последующие изменения, не восстанавливает старые версии
  задним числом. pg_dump17 custom archive шифруется AES-256-GCM до отправки; ключ v1 хранится
  только в CLOUDRU_BACKUP_ENCRYPTION_KEY и защищённом временном runtime env.
  Не перезаписывать/ротировать этот secret без сохранения старого ключа: иначе
  предыдущие backups не восстановятся. Срок хранения объектов пока не ограничен;
  контролировать объём. Лимит одного archive64MiB предотвращает расход памяти.
  После S3 readback/checksum/decryption выполняется настоящий restore на той же
  Cloud.ru VM в одноразовом PostgreSQL17 без сети/портов, с отдельным volume.
  Backup сохраняет grants; restore проверяет fit_api SELECT, RLS/owner трёх
  основных таблиц, число таблиц и migration history; пользовательские строки не
  печатаются, не попадают в artifacts и не копируются локально. Временные dumps,
  env и restore volume удаляются только в рамках свежего attempt. Native
  managed PostgreSQL backups не считаются доказанными этим механизмом.
- `Verify Cloud.ru production`: hosted read-only DNS/TLS/web/API/401 monitor
  каждые15мин, certificate margin14дней, безопасный JSON artifact без bodies.
- `Inspect Cloud.ru production operations`: ежечасно проверяет readiness,
  worker/relay/renewal timer, disk>=2GiB, certificates>=14дней и возраст последнего
  проверенного offsite restore<48часов. Manual renewal_check запускает bounded
  staging renewal dry-run без выдачи нового production сертификата. Отдельный
  short-lived owner container читает только counts push outbox в READ ONLY
  transaction (statement timeout5s): pending, overdue>15min, stale lease>10min
  и terminal failures за час; historical cutover marker исключён. Owner env
  удаляется EXIT и не передаётся runtime/relay/background.

Post-merge15.10: self-hosted runner имеет curl/jq и не имеет GitHub CLI.
Production streaming требует явный VITE_SPEECHKIT_RELAY_URL=wss://api.fit-training.ru/stt;
пустое или старое значение завершает streaming startup до microphone/network.
Существующий VoiceInputButton fallback recorder остаётся прежним. Legacy default
relay доступен только development; production bundle исключает этот адрес.
Configuration workflows читают GitHub API через bounded HTTPS curl с GITHUB_TOKEN,
затем сохраняют прежние exact-main/CI/running-image guards. S3 diagnostics выводит
только allowlisted code и HTTP status, без provider message/resource/request metadata.
После merge автоматически стартовавшие legacy orchestrator/push workflows отменены
на build до OIDC/publish/IAM. Эти workflows и summary выключены через GitHub
`disabled_manually`; перед rollback их можно отдельно включить обратно после решения.
Workflows сохраняют общий VM lock и не отменяют уже выполняющиеся операции.
Bootstrap/configuration не означают пройденный реальный OAuth/voice E2E;
приёмка двух тестовых ролей и свежие мобильные bundles фиксируются отдельно.
Web ingress передаёт ответы stage Nginx потоково (`proxy_buffering off`), чтобы
загрузка JS/CSS не зависела от записи больших ответов во временный каталог
системного Nginx. После установки конфигурации workflow скачивает целиком все
JS/CSS, перечисленные текущим `index.html`; одного статуса HTTP 200 недостаточно.

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

Для server-side расследования запустите ручной workflow `Diagnose Yandex stage`
с `Request ID`, окном не более 30 минут и, если она известна вызывающей стороне,
операцией вида `GET /health` без query. Отчёт явно показывает
`serviceName=fit-stage-api`, `resourceType=serverless_container`, активные на
момент диагностики revision/release и границу исполнения. Значения
`executionLayer=platform_invocation` означает наличие системной ошибки вызова.
Без соответствующего прикладного лога `handler=unknown`: отсутствие записи
не доказывает, что Fastify не запускался или что процесс не упал. Идентификаторы
платформы и приложения могут различаться. При наличии структурного Fastify-лога
отчёт использует фактические method/path и показывает `handler=entered`.

Фоновая ошибка простаивающего PostgreSQL-соединения обрабатывается общим
`PgDatabasePool`: драйвер удаляет повреждённое соединение, процесс продолжает
работать, а последующий запрос может получить новое соединение. В stderr
пишется `database_pool_idle_error` с безопасными категорией и кодом, без raw
error/client, SQL, параметров, адреса БД и credentials. Запросы и транзакции
автоматически не повторяются. `/health` и `/internal/warmup` не проверяют БД;
успешный health soak не доказывает восстановление PostgreSQL после разрыва.

### Диагностика и бюджет PostgreSQL-пула

`PgDatabasePool` пишет JSON `database_pool_window` в stdout (INFO) или stderr
(WARN при ошибках). `poolRole`: `api`, `dispatcher`, `migration-owner`,
`migration-runtime`, `function` либо `unspecified` для других consumers.
Это **агрегат одного пула одного процесса**, не общая метрика кластера.
Нет SQL/параметров/строк error.message/host/credentials/actor/request IDs.

- `poolMax`, `total`, `idle`, `occupied=total-idle`, `waiting` — snapshot драйвера.
  Occupied включает создаваемые соединения, не только выполняющиеся запросы.
- `totalMax`, `occupiedMax`, `waitingMax` — максимумы **наблюдённых** snapshots
  перед/после connect, постановки в очередь и release; это не непрерывный sampler.
- `acquired`, `acquireTotalMs`, `acquireMaxMs` — успешные получения соединения.
  Duration включает очередь **и** создание TCP/TLS/DB соединения; это не чистый
  queue-wait и не время SQL. Среднее = total/count; percentile не вычисляется.
- `acquireErrors`, `capacityErrors` (число `53300`), `failedAcquireMaxMs`, `idleErrors` и последний безопасный
  `databaseErrorCode`/`databaseErrorCategory` — ошибки окна. `53300` помечается
  `capacity`; ошибки pg без безопасного `.code`, включая некоторые acquisition
  timeouts, остаются `unknown`, без разбора/логирования текста ошибки.

Окно публикуется на первом завершённом connect/error, далее на следующем connect/error
после 60 секунд, плюс первая ошибка не чаще раза в 60 секунд и остаток при
штатном `end()`. Нет interval/background timer: в простое записей нет, процесс
не удерживается активным. Окна могут быть длиннее минуты; счётчики обнуляются
после публикации. Краш может потерять последнее незавершённое окно. Существующий
`database_pool_idle_error` остаётся немедленным на каждую idle-ошибку. Ошибка
connect пробрасывается без замены и без retry; release не меняется.

Конфигурация в репозитории: pool max=5 на процесс, idle timeout=10s, acquisition
timeout=5s. API и dispatcher используют один runtime DB-пользователь с
`conn_limit=20`, mode=SESSION, один primary host; owner имеет отдельный лимит5.
API concurrency=8, dispatcher concurrency=1 — **не** лимиты числа экземпляров.
Production workflow задаёт API min_instances=1; минимум также не является cap.
Пулы ленивые, так что max — верхняя граница, а не постоянное число соединений.

Верхняя граница runtime-бюджета при действующих defaults:
`5 × live API processes + 5 × live dispatcher processes + runtime preflight/other runtime clients ≤ 20`,
с дополнительным запасом для перекрытия старой/новой ревизий. Три API-процесса
и один dispatcher уже могут занять все20; четыре API — без запаса dispatcher.
Migration runner runtime preflight тоже относится к этому пользователю,
owner-пул — нет. Сейчас `yandexDatabasePool()` не вызывается функциями; если
его подключат, такой consumer тоже войдёт в runtime-бюджет.

После deployment проверять в Cloud Logging окна API и dispatcher, особенно
`waitingMax>0`, рост acquisition duration и `53300`; сопоставлять с Managed
PostgreSQL Monitoring connections по runtime-пользователю/host и числом живых
экземпляров/ревизий обоих контейнеров. Snapshot нескольких пулов не заменяет
общую DB-метрику. Проверить реальную cloud-конфигурацию на drift, overlap при
выкладке и запас до20. Не увеличивать лимит по одному 502 или числу пользователей:
эта правка собирает доказательства, не доказывает прежнюю причину 502.

Источники: [node-postgres pool API](https://node-postgres.com/apis/pool),
[Yandex SESSION conn_limit](https://yandex.cloud/ru/docs/troubleshooting/managed-postgresql/how-to/conn-limit-parameter).

## Проверка доступности Yandex API после deployment

`.github/workflows/deploy-yandex-stage.yml` проверяет обновлённую ревизию в два
этапа. Сначала health/readiness и продуктовый smoke доказывают контракт самого
кандидата. Ошибка этого этапа безопасно возвращает предыдущую ревизию. Затем,
после пятиминутного окна применения scaling policy, отдельный verifier выполняет
последовательные запросы `/health` строго без retry.

Перед продуктовым smoke workflow повторно вызывает существующий приватный
fixture runner: только синтетические тестовые сессии выдаются после успешного
bootstrap, а не переиспользуются после IAM/dispatcher/deployment. Их TTL остаётся
15 минут; TTL пользовательских сессий и авторизация не меняются. Для всех четырёх
сессий проверяется запас на общий 10-минутный бюджет и ещё 60 секунд.
`scripts/yandex-stage-smoke.mjs` ограничивает connect timeout до 5 секунд,
каждый запрос до 30 секунд и остатка общего бюджета; все продуктовые запросы
выполняются без автоматического retry, включая mutation и 401. Ожидаемые 409
по-прежнему проверяются как часть контракта, а не транспортный отказ.
Диагностика содержит этап, метод, обезличенный маршрут, HTTP, технический
request ID, безопасный код и release; payload, token, подписанный URL и query
не публикуются. Любой провал проверки сохраняет откат API и блокировку frontend.
Сообщение об откате различает health/readiness и продуктовый smoke; оно не
доказывает, что отказ был именно в `/ready`.

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

API задаёт Fastify `maxRequestsPerSocket=1` и `keepAliveTimeout=5000`.
Provisioned Serverless Container может быть приостановлен вместе с CPU, поэтому
одного idle-таймера недостаточно: он может не успеть исполниться до потери
сетевого соединения. Ограничение в один запрос заставляет HTTP-ответ явно закрыть
runtime socket до приостановки, а короткий timeout остаётся запасной защитой.
Отдельный `fit-stage-api-warmup` timer раз в минуту отправляет `POST
/internal/warmup` через собственный service account. Endpoint отвечает `204` и
не читает БД, Lockbox или внешнюю сеть; trigger делает не более двух повторов с
интервалом 10 секунд. Это около 43 200 обычных invocation в 30-дневный месяц и
не создаёт дополнительный provisioned instance.

Frontend дополнительно защищает записи: если ни один ответ Yandex API с
`x-fit-request-id` не был получен последние 45 секунд, перед mutation выполняется
общий `/health` preflight. Исходный `POST`/`PUT`/`PATCH`/`DELETE` отправляется
ровно один раз и только после успешного preflight; повторять неизвестный
результат mutation запрещено. Безопасные `GET` сохраняют однократный retry после
восстановления runtime.

Не возвращайте повторное использование socket и не удаляйте timer/preflight без
повторной 50-минутной проверки: runtime может получить оборванное соединение и
вернуть `502 Error during function invocation` до входа запроса в приложение.

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

## DataLens после переезда на Cloud.ru

Кластер `fit-stage-postgres` (`10.70.10.67:5432`, база `fit`) не имеет публичного
адреса. Внешний DataLens (Yandex Cloud) читает схему `analytics` через ВМ
`fit-stage-app`: nginx stream слушает `55432` и без разрыва TLS пробрасывает
TCP к кластеру (`infra/cloudru/nginx-stream-datalens.conf`). Пускаются только
адреса DataLens; тот же список нужен в группе безопасности публичного IP ВМ.

1. Пользователь `fit_datalens` создаётся в консоли Cloud.ru (вкладка
   «Пользователи» кластера); пароль хранится только у владельца и в DataLens.
2. Миграция `000147` выдаёт ему только чтение схемы `analytics` (и права по
   умолчанию на будущие представления); без роли ничего не делает.
3. Проброс ставит ручной `configure-cloudru-datalens-proxy.yml`: сначала
   `mode=inspect`, затем `mode=apply` с `confirmation=OPEN_DATALENS_DB_PROXY`.
   Шаг проверяет доступность кластера, `nginx -t` с откатом и ответ PostgreSQL
   на SSLRequest через проброс.
4. В DataLens редактируется существующее подключение (не создаётся новое):
   хост `87.242.117.210`, порт `55432`, база `fit`, пользователь
   `fit_datalens`, TLS включён.

Закрыть доступ: удалить `/etc/nginx/fit-stream.d/datalens.conf`, `nginx -t`,
reload, и убрать правило `55432` из группы безопасности.

## Служебная плашка о восстановлении ИИ

Временный build-time флаг сборки Cloud.ru (`.github/workflows/prepare-cloudru-frontend.yml`):

```text
VITE_SERVICE_NOTICE_ENABLED=true
```

Только точное `true` показывает над содержимым каждого экрана клиента и тренера
(кроме Live и переписки) плашку «Fit снова работает» о том, что ИИ-функции
восстанавливаются. Крестик скрывает её до конца текущего запуска
(`sessionStorage`, ключ `fit.serviceNotice.dismissed`); следующий запуск
приложения или новая вкладка показывают её снова. Это только уведомление: функции, авторизация и
данные не меняются. Текст — `src/app/service-notice.tsx`. Чтобы снять плашку,
выставить `'false'` и выпустить фронтенд Cloud.ru; старые сборки Yandex Cloud и
уже установленные нативные приложения её не получают.

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
Yandex frontend deployment. Уже открытая вкладка со старым JS bundle не узнает о новом
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

`Background dispatch failed` означает перехваченную ошибку обработчика и HTTP
500, а не доказанный platform-level 502. Запись содержит `request_id`,
`releaseId`, `durationMs`, `dispatchOperation` (`push`/`app_feedback`) и
`dispatchPhase` (`prepare`/`finalize`). `prepare` включает получение соединения,
подготовку/claim и commit; `finalize` — транзакцию фиксации результата доставки.
`errorCode` содержит безопасный SQLSTATE/сетевой код или `unknown`,
`errorCategory` — классификацию существующего DB adapter. При двойном сбое
транзакции и rollback исходный код сохраняется отдельно от `rollbackErrorCode`.
Текст, stack, SQL, payload и произвольное имя ошибки не логируются.
Общий параллельный запуск по-прежнему сообщает первый отказ: эта запись не
означает, что вторая задача не выполнялась. Повторы отправки не добавлены.
Причина инцидента 24 сентября по старому сообщению пока не установлена.

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

Одноразовое сообщение о переходе на `fit-training.ru` управляется workflow
`Manage domain-change push announcement`. Сначала запустите `inspect` с пустым
confirmation: он возвращает только число пользователей, подписок и уже
поставленных строк, не читая PII и не меняя outbox. После проверки текста и
агрегатов `enqueue` требует точную строку
`QUEUE_DOMAIN_CHANGE_ANNOUNCEMENT`. Producer ставит не более одной строки на
активную подписку и повторно безопасен. Пользователи, явно выключившие все
категории уведомлений, исключаются; отсутствие preference сохраняет прежнюю
default-on семантику подписки. По нажатию открывается `/`: сохранённая старая
origin проходит через legacy redirect, новая сразу остаётся на каноническом
домене. Доставку, как и для остальных сценариев, выполняет минутный dispatcher.

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

Это **legacy Supabase secrets** для сохранённых legacy media/rollback путей.
Новые изменения схемы в `supabase/migrations` больше не добавляются. Workflow
`.github/workflows/deploy-database.yml` пока технически существует и сработает,
если изменить legacy migration-файлы в `main`; не используйте его для новой
функциональности и не запускайте вручную без отдельного решения о legacy
исправлении. Новые numbered migrations в `services/api/db/migrations`
применяет `.github/workflows/deploy-yandex-stage.yml` до переключения
API-ревизии. Запуск SQL через Dashboard запрещён. Production frontend
публикуется на `fit-training.ru` через Yandex Gateway/Object Storage; Vercel
остаётся только для legacy redirect; новые Preview отключены. Service role и
DB password никогда не помещаются в публичный frontend build.

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

### Yandex frontend autodeploy

`.github/workflows/deploy-yandex-frontend.yml` публикует только текущий `main`
после успешного CI merge-коммита. Repository variable
`YC_FRONTEND_AUTODEPLOY_ENABLED=true` — отдельный выключатель публикации;
отсутствие или любое другое значение не запускает cloud deployment.
Включать только после подготовки scoped IAM и GitHub environment.
Сборка использует public configuration environment `fit-frontend-candidate`;
публикация — `fit-frontend-production`, разрешён только branch `main`,
environment variable `YC_FRONTEND_DEPLOY_SA_ID` содержит отдельный service
account ID. Постоянные ключи и backend deploy identity не используются.

Повторный запуск требует ID успешного `CI` run текущего `main`. Публикации
сериализованы; старые сборки не перезаписываются, assets прежних версий
сохраняются. При ошибке после activation выполняется проверяемый rollback;
при неопределённом статусе облачной операции или чужой конфигурации требуется
оператор, слепого повторного переключения нет. Backup OpenAPI сохраняется
в artifact deployment run на 90 дней.

Неизменившиеся файлы следующего релиза переиспользуются после проверки SHA-256
фактических bytes в Object Storage; повторный PUT для них не выполняется.
Загрузка и проверки файлов выполняются максимум в шесть параллельных потоков.
GET/HEAD-проверки остаются: экономия загрузки не означает отсутствие запросов.
Приватный `releases/<release>/release-manifest.json` фиксирует ссылки на файлы
и предыдущую конфигурацию шлюза; deployment не изменяет bucket policy.

`.github/workflows/cleanup-yandex-frontend.yml` использует тот же lock публикации.
Ручной запуск по умолчанию — `mode=plan`: только инвентаризация и artifact с
точными кандидатами. Удаление и ежедневный запуск (06:17 МСК)
разрешены только при repository variable `YC_FRONTEND_CLEANUP_ENABLED=true`.
До включения необходимы успешная публикация с manifest, проверенный dry-run и
отдельно настроенные минимальные права ListBucket для `releases/` и DeleteObject
только для `releases/*`; общий `storage.editor`/`storage.admin` не требуется.
У frontend deployer дополнительно настроены bucket ACL READ+WRITE (не FULL_CONTROL)
как первичный gate Object Storage; bucket policy разрешает DeleteObject только
`releases/*` и явно запрещает DeleteObjectVersion. Служебное wildcard-правило
консоли исключает deployer через NotPrincipal, не расширяя его scoped policy.
Время cron — целевое: GitHub может задерживать scheduled run. Даже при отказе
планирования artifact содержит `cleanup-inventory-summary.json` с количеством
объектов, маркеров каталогов и некорректных размеров/дат, без сырых cloud responses.
Пустые legacy-маркеры каталогов сохраняются: отсутствие `size` в YC CLI
допускается только для канонического маркера с ETag пустого объекта. Отсутствие
размера у обычного файла и некорректная структура по-прежнему блокируют удаление.
Перед удалением HEAD проверяет `last_modified_at` с точностью HTTP Last-Modified
(секунды; ListObjectsV2 содержит миллисекунды), точный размер и ETag. Изменившиеся
или отсутствующие метаданные останавливают удаление, а не пропускают проверку.

Очистка сохраняет текущий и предыдущий релизы независимо от возраста, а также
все релизы за последние 3 дня. Общие файлы удаляются только после исчезновения
ссылок из всех сохраняемых релизов и активного шлюза. Сначала удаляются старые
маршруты совместимости, затем проверяются сайт и неизменность шлюза/объектов,
и лишь затем удаляются точные ключи. Неизвестная структура останавливает очистку;
старые загрузки без manifest не удаляются автоматически. Скрипт не очищает
noncurrent object versions. В текущем бакете versioning включён; 27 сентября
по решению пользователя сохранено и проверено отдельное lifecycle-правило только
`NoncurrentVersionExpiration=3 days` для `releases/`, без Expiration текущих
объектов. Оно удаляет скрытые версии ещё через 3 дня после их перехода в
нетекущее состояние. Хранение backup artifact 90 дней не гарантирует наличие
файлов для отката старше 3 дней. Подробнее: `docs/design/FRONTEND_RELEASE_EFFICIENCY.md`.

WASM читаются публично только по bucket policy `releases/*/assets/*.wasm`.
Public read включён с этой ограничивающей политикой; list/config read закрыты.
Нельзя удалять policy при включённом public read. Deployment не меняет ACL:
перед activation проверяет WASM bytes/MIME/CORS и анонимный 403 остальных
файлов/listing. Роли `storage.uploader` на frontend-бакет достаточно для записи;
`storage.editor`/`storage.admin` публикации не выдаются.

Шлюз и frontend-бакет общие для технического адреса и `fit-training.ru`;
DNS propagation не требуется для smoke через технический адрес. Vercel
сохраняет только ранее опубликованный legacy redirect и этим workflow не
управляется. План, IAM scope,
ограничения и ручной откат: `docs/design/YANDEX_FRONTEND_AUTODEPLOY.md`.

### Vercel (только legacy redirect)

Vercel больше не является точкой production-публикации `fit-training.ru`.
GitHub repository отключён от Vercel-проекта `fit`; ранее опубликованный
production deployment при этом остался активным. Дополнительно `vercel.json`
устанавливает `git.deploymentEnabled=false` для всех веток на случай повторного
подключения.
Workflows для `/preview`, синхронизации старого пилотного preview и удаления
preview-веток отключены; новых Vercel releases после merge или по комментарию
быть не должно. Текущий production deployment и сам Vercel-проект сохраняются
для `308`-редиректа `fit-drab.vercel.app` на `fit-training.ru` с путём и query.
Проверка редиректа — `Verify production domain redirect` каждые шесть часов.
Тот же read-only workflow замеряет `fit-training.ru/auth` через системный DNS,
DNS Яндекса, Cloudflare и Google, обращаясь по каждому A-адресу с настоящими
Host/SNI, затем проверяет критические JS/CSS assets. JSON artifact содержит
UTC-время каждого запроса и DNS/TCP/TLS/TTFB/total, но не тело ответа, cookie,
токены или идентификаторы пользователей. Локально запустить можно командой
`node scripts/probe-production-frontend.mjs`; делать это следует из проблемной
сети, поскольку переключение DNS на одном хосте не заменяет проверку из разных
сетей. Порог 5 секунд делает job красным и помогает зафиксировать интермиттентный
сбой, но сам по себе не устанавливает его источник.

### Frontend Gateway cold-start experiment

Support ticket [WD756227](https://center.yandex.cloud/support/tickets/WD756227)
suggests Gateway idle/cold start as a possible cause of slow initial HTML, but
did not provide per-request traces. The frontend deployment specification now
reserves `GET/HEAD /healthz` for a tiny `dummy` response
`fit-gateway-ready` (`text/plain`, `no-store`). This checks only that Gateway
can execute a static route; it does **not** verify Object Storage or the app.
The deploy smoke verifies the exact status, body and headers before accepting
a release. The route is not an auth/API endpoint and carries no user data.

`.github/workflows/warm-yandex-frontend-gateway.yml` is an opt-in, read-only
five-minute experiment. After `/healthz` is live, run it manually once, then
set repository variable `YC_FRONTEND_GATEWAY_WARMUP_ENABLED=true` to enable the
schedule. Each run requests `/healthz`, then `/auth` on the same resolved IP and
logs only UTC time, IP, status and connection/TTFB/total timings. A slow response
is recorded but does not fail the run; an invalid/unreachable route does. No
chat notification, credential or production data is sent. Disable the variable
after the observation window if this does not improve HTML latency. Scheduled
GitHub runs can be delayed or dropped, so this is **not** a reliable permanent
availability mechanism; the separate six-hour frontend probe remains active.
Compare the paired timings and Yandex Monitoring before and after activation,
including whether a slow dummy is followed by fast HTML. That pattern supports
but does not prove cold start; a fast dummy with slow HTML points beyond the
static Gateway route.

#### Bounded hourly Cloud Function experiment

Support follow-up on 2026-10-05 recommends testing an hourly Cloud Functions
timer rather than assuming the GitHub five-minute schedule is reliable.
`deploy-yandex-frontend-probe.yml` is **manual-only**, defaulting to `inspect`.
Code merge does not create resources. After owner cost approval, dispatch from
`main` with `action=enable` and `cost_approved=true`. It reuses the existing
stage deployment OIDC identity and `fit-stage-api-warmer` timer identity; the
latter receives only function-scoped `functions.functionInvoker` on
`fit-frontend-hourly-probe`. The runtime has no service account, secrets, VPC,
provisioned instance, or access to app data. The function is private.

IAM preflight on 2026-10-05 confirmed that the stage deployer has folder-level
`functions.editor`, not `functions.admin`. Editor can create/invoke functions
and manage timers, but cannot assign function access bindings. Before the first
approved enable, an existing Cloud administrator must bootstrap the private
`fit-frontend-hourly-probe` function and grant the deployer `functions.admin`
**only on that function**, plus the existing timer identity its scoped invoker
binding. Do not grant folder-wide Functions admin. The deployment then maintains
only that function policy. The owner approved the bounded trial on 2026-10-07;
the private function was bootstrapped with function-scoped deployer admin and
timer invoker bindings. Local/mocked tests alone do not prove IAM authorization.
Role requirements:
[Functions access control](https://yandex.cloud/ru/docs/functions/security/).

The workflow packages only the dependency-free probe modules, creates a
Node.js 22 candidate (128 MB, 60-second limit, concurrency 1), and invokes it
once before promoting `hourly-probe`. The hourly timer (`17 * * * ? *`, UTC)
never follows `$latest`; a malformed candidate leaves the live tag/timer
unchanged. An actual measured HTTP failure is valid experiment data, not a
failed handler. Unavailable inventories or unexpected existing timer settings
fail closed instead of creating duplicate resources. Re-enabling explicitly
starts a new 24-hour window.

YC CLI represents a timer configured with retries as
`rule.timer.invoke_function_with_retry`, including `retry_settings` (attempts
may be encoded as a string). Validate the target, tag, invoker and exactly one
retry with a `10s` interval against this envelope for reuse and readback.
Run `37652274384` created an ACTIVE timer and passed candidate smoke, but the
initial readback validator expected the non-retry field and reported failure.
Owner readback confirmed the reviewed settings: do not rerun `enable` merely
to make that run green, because it would restart the observation window.
The first window expires at `2026-10-08T16:30:27.515Z`. GitHub warmup was
disabled at `2026-10-07T16:28:03Z`; the independent six-hour probe remains on.

Each invocation makes at most two sequential GETs on one resolved Gateway IP:
`/healthz` then `/auth`, with separate absolute 20-second deadlines and bounded
DNS resolution. One JSON log records UTC, IP, status, sanitized error code and
DNS/TCP/TLS/TTFB/total timings. Response bodies and invocation events are never
logged. Network failures do not trigger handler retries; the timer allows one
platform retry. No chat notifications are emitted. After 24 hours the function
returns `expired` without DNS/HTTP work. The timer itself still invokes this
small no-op until `action=disable` pauses it; pause after collecting the window.
Do not enable the GitHub warmup concurrently: disable
`YC_FRONTEND_GATEWAY_WARMUP_ENABLED` when starting the approved Cloud experiment
and record the UTC boundary. Keep the independent six-hour frontend probe.

Estimate using official Russian rates on 2026-10-05: 744 hourly calls per
31 days, 128 MB × 60 seconds, two Gateway requests per call. Without remaining
free allowance: about 10.27 RUB/month for computation/invocations/Gateway
requests, or about 21 RUB with one retry on every call; outbound traffic and
short logs are additional. Free allowances may cover these quantities but are
shared with other workloads, so do not promise a zero bill. The 24-hour window
is about 0.66 RUB under the doubled conservative assumptions, plus one smoke,
traffic/logging and expired no-op calls until paused. No VM is required.
Sources: [Cloud Functions pricing](https://yandex.cloud/ru/docs/functions/pricing)
and [API Gateway pricing](https://yandex.cloud/ru/docs/api-gateway/pricing).

Compare actual trigger cadence and paired p50/p95/max/timeout counts with
manual runs `37192113317` and `37210424060` and the independent external probe.
The Cloud network is another vantage point, not proof of user-network
availability or a guaranteed cold-start fix. Send support UTC examples and
both route timings if HTML remains slow. Inspect/disable work without another
cost-approval input; no resources are deleted and the frontend/API/DB are not
reconfigured.

В Yandex Monitoring для frontend API Gateway настроены `FIT frontend gateway:
slow responses` (p99 latency, warning >5 c, alarm >10 c) и `FIT frontend
gateway: HTTP 5xx` (ошибки 5xx). Slow-response alert остаётся на графике без
уведомлений в чат; 5xx уведомляет только при Alarm/Error с часовым подавлением
повторов, не при каждом срабатывании. Метрика задержки охватывает весь ответ
шлюза; она не разделяет время самого Gateway и получения объекта из Storage.
Когда экран ещё пуст, сопоставляйте UTC-время и IP из probe artifact с графиком
задержки; если HTML быстро получен, отдельно диагностируйте загрузку JS и
восстановление сессии. Для обхода внешнего пути через GitHub runner без PII
используйте ручной запуск этого workflow. Отсутствие 5xx-метрики при нуле
ошибок — нормальное состояние, а не доказательство доставки уведомления.
Не удаляйте проект, домен или текущий deployment. Если понадобится удалённый
PR Preview, сначала спроектируйте отдельную Yandex-hosted среду.

Исторические настройки Vercel-проекта:

- repository: `podkolzinpd/fit`;
- framework preset: Vite;
- production branch: `main`;
- build command: `npm run build`;
- output directory: `dist`.

Исторический startup rollback #1144 требовал Supabase env. Эта зависимость
устранена: production web/Android/iOS собираются без `VITE_SUPABASE_*`.
Frontend SDK не создаётся при импорте; production transport отклоняет любую
legacy операцию локально даже при stale env. Yandex-only AuthProvider не
подписывается на Supabase Auth и не вызывает legacy signOut/getSession для
обновления/выхода из app-session. Таймауты Yandex session и UI states сохранены.
Два legacy storage bucket API тоже ленивые; SDK создаётся только при явном
локальном legacy обращении с локальной конфигурацией. Только явные modes
`development`/`test` допускают legacy SDK; URL остаётся localhost даже когда
Vite build выставляет `PROD=true`. Release modes закрыты. Dummy credentials нет.

Production iOS guard проверяет `VITE_YANDEX_API_BASE_URL` как remote HTTPS origin,
публичный `VITE_YANDEX_OAUTH_CLIENT_ID` и точное `true` app-session/main routing/
native registration/Yandex-only switches. Supabase config не заменяет их.
CI Yandex-auth lane собирает production bundle и проверяет его через Vite
preview/WebKit без Supabase env/services; локальные frozen legacy lanes остаются.

С 15.10 release graph также исключает сам SDK: Vite alias
`#fit/local-auth`, `#fit/local-data`, `#fit/local-assistant` выбирает local adapters только в точных modes
`development`/`test`. Все остальные modes используют native-only composition;
проверка emitted chunks отклоняет SDK/client/local composition. Отсутствующие
flags или native session не разрешают legacy backend. Production flags/API
origin по-прежнему должны быть настроены по native contract выше.

Удаление env из workflow не удаляет GitHub Secrets или Supabase проект.
Серверные bridge secrets/media/migration/rollback tooling пока сохраняются.

`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, service-role key и OAuth Client
Secret во frontend build не добавляются.

Лицензированные Vital Gym Pro media также не требуют закрытых переменных в
Vercel. Зашифрованный bundle публикуется только workflow `Deploy Vital exercise
media`, использующим GitHub secrets `VITAL_MEDIA_KEY`, `SUPABASE_ACCESS_TOKEN`
и `SUPABASE_PROJECT_ID`. Файлы находятся в private bucket
`fit-exercise-media`; policy разрешает чтение только роли `authenticated`, а
frontend создаёт короткоживущие signed URL.

### Build-time флаги production frontend

Текущий источник production-значений — шаг build в
`.github/workflows/prepare-cloudru-frontend.yml`: переменную нужно явно
передать в его `env` (из GitHub variable/secret либо фиксированного значения),
а после изменения выполнить штатный Cloud.ru frontend deployment с зелёного
актуального main. Старый Yandex workflow — только сохранённый rollback-контур,
не цель новых выпусков. Одной записи в GitHub Variables без подключения в build
недостаточно.

Закрытые исправления ввода плана (17.10) используют независимые переменные:

Для этого выпуска они задаются в GitHub environment `fit-frontend-candidate`,
где уже хранится действующий fixed2 reference-пилот. Сам reference allowlist
не изменяется; новая функция получает собственные переменные с той же
подтверждённой парой. Чтение только repository-level variables не показывает
environment-level настройки сборки.

```text
VITE_COACH_PLAN_INPUT_ENABLED=true
VITE_COACH_PLAN_INPUT_PILOT_USER_IDS=<profile-id-1>,<profile-id-2>
VITE_COACH_PLAN_LAYOUT_ENABLED=true
VITE_COACH_PLAN_LAYOUT_PILOT_USER_IDS=<profile-id-1>,<profile-id-2>
```

Default-off: нужно точное `true`, ровно два разных ID и роль trainer с прежним
coach-workout-reference доступом. Другая учётка, третий Lime-тренер, клиент,
пустой/дублированный/расширенный список и старые сохранённые настройки не
включают пилот. Это не авторизация данных; backend ownership/version прежние.
План сохраняется явно. Локальный edit draft изолирован от копии и принимается
только для той же версии плана; ошибка сети сохраняет ввод. Откат: флаг false
и новый deployment, без изменения тренировочных данных. Состав прежнего fixed2
не расширять. План приёмки — docs/design/COACH_PLAN_AND_LIVE_FIXED2_20261017.md.
Флаг PLAN_LAYOUT независим от PLAN_INPUT и имеет те же default-off/exact2
правила. Он меняет только плановый trainer UI: геометрию, подписи и доступность
существующего RPE в суперсетах. Оба списка задаются самостоятельно в
fit-frontend-candidate; переключатель плотности планировщику не добавлен.

Два вида тренерского Live включаются независимо в том же environment:
`VITE_COACH_LIVE_DENSITY_ENABLED=true` и
`VITE_COACH_LIVE_DENSITY_PILOT_USER_IDS=<profile-id-1>,<profile-id-2>`.
Точное true/exact2/trainer/server Lime/прежний reference обязательны; пустая или
расширенная конфигурация закрыта. Состав прежней пары не менять. Локальный
per-user/device выбор original/compact сам по себе доступа не даёт. Kill switch:
LIVE_DENSITY_ENABLED=false и deployment, без мутации данных/плана/таймера.

Закрытый пилот Apple Health использует build-time переменные:

```text
VITE_WEARABLES_ENABLED=true
VITE_WEARABLES_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

По умолчанию и при пустом allowlist интеграция скрыта. Изменение списка требует
нового deployment. UUID попадают во frontend bundle, поэтому этот механизм
служит только для rollout интерфейса и не является границей авторизации.

Ассистент в production доступен тренерам и клиентам. Его build-time переменная
может служить аварийным выключателем после нового deployment:

```text
VITE_ASSISTANT_NAV_ENABLED=true
```

По умолчанию production rollout включён; точное `false` скрывает вкладку и закрывает
маршрут для обеих ролей после нового deployment. `VITE_ASSISTANT_NAV_PILOT_USER_IDS`
и `VITE_ASSISTANT_NAV_PILOT_EMAILS` сохраняются только для изолированной
локальной разработки и в production игнорируются. Клиентский ассистент
автоматически использует собственную карточку; данные и мутации защищены
серверными role/ownership-проверками.

Закрытый пилот приветствия в шапке «Сегодня»/«Кабинет» использует build-time
переменные:

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

Одноразовое окно победителю конкурса управляется build-time переменными
production-сборки `fit-training.ru` — GitHub repository variables, которые
читают `prepare-yandex-frontend.yml` и `deploy-yandex-frontend.yml`:

```text
VITE_CONTEST_WINNER_ENABLED=true
VITE_CONTEST_WINNER_PILOT_USER_IDS=<profile-uuid-победителя>
```

Механизм default-off: без переменных, при пустом allowlist или значении флага
кроме точного `true` окно никому не показывается. После изменения переменных
нужен новый frontend deployment. Контакт приходит как обычное сообщение
обратной связи (Telegram/Tracker) с «Кодом сообщения»; автор проверяется
запросом `select user_id from public.app_feedback where id = '<код>'`.
После 13.10.2026 окно скрывается кодом; переменные после вручения приза
удаляются. UUID виден в публичном bundle и не является авторизацией.

Финансовый кабинет тренера включён для всех тренеров. Пустой allowlist означает полный
rollout; непустой временно ограничивает интерфейс указанными UUID:

```text
VITE_TRAINER_FINANCE_ENABLED=true
VITE_TRAINER_FINANCE_PILOT_USER_IDS=
```

Frontend allowlist не является авторизацией: Yandex API отдельно проверяет роль
тренера и владельца каждой финансовой записи. `VITE_TRAINER_FINANCE_ENABLED=false` служит аварийным
kill switch. Изменение значений требует новой production-сборки frontend.

Supabase-based linking выведен из эксплуатации 20.10.2026. Удалены UI-карточка,
обязательный gate, transport и GET/POST `/v1/auth/yandex/link` (404).
`VITE_YANDEX_SESSION_LINKING_ENABLED` и `VITE_YANDEX_ACCOUNT_LINK_REQUIRED`
больше не читаются и не возвращают старый сценарий при наличии в старой сборочной
конфигурации. Существующие `app_private.auth_identities` и native Yandex
app-session/registration не меняются; миграции и identity-записи не удаляются.
Незавершённый legacy OAuth intent `link` очищается с предложением повторить
обычный вход, без передачи его кода в API. Supabase credentials пока нужны
media/legacy functions/migration/rollback и этой задачей не удаляются.

### Retired legacy AI HTTP compatibility

В основном API удалены POST `/v1/legacy/parse-workout`,
`/v1/legacy/summarize-client-training` и `/v1/assistant/progress-summary`.
Ожидаемый ответ404 с любыми credentials; aliases или native fallback не добавлены.
`server.ts` больше не создаёт Supabase parser и legacy summary adapter.
Native AI routes и model configuration прежние. Исходники Cloud Functions,
их shared adapters, prompts и deploy workflows сохранены. Supabase credentials
не удалять: они ещё нужны legacy media/functions/tooling. CORS legacy header
остаётся нужен media bridge. Frontend transport к этим трём API удалён. `VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL`
сохранён для media bridge; при заданном валидном override legacy AI generation
завершается локальной ошибкой без HTTP/refresh и без переключения на Cloud Function.
Без override прежний прямой Cloud Function-путь сохранён. Native app-session имеет
приоритет и не зависит от этого override. Legacy diagnostics закрыта без сети;
native diagnostics не менялась.

Stage API CORS allowlist обязан содержать production web origin, точный
`capacitor://localhost` для iOS и точный `https://localhost` для Android.
`http://localhost` без порта и произвольные `capacitor://` origins не
разрешаются. Изменение выполняется через
`TF_VAR_api_cors_allowed_origins` в deployment workflow, а не вручную в
активной ревизии контейнера.

### Android shell для RuStore

Исходный Android-проект находится в `android/` и использует тот же Capacitor
`appId` `com.coachspace.fit`. Для локальной синхронизации выполните
`npm run android:sync:local`; `npm run android:debug` дополнительно собирает
debug APK в `android/app/build/outputs/apk/debug/`. Нужны JDK 21, Android SDK
Platform 36 и Build Tools 36.0.0. Минимальная версия устройства — Android 8.0
(API 26), как требует нативный health-плагин. В PR Android debug APK проверяется отдельным
CI workflow и сохраняется на 7 дней как `fit-android-debug`. Локальная
development-сборка не подключена к production Yandex API.

Для проверки входа вручную запустите `Android debug build` на `main` через
GitHub Actions `workflow_dispatch`. Job `auth-smoke` соберёт APK с production
Yandex API/ID конфигурацией и сохранит артефакт `fit-android-auth-smoke-apk`
на 7 дней. Это debug-подпись и сборка только для тестирования, не для RuStore.

Android WebView имеет origin `https://localhost`; scheme и hostname закреплены
в `capacitor.config.ts`. Yandex OAuth открывается во внешнем браузере, поэтому
Android регистрирует callback `com.coachspace.fit://auth/yandex/callback` и
возвращает код через app deep link. Этот Redirect URI зарегистрирован в
настройках Yandex OAuth 2 октября 2026 г.; `https://localhost/auth/yandex/callback` во внешнем
браузере не вернёт код в Android WebView. Этот шаг не считается выполненным по
успешной сборке APK или настройке CORS. После него нужен ручной smoke
на устройстве: Yandex ID, callback, загрузка данных обеих ролей, выход и
повторный вход. Перед публикацией в RuStore нужны отдельный release keystore,
подписанная release APK/AAB, проверка целевой сборки и карточка приложения.
Keystore и `google-services.json` не размещаются в репозитории.

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

# Yandex production frontend build (GitHub Actions)
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

Stale Supabase session не выбирает production auth/data backend. Новый bundle
не инициализирует SDK, не обновляет legacy token и не обращается к Supabase даже
при старых frontend env. Авторизованный пользователь без подходящей app-session
остаётся в закрытом Yandex состоянии. Сборки web/Android/iOS не требуют Supabase
переменных; rollout требует штатного выпуска соответствующих bundles. Серверные
Supabase secrets сохраняются для legacy media/migration/rollback.
Локальная разработка сохраняет свои legacy настройки.

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

Физическая очистка `app_private.yandex_app_sessions` вынесена из входа и atomic
legacy recovery в существующий приватный минутный dispatcher. Migration131
добавляет SQL-функцию без параметров: максимум 50 просроченных неотозванных и
50 отозванных строк за вызов, упорядоченных по времени через отдельные partial
indexes; `FOR UPDATE SKIP LOCKED` пропускает занятые строки. Время берётся из
БД, HTTP payload не задаёт cutoff или размер порции. Активные сессии сохраняются,
а истёкшие/отозванные запрещены для авторизации сразу, до физического удаления.
Нового таймера, облачных ресурсов или IAM-прав нет; запуск работает и без
feedback-интеграций. Ошибка очистки не отменяет push/feedback, не повторяется
внутри вызова и проверяется снова следующим timer. Safe events:
`yandex_session_cleanup` (`deleted`, включая 0) и
`yandex_session_cleanup_failed` (dispatchOperation=`auth_sessions`, dispatchPhase=`cleanup`,
allowlisted category/code без текста ошибки, токенов и profile IDs).
При постоянном failed или длительном deleted=100 проверьте доступность БД и
темп накопления: порция ограничена, полное осушение за одну минуту не обещается.
Down возвращает прежние функции входа/recovery, но не восстанавливает уже
удалённые недействительные сессии. Ручной production SQL не требуется.

Frontend ограничивает OAuth exchange, восстановление и отзыв Yandex
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
actor/tenant ownership и правами БД. Изменение флага требует нового Yandex frontend
deployment. До завершения full-cohort export/import и rehearsal включать его
нельзя. Rollback после начала mutations требует согласованного окна и проверки
расхождений данных, а не только выключения frontend-флага.

Серверное назначение для первого перенесённого tenant управляется отдельно от
frontend build через ручной GitHub Actions workflow `Manage Yandex stage rollout`.
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
  не меняет frontend-флаги.

Операция использует short-lived GitHub OIDC и private migration runner. Она не
создаёт облачные ресурсы, не запускает DB migration и не требует Dashboard SQL.
Для полного rollback сначала выключите frontend sticky routing новым Yandex frontend
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

### Персональные ссылки на функции в Assistant

Детерминированные ссылки включаются только при `enabled=true` у привязанной
строки `app_private.assistant_feature_links_pilot_allowlist`. Frontend требует
серверный experiment `assistantFeatureLinks=true`; browser allowlist нет.
Таблица содержит один разрешённый SHA-256 native Yandex login; email и UUID не
публикуются. Привязку выполняет
`app_private.bind_assistant_feature_links_for_yandex_login` после проверенного
Yandex OAuth callback. Для сессии, открытой до выпуска, используйте
`/auth/yandex/refresh-assistant`: пользователь подтверждает текущий Yandex ID
без предварительного выхода и возвращается в Assistant. Callback отклоняет
другой FIT-профиль, а backend не привязывает login вне allowlist.

Rollback: owner-транзакцией установить `enabled=false` у единственной строки и
прочитать значение обратно. Повторный OAuth callback не возвращает выключенную
строку в `true`. Удалять историю сообщений при откате не требуется: frontend
рендерит только reviewed internal routes, а новых markers API не создаёт.

## Google OAuth

Создайте отдельный Google Web OAuth client для V2 и добавьте redirect URI:

```text
https://xwfuzfkuhblswpdludbc.supabase.co/auth/v1/callback
http://127.0.0.1:54321/auth/v1/callback
```

В Supabase Auth включите Google provider и сохраните Client ID/Secret там. Secret не передаётся frontend. Для локального Supabase используйте переменные `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` и `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, затем включите provider в локальном `config.toml` только в личной конфигурации.

Frontend redirect для разработки: `http://localhost:5173/auth/callback`. Production frontend URL добавляется в allow-list Supabase после выбора hosting.

## Release gates

### Временный Fit Lime PR scope (12–25 октября 2026)

По подтверждённому решению владельца только PR с явно известными узкими
feature-файлами используют `@lime-critical` + tags каждого затронутого раздела
в обоих прежних браузерах. Неизвестные/shared/CSS/auth/navigation и смешанные
frontend/API изменения требуют full. Точный allowlist и expiry находятся в
`scripts/fit-lime-ci-scope.mjs`; с 26.10.2026 00:00 МСК — автоматически full.
Неверный clock, изменившийся SHA256 обоих spec/общей fixture или неполный inventory
также возвращают full либо останавливают job, а не пропускают проверку.

На main и ручном CI выполняется полный Fit Lime набор, когда browser gate
требует E2E; инфраструктурные/не-browser diffs сохраняют штатный safe skip.
Production frontend по-прежнему принимает только успешный CI текущего main,
не сокращённый PR CI. Другие quality/browser/API/DB gates не сокращены.
Ручной полный прогон: CI → Run workflow, нужная ветка; локально — прежняя
Playwright команда или `FIT_SCHEDULE_V2_VISUAL=1 node scripts/run-fit-lime-ci.mjs <project> full`
с подготовленными прежними fixture-env/fonts. Disabled acceptance останавливает
runner, а не превращает skipped cases в зелёный job.
Не передавайте пустой grep и не обновляйте digest без повторного аудита tags.
План/приёмка: `docs/design/TEMPORARY_FIT_LIME_CI_SCOPE_20261012.md`.

### Разделённая Fit Lime acceptance (обновлено 15 октября 2026)

`e2e/fit-lime.behavior.spec.ts` содержит 98 поведенческих случаев без screenshot,
CSS/font/geometry assertions. `e2e/trainer-schedule-v2.visual.spec.ts` содержит
526 визуальных и смешанных interaction/state случаев. Общие page-scoped моки
находятся в `e2e/fit-lime-fixtures.ts`; это browser UI acceptance, не проверка
реальной облачной БД. Сохранены уникальные проверки исходного набора616;
после выделения4 behavior cases оплат/шаблонов и включения4 новых случаев
client empty-entry изPR1631 полный набор624 в обоих engine.
Их25 visual-конфигураций сохраняют geometry/keyboard/focus/save/copy/overflow,
но не повторяют полные edit/delete/payment и preflight/reload/replay цепочки.
Mapping и локальный замер: `docs/design/FINANCE_TEMPLATE_TEST_DEDUPLICATION_20261015.md`.

Full CI запускает behavior 1/1 и visual 1/4…4/4 независимо в Chromium и WebKit.
Scoped feature-PR использует behavior 1/1 + visual 1/1 (4 jobs вместо 10),
сохраняя union выбранных tags без дробления маленького набора.
Required `e2e` требует успеха всей matrix; main/manual покрывают полный union.
Локальная команда выше по-прежнему запускает оба spec; точный запуск части:
`FIT_SCHEDULE_V2_VISUAL=1 node scripts/run-fit-lime-ci.mjs <project> full '' visual 1/4`
или `... <project> full '' behavior 1/1`. Нужны прежние fixture-env/fonts.
Временный feature scope выбирается до разбиения; expiry и allowlist прежние.
После явного аудита переноса digest защищает оба spec и fixture.

Каждый job сохраняет `fit-lime-timings-<engine>-<lane>-<job-index>` на 7 дней,
включая успешный прогон. JSON содержит source location/case hash, duration,
retry/status без названий, payload, ошибок и attachments; top-10 выводится в
лог. Failure diagnostics имеют отдельное уникальное имя на каждую часть.
Ускорение требует больше параллельных runners; очередь GitHub и setup могут
ограничить выигрыш. План: `docs/design/FIT_LIME_ACCEPTANCE_SPLIT_20261014.md`.

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
- `VITE_ASSISTANT_PROGRAM_ENABLED=true` enables existing chat controls for both
  signed-in product roles. Trainers can select only connected clients; a client
  is bound to their own active card. The server checks authentication,
  conversation ownership, role and target ownership. Set in the build step of
  both `.github/workflows/deploy-yandex-frontend.yml` (production,
  `fit-training.ru`) and `.github/workflows/prepare-yandex-frontend.yml`
  (offline rehearsal/candidate artifact, not a PR Preview site) -
  `vercel.json`'s copy only affects the legacy `fit-drab.vercel.app` project,
  which is redirect-only and no longer serves production traffic. A
  variable missing from either Yandex workflow silently disables the flow for
  everyone on that channel with no error - `import.meta.env` reads it as
  `undefined`, not `false` (real incident: 2026-09-29, the flag was never
  carried over when frontend hosting moved off Vercel).
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

## Client Lime single-account pilot

`VITE_CLIENT_LIME_ENABLED=true` is the default-off Yandex frontend switch.
The client role also requires `profile.experiments.clientLime === true` from
Yandex API. Migration 121 creates an independent one-login allowlist and protected
binding/read functions; the hash is the normalized native login `budoha1`, not
an email or a client card ID. The existing verified OAuth exchange binds the
linked client profile. Existing sessions need a new Yandex sign-in once after
release. Trainer Lime and Schedule V2 assignments are untouched.

The old `VITE_CLIENT_LIME_PILOT_USER_IDS` variable is no longer consumed and cannot
grant access. Missing server decisions fail closed. The database rejects extra
login rows, reassignment to another profile, and non-client roles. Login does
not undo a disabled assignment. Data ownership and RLS remain unchanged.

Stages 1–4 remain off. Stage 5 deploys the API/migration first, verifies its
release, then enables the frontend switch and redeploys the green main.
Rollback: `VITE_CLIENT_LIME_ENABLED=false` plus a new frontend deployment.

## Independent nutrition diary pilot — prepared, not activated

YAFIT-608 is a separate default-off feature, unrelated to the Lime rollout.
Its schema lives only in numbered Yandex migrations142–144. The API uses native
app-session/actor transactions and RLS. The public food adapter reads only
search/details facts; no shopping OAuth, orders, prices or store URLs enter UI.
Do not import the whole catalog. The owner confirmed on-demand use of the open
official MCP on 11 October; the company's published example explicitly saves
responses in a filesystem (https://habr.com/ru/companies/vkusvill/articles/981866/).
Only selected food facts are snapshotted in the diary. No bulk database license
or undocumented anonymous quota is claimed; retain bounded requests/timeouts.

The owner confirmed that the original five addresses identify CURRENT Yandex logins,
not the legacy email registry. Do not retry the old registry inspection or
derive native UUIDs from names, prefixes or another experiment's assignments.
The exact approved `FIT_NUTRITION_ACCOUNT_COHORT` private secret is already
authorized and stored. Trusted main's `prepare-nutrition-native-cohort.mjs`
checks a fixed approved fingerprint and derives exactly3 or4 client/2 trainer
login hashes. Yandex.ru accounts use native login equivalence (case, dot/hyphen);
external email logins retain their entire address/domain. No new OAuth scopes.
For the current Cloud.ru release use the scoped workflow below, not historical
Yandex Terraform/apply. The server independently
validates the complete distinct3/2 or4/2 shape. Never use stale legacy UUID variables
for this release, never print contacts/hashes or export this input to frontend.

After the user's NORMAL provider-verified OAuth login, the independent feature
binder matches the exact approved hash to the EXISTING Yandex subject/profile.
It requires the specified current role, domain root and active read-write
rollout. Unique immutable subject/login/profile bindings and database4/2 caps
reject alias collisions, role mismatch or profile reassignment. The binder
never creates an account, changes identity/role/other pilots, or grants consent.
The fourth client was explicitly approved on12 October. On15 October the owner
explicitly authorized rollout to the selected six accounts, superseding the
earlier no-rollout restriction. Update only the existing private GitHub cohort
secret to the reviewed exact-six input; never add contacts to git. The original
approved-five server configuration remains compatible;
the extra database admission slot alone cannot grant access to another login.
Migration144 preserves existing bindings/grants and raises only client
admission3→4. Its Down restores3 without deleting bindings.
Every diary API call rechecks the current protected binding against the private
configured cohort. Disabled/revoked identities and changed roles fail closed.

Deploy exact green current-main API/migrations through
`release-cloudru-api-stage.yml`, including migration144 with the existing backup
and owner/runtime separation. Run `configure-cloudru-nutrition.yml`, mode=enable,
with that successful current-main CI run ID. It requires the already running
same SHA, existing runner/host and valid Cloud.ru runtime. It privately validates
the fixed approved six-account fingerprint, changes only `NUTRITION_ENABLED`
and `NUTRITION_LOGIN_COHORT`, verifies four/two configuration plus migrated
function capability as runtime role, then probes candidate/API health and auth.
Atomic configuration replacement has a private previous-env backup and rollback.
Temporary private input is removed; no cohort or credentials are logged.
No IAM, infrastructure, AI, CORS, identities, roles, connections or consents change.
Readiness failures expose only fixed reason codes for target/cohort, service
execution privilege, catalog introspection privilege and admission capability.
No driver message, SQL, credentials or cohort values are logged. A pre-switch
failure leaves the previous runtime intact; classify the cause before changing
anything, never bypass the gate or grant broad database privileges speculatively.
Then set only `VITE_NUTRITION_ENABLED=true` and
`VITE_NUTRITION_NATIVE_COHORT=true`, and release the exact same green main through
`prepare-cloudru-frontend.yml`; native builds use the same two independent flags.
The UI requires its independent enabled flag AND an explicit server nutrition
decision in the native session profile. No decision never means all users;
native mode never inherits a legacy UUID cohort. No other cohort/Lime/AI flags
change. Already signed-in users need one normal Yandex sign-in to establish
their verified feature-only binding; session recovery reads its current state.
Do not impersonate users or claim that pending bindings are completed logins.
Verify the published bundle and fresh native main build before closing the task.

Client routes: `/me/nutrition?date=YYYY-MM-DD`; trainer route:
`/clients/:clientId/nutrition?date=YYYY-MM-DD`. Consent defaults closed and belongs
to the exact current client/trainer connection timestamp. Enablement never gives
consent, creates a connection, sends messages or changes other features.
Rollback: `configure-cloudru-nutrition.yml`, mode=disable, plus both frontend
nutrition variables false and a fresh verified Cloud.ru frontend/native release.
The workflow preserves all unrelated runtime values and removes only its cohort.
Redeploy API/frontend
and verify fail-closed behavior. Preserve diary data; do not roll back migration
142 on production with existing records. Enabling again does not reset consent.

## Independent Lime rollout controls (prepared, activation requires owner approval)

The Yandex-only `app_private.lime_rollout_controls` singleton starts at
`client_mode=pilot`, `trainer_mode=pilot`, `schedule_mode=pilot`, revision 0.
Installing or redeploying it preserves the reviewed cohorts. Never change this
seed to `all`; never reset controls in login binders. The client frontend build
switch `VITE_CLIENT_LIME_ENABLED=true` remains an additional prerequisite.

The existing IAM-protected migration owner container exposes
`POST /stage/experiments/lime-rollout` only when private rollout management is
configured. The public runtime has neither direct table access nor permission
to execute the setter. Inspect: `{target:"client",mode:"inspect"}`. Mutations
require target (`client`, `trainer`, `trainer-schedule`), mode (`pilot`, `all`,
`off`), the inspected `expectedRevision`, and the exact confirmation
`SET_<TARGET>_LIME_<MODE>` (upper case, hyphen replaced with underscore).
Use the prepared main-only manual workflows, never production Dashboard SQL.

Trainer `all` atomically sets schedule `all`, preserving its existing shell
requirement. Disabling trainer presentation does not reset the calendar:
rollback schedule separately after leaving trainer `all`. Existing title/date
gates now apply to trainers admitted by `all`, using their unchanged algorithms.
No product records are rewritten by activation. Client changes never change
trainer/schedule modes. Revision conflict is HTTP409: inspect and obtain a fresh
explicit decision; never retry a stale mutation. If a request times out, inspect
before retrying: an unknown outcome is not evidence of failure.

Settings survive logins and deployments. An open client picks up flags on
existing actor refresh, page reload or a new login; this mechanism does not
promise a live broadcast. Read back the expected modes/revision after every
operation. Test public `/profile` role-specific experiments separately; private
configuration readback alone does not prove real OAuth/device acceptance.

Owner instruction 2026-10-07: no activation or cohort expansion without a new
explicit OK. Production remains in the existing pilot until then.

Client operation: Actions → Manage client Lime rollout. First run `inspect`
with empty confirmation/revision. After an explicit new human OK only, run
`all` with the reported revision and `SET_CLIENT_LIME_ALL`. Rollback uses `off`
(`SET_CLIENT_LIME_OFF`) or `pilot` (`SET_CLIENT_LIME_PILOT`) and a freshly
inspected revision. Never automatically replay a failed/unknown operation.
Merge or frontend deployment alone does not dispatch this workflow.

Trainer operation: Actions → Manage trainer Lime rollout, target=trainer.
Use inspect first. Only after a new human OK, `all` with the inspected revision
and `SET_TRAINER_LIME_ALL` atomically enables trainer presentation + Schedule V2.
`SET_TRAINER_LIME_OFF`/`SET_TRAINER_LIME_PILOT` restores presentation separately.
If calendar rollback is also requested, leave trainer all first, then inspect
and choose target=trainer-schedule with mode=pilot and
`SET_TRAINER_SCHEDULE_LIME_PILOT` (or separately confirmed off).
The trainer workflow rejects client targets. No operation has been dispatched.

## Legacy database/parser deployments — manual-only, 16.10.2026

`.github/workflows/deploy-database.yml` and
`.github/workflows/deploy-yandex-workout-parser.yml` have only
`workflow_dispatch`: merging changes to migrations, parser sources or API
package files no longer deploys these legacy targets. A manual run still
executes the existing deployment and requires a separate rollback decision.
Supabase credentials, SQL history and remote resources remain available;
Cloud.ru API/frontend release workflows are unchanged.

## Удаление legacy password recovery — 14.10.2026

`POST /v1/auth/yandex/recover` удалён из API и возвращает 404, включая запросы
от старых web/native bundles. Они должны обновиться; новая версия сразу
показывает регистрацию неизвестному Yandex ID. Уже связанные профили входят
обычным способом. Старые email/пароль больше не проверяются в этом сценарии,
непривязанная история не присоединяется к новому аккаунту автоматически.
SQL migration history, профили и identity не удаляются. Supabase configuration
пока нужна startup и legacy media; удаление recovery ещё не разрешает
удалить все Supabase secrets или проект. Проверка целевого production-поведения
требует выпуска API и frontend/native вместе; один frontend deployment не
доказывает удаление серверного endpoint.

Cloud.ru API image copies PostgreSQL17 backup tools from the pinned Bookworm
variant, matching node24-bookworm. The image build executes both pg_dump and
pg_restore --version: incompatible binaries must fail the build before release.

Cloud.ru offsite backup uses dedicated GitHub secrets `CLOUDRU_BACKUP_KEY_ID`
and `CLOUDRU_BACKUP_KEY_SECRET`. Give their service account access only to the
private backup bucket. Do not grant the API runtime key access to backup objects.
The backup container receives only the dedicated pair and DB/encryption inputs;
media verification receives a separate root0600 env containing the existing media
pair. Neither pair is borrowed when the other is missing. API startup/release
workflows never install the dedicated backup pair into the API environment.
Restore readiness uses loopback TCP to avoid PostgreSQL initdb's temporary Unix
socket; the restore container still has no network or published ports.

`CLOUDRU_BACKUP_ACCOUNT_ID` is the approved backup service account's canonical
S3 principal ID (GitHub repository variable), not an inferred runtime account.
The account uses only bucket-scoped s3e.viewer/s3e.editor/s3e.viewer-acl. Actual
upload/readback succeeded with those roles and the bucket's existing private ACL;
additional ACL delegation was unnecessary and its attempted write returned400.
Bootstrap verifies default privacy without editing ACLs or bucket policies.
Public groups, unknown accounts and bucket-policy presence still fail closed.
No administrative role is required for an existing bucket. The workflow creates
no service account, access key or role grant.

The downloaded database archive is restored and its RLS/grants checked before
media verification. Media failure still fails the overall job, but cannot skip
an otherwise valid database restore drill. BACKUP_VERIFIED_AT records only a
successful database restore, not media acceptance. Separate credential files
remain root0600 and are removed on success or failure. Constant media operation
stages identify ACL/policy/versioning/read failures without paths or SDK payloads.


Cloud.ru SpeechKit relay uses its own `CLOUDRU_SPEECHKIT_API_KEY` GitHub secret and
`CLOUDRU_SPEECHKIT_FOLDER_ID` repository variable. It never borrows YandexGPT's
key/folder from api.env. The root0600 relay file contains only the SpeechKit key
and folder; no model, database or backup credentials. Missing/invalid configuration
fails before any staging file or container. Upstream recognition and unauthenticated
WebSocket rejection must pass before relay/ingress promotion. Provisioning an
external Yandex IAM account, STT-only role and scoped key requires explicit owner
approval; this workflow creates no IAM resources. Keep frontend WSS default-off
until the relay passes its real upstream and guard checks.

The isolated backup restore cluster creates fit_api and optional analytics grantee
fit_datalens as NOLOGIN roles before restoring ACLs. These placeholders never
change production roles or permit connections. Conditional analytics migrations
can include fit_datalens grants in an archive even when a clean local schema
without that role does not. Restore progress emits fixed stages; failures expose
only missing_role, permission_denied, missing_extension or unclassified. Raw
pg_restore stderr stays in the disposable container and is deleted with it,
because COPY failures can contain private row values.

Media ACL repair is a separate manual workflow, repair-cloudru-media-acl.yml,
with GRANT_APP_MEDIA_ACL_READ_ONLY. It uses only the existing media key pair and
the fixed media bucket. It reads the existing ACL, rejects groups/unknown
principals or a bucket policy, preserves owner/app grants, adds only app
READ_ACP if needed, then verifies the complete readback. It does not change IAM,
ownership, policy, object data or credentials. Any temporary bucket-only admin
role must be separately approved by the owner and removed after the operation;
repeat media verification with final restricted roles. Restore TOC diagnostics
print only allowlisted system-extension names and redact unknown names.

Owner decision15.10: keep media ACL/IAM/versioning unchanged for now; the manual
repair is not authorized to run. ACL-read403 remains an open metadata check.
Voice is also intentionally OFF; operations inspection expects its service and
health only when CLOUDRU_SPEECHKIT_RELAY_URL is configured to the canonical URL.

The disposable restore image extends the pinned PostgreSQL17 base with pinned
PGDG postgresql-17-pgaudit17.1-2.pgdg13+1 and preloads pg_stat_statements/pgaudit.
Both extensions occur in the real archive; they are restored, not excluded.
SQL/audit/error-statement logging is disabled only in this isolated environment.
Its build context is public infra/cloudru source, never the backup directory.
Retention preserves an API image if Podman reports it is still used by a
container and continues other bounded cleanup; any other removal error fails.
It never force-removes that container or performs system/volume pruning.

## Android OTA — подготовка, без production-публикации

План: `docs/design/ANDROID_OTA_20261019.md`, протокол публикации/отката и Nginx:
`infra/cloudru/mobile-updates/README.md`. `FIT_ANDROID_OTA_ENABLED` имеет default-off
семантику (включено только при точном `true`); штатная web-сборка OTA не проверяет.
Тестовый Android APK1.1.0/code4 должен собираться с этим флагом, `FIT_SOURCE_COMMIT`
и canonical API origin `https://api.fit-training.ru`; production env-файлы локально
не создаются. Native-состав и **все lock-зависимости** входят в консервативный ABI:
их изменение требует нового APK. Публичный OTA RSA-ключ закреплён в
`config/android-ota-public-key.pem`, private key хранится отдельно/ignored,
mode0600, не входит в APK/артефакты/Git/URL/логи; резервная копия обязательна.
Не путать с APK signing keystore. Native ZIP-клиент SDK получает одну общую
константу `fit-self-hosted` вместо уникального device ID; Capawesome Cloud,
регистрация устройств и sync/stats не используются.

`npm run android:ota:package -- DIST NEW_OUTPUT SHA` создаёт только offline
content-addressed ZIP, signed manifest и provenance; key задаётся через
`FIT_ANDROID_OTA_PRIVATE_KEY_PATH`. Повтор команды с `--reset` и новым sequence
готовит возврат к builtin при следующем старте; старый manifest не копируется
из-за replay-защиты. Native `readyTimeout=20000`, `autoBlockRolledBackBundles=true`,
`autoUpdateStrategy=none`; JS никогда не вызывает `reload()`. Ошибка проверки
выдаёт только стабильный код `FIT_ANDROID_OTA_CHECK_FAILED`, без error payload/PII.

Новый feed хранится независимо от frontend/API retention. Публикация feed,
добавление Nginx location и отправка нового APK в RuStore не выполнены. До них
нужны полный native/CI/device цикл и подтверждение правил RuStore. Согласие на
обычную web-выкладку само по себе не включает OTA. Никакие production build flags,
allowlists, CORS/API/БД/старый Yandex-контур из этой подготовки не меняются.
