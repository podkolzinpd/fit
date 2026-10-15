# Стабилизация Cloud.ru — 14 октября 2026

Владелец подтвердил этап «Стабилизировать Cloud.ru сейчас» в чате.
База: main `d10c2d123a2b0e198c2095fae97160a79c36a0a2`.
GitHub issue: https://github.com/podkolzinpd/fit/issues/1633.

Возврат в Yandex и удаление старых ресурсов в задачу не входят.

## Утверждённый acceptance-чеклист

1. **Свести всех клиентов к одному API:** web, iOS и Android должны использовать `api.fit-training.ru`. Убрать старый технический Yandex endpoint из актуальных production-сборок. Проверить, какие установленные версии ещё могут писать в старую БД.
2. **Разобрать DNS-расхождение:** публичная делегация правильная, но резолвер текущей среды получает старую Yandex-зону. Нужно обеспечить предсказуемый доступ к сайту и API из таких сетей.
3. **Выпустить актуальный согласованный frontend/API.** Сейчас работающие версии отстают от main. Сначала проверить совместимость и pending migrations, выполнить контролируемый выпуск, затем включить штатное обновление после зелёного CI.
4. **Довести недостающие сервисы:** SpeechKit, разбор тренировок, Assistant, ИИ-анализ, обычные push и фоновые задачи. Для каждого определить рабочее размещение и зависимости. Перенос API сам по себе эти сценарии не восстановил.
5. **Проверить реальные пользовательские пути:** вход и регистрация, обе роли, тренировки и Live, сохранение и повтор после ошибки, media upload/read, голос, AI и push. Проверять через Cloud.ru API/PostgreSQL, включая мобильные приложения.
6. **Закрыть эксплуатацию:** автоматические backups БД вне VM, восстановление из backup, защита и проверка media, мониторинг ошибок/диска/сертификатов/очередей. Очистка runner уже работает, но не заменяет backup и мониторинг.

Критерий завершения: все поддерживаемые клиенты работают с Cloud.ru, основные сценарии проверены, восстановление данных испытано, фоновые задачи исполняются в одном определённом контуре.

## Исходная проверенная точка

- Публичная делегация .ru и DNS 1.1.1.1/8.8.8.8/77.88.8.8:
  Cloud.ru NS, root/www/api `87.242.117.210`.
- Резолвер среды аудита `84.252.160.1` и старые Yandex NS:
  root `158.160.171.31`, www `158.160.184.183`, api NXDOMAIN.
- Cloud.ru HTTPS с правильным SNI: web200, readiness200, clients без сессии401.
  API release447c283e; frontend candidate3f5bf3d8.
- Cloud.ru runtime использует PostgreSQL10.70.10.67/fit, S3cloud.ru;
  AI выключен, API/frontend autodeploy выключены, подготовка API включена.
- Android auth-smoke ссылается на старый Yandex API; deployed web на новый.
- SpeechKit frontend89.169.132.80 и recovery workflow84.201.157.124:
  разные адреса, оба HTTPS timeout из сети аудита.
- Runner retention38630038416 success: свободно10831MiB; runner online.
- Более ранние активные PR1630 (Supabase startup) и1631 (workouts UI)
  должны пройти штатную очередь перед merge этой задачи.

## Границы безопасности и проверки

Существующие данные, UUID, роли, media и VAPID identity сохраняются.
Не выполняются reset/reimport на непустую БД, dual-write или автоматический
fallback. Local tests работают только с Podman PostgreSQL/legacy Supabase.
Production secrets не копируются локально и не печатаются. Проверки runtime
выводят только версии, разрешённые параметры и агрегаты без PII.
Новые ресурсы в Yandex и возврат routing туда запрещены.
Для внешних AI-провайдеров сохраняются текущие prompt/matching/contracts;
credential и доступность требуют отдельного фактического readback.

## Матрица выполнения

| Пункт | Результат и проверка | Статус |
| --- | --- | --- |
| 1 | Native canonical API, web same-origin, guards passed; old proxy deployed, forwarding503 | В работе |
| 2 | Public DNS/TLS8/8; old api87, root/www old IP; DNS operator403 | В работе |
| 3 | Main619892be CI green, API/frontend released; backup/pending migrations passed | Выполнен для619892be |
| 4 | External GPT smoke passed/frontend AI on; SpeechKit gRPC7; old timer PAUSED, fresh push OFF | Не завершён |
| 5 | Пока только unauthenticated hosting/API guards | Не завершён |
| 6 | Disk/TLS/API/hosting passed; offsite S3 AccessDenied403, restore pending | Не завершён |

## Дополнительные решения и фактура

- Владелец подтвердил сохранение SpeechKit/YandexGPT как внешних API.
- Владелец подтвердил только новые push; old/uncertain recovery остаются в
  истории без повторной отправки. Существующая VAPID identity сохраняется.
- Владелец готов войти в отдельные тестовые аккаунты клиента/тренера после
  готовности сервисов; пароли/коды не запрашиваются и не сохраняются.
- API/frontend d10c2d12 выпущены штатно38633109023/38633113898, runtime release
  и public readiness проверены; оба Cloud.ru autodeploy включены с readback.
- Более ранний PR1630 включён4fcbfe67 без потери canonical routing изменений.
- Read-only audit38638075365/exit2 выявил source51472/target51603 против
  baseline51443/51438. Assistant messages3121/3027 и generations36/34,
  workouts1853/1859. Данные меняются независимо в двух контурах; конкретный
  клиент/writer не атрибутирован. Данных не перезаписывали и не объединяли.
  Владелец затем явно разрешил направить старые DNS/API в Cloud.ru с сохранением
  Yandex-БД и ресурсов. Подготовлены manual exact-main workflow и credential-free
  API proxy с CORS/preflight и сохранением метода/тела/Origin; apply ещё не выполнен.
- Создан отдельный CLOUDRU_BACKUP_ENCRYPTION_KEY без вывода/локального файла;
  backup bucket/проверка восстановления ещё не выполнены.

## Локальная проверка перед PR

- Полный npm run check: frontend2668/2668, API1397 passed/157 standard DB skips,
  infra294/294, hosting167/167, build прошёл. После проверки браузером заменён
  междоменный307 на proxy: исходный Origin/session сохраняются; полный финальный
  набор стадий check этого варианта выполнен в изолированной рабочей копии.
- Изолированный реальный Podman PostgreSQL17: cutover history3/3; отдельный
  pg_dump/restore fixture без сети/портов сохранил две таблицы, строки, policy и
  migration history. Общие локальные базы не сбрасывались; production не источник.
- Chromium и WebKit: реальный cross-origin POST через локальный proxy сохранил
  body/session/Origin. Старый307 воспроизвёл CORS отказ с Origin:null и не включался.
- Подготовленный proxy → настоящий Cloud.ru TLS/SNI: health200/release22e08f4e,
  unauthenticated clients401, CORS capacitor://localhost. Никаких сессий/PII.
- Relay:5 реальных WS тестов; npm audit relay0 vulnerabilities после grpc-js fix.
- Новое покрытие ловит разные риски: crypto tamper, private bucket policy,
  least-privilege env, WS auth-before-billing, HTTP framing/CORS, idempotent
  cutover. Тяжёлые продуктовые E2E/visual матрицы не расширялись.
- Automatic API/frontend release main22e08f4e38639750368/38639750407 success;
  public health подтвердил22e08f4e. Старый Terraform autodeploy явно false/readback.
- Authenticated test roles, реальные media/voice/AI/push и свежие native bundles
  всё ещё не проверены. Новые configure/backup/DNS/API workflows не запускались.

- В изолированной worktree frontend2668/coverage/lint/typecheck, infra294,
  hosting167 passed с VITEST_MAX_WORKERS=1. Первый default-parallel прогон
  упёрся в resource timeouts неизменённых UI tests при совместной локальной
  нагрузке; assertions/timeouts/coverage не менялись. API check1399 passed,
  158 standard DB skips; schema migrations не добавлены. Production build passed.
- Проверка ACL обнаружила недостаток старого pg_dump --no-acl: теперь grants
  сохраняются, synthetic PostgreSQL17 restore подтвердил fit_api SELECT/RLS и
  чтение fixture. Production restore workflow требует также owner/RLS трёх таблиц.
- Реальный operations PostgreSQL17 cutover+queue monitor6/6: preserved historical
  receipts, fresh events, retries, overdue/stale leases и terminal counts.
- Legacy compatibility включает обратимый pause только старого dispatcher timer
  с проверкой target/path/PAUSED до запуска Cloud.ru worker. Два timer одновременно
  не включаются. Владелец15.10 явно оставил Telegram/Tracker delivery выключенной;
  новые сервисы и legacy DNS/API/timer пока не активированы.
- PR https://github.com/podkolzinpd/fit/pull/1637 ready for review, обязательная очередь.
  Рабочая копия /private/tmp/fit-cloudru-stabilization создана после переключения
  общей папки другим чатом; исходные два пользовательских файла не изменялись.

- Www/native CORS можно исправить отдельным mode cors-only без вызова модели
  и без включения AI; это исключает зависимость доступности www от YandexGPT.

- Cloud.ru S3 API сверён с текущей документацией: versioning и bucket policy
  поддержаны; backup не посылает ACL header, совместим с BucketOwnerEnforced,
  bucket ACL/policy проверяются до upload. Synthetic crypto и API auth5/5,
  API lint/typecheck и speech smoke syntax passed после правки.
- Локально установлен только Command Line Tools: Xcode.app/Simulator отсутствуют
  (xcode-select и точный bundle-id lookup). iOS build/install/launch пока не
  выполнены; Android main auth-smoke build и роль/native-проверка после activation.

- 15.10 maincb9799e8 интегрируется в PR1637: новый web same-origin
  `https://fit-training.ru/api` — уточнение транспортного пути по прямой команде
  владельца после проверки main; native сохраняет `https://api.fit-training.ru`.
  Исходный acceptance выше сохранён дословно; оба маршрута ведут в один backend.
  Старые и новые authoritative NS уже возвращают API87.242.117.210; API-запись
  повторно менять не нужно. Но old ns1/ns2 root/www всё ещё158.160.171.31/
  158.160.184.183, old technical API health release42c7f73d: эти writers пока
  не закрыты. Подготовленный DNS mode должен перенести оставшиеся root/www. Ingress38706865195 success, фактические web health JSON200
  и clients401, release совпадает с direct APIcb9799e8. Promotion guard и monitor
  теперь обнаруживают SPA HTML200 вместо web API. CI нового merge ещё гейт.

- Production public monitor после ingress: DNS3/3 и HTTP/TLS8/8 passed,
  certificates89days; targeted merge routing61/61 и native/ops29/29 passed.

- Post-merge15.10: PR1637 merged0d42d3a7 после CI38709299161 success;
  main CI38711706924 success, API38713138618/frontend38713138583 success.
  Следующий55c8ea52 — nutrition pilot отдельной задачи; его cohort не меняется.
- Legacy auto deployments orchestrator38711706852/push38711706843 остановлены
  на build до OIDC/IAM/publish; оба и summary disabled_manually/readback.
  Yandex stage38711706949: validation success, plan/migrate/deploy skipped.
- CORS38715240066 failed до изменения API: gh отсутствует в self-hosted.
  Legacy inspect38715274517 остановлен exact-main guard после обновления main.
  Backup bootstrap38715637999 generic failure; private bucket/restore не доказаны.
- Follow-up codex/cloudru-operations-fix: только curl вместо gh в четырёх self-hosted
  configurations и безопасные allowlisted S3 diagnostics (не message/resource).
  Source guards, private ACL/policy checks, DB targets и rollback прежние.
  Targeted workflow8/8 и crypto/privacy/error redaction6/6 passed; полный check
  выполняется. Сценарии пользователя/SQL/PII/cohort не меняются.

- Follow-up final local check exit0: frontend2676/API1404+159 standard DBskip,
  infra301/hosting169/lint/types/coverage/build passed. После выявления такого же
  gh call в nutrition configuration он заменён тем же curl без изменения cohort;
  final workflow9/9 passed. Local DB migration chain не менялась этим fix.
- Main55 CI38715304043 встретил pre-existing visual assertion Progress: высота
  toggle0 вместо>=44 в progress-results-fixture.ts:101, три попытки. UI-код
  не меняется; причина и readiness fix ниже, current-main rollout ждёт green.

- CI trace job116356537290 доказал race: before@call@92 у PRO hidden, после
  evalOnSelectorAll уже hidden у overview; measurement вернул[0]. Count1 видел
  всегда mounted DOM и не ждал React commit. В existing verifyResultsSources
  добавлено ожидание видимого tabpanel ПРО до сбора controls. Все assertions,
  minimum44, retries/timeouts и browser matrix прежние; новых случаев нет.
- Local ESLint и Playwright list existing2 cases passed. Replay actual CI DOM/CSS
  с delayed panel commit: WebKit390/Chromium430,7 controls/min63.6875 each passed,
  network blocked. Это проверка race mechanism, не полный app E2E: локальный
  Supabase auth54321 недоступен, общие базы не запускались/не сбрасывались.
  Полный existing browser scenario остаётся обязательным final CI.

- Mainfc7b31d6 (#1644) merged без конфликтов: scoped nutrition CORS и geometry
  expect.poll сохранены. Наш panel-visible wait остаётся отдельным readiness
  контрактом: иначе poll мог бы измерить controls прежнего overview. Повторный
  nutrition shell parse после union устранён (один workflow — один parse).
  Combined workflow/nutrition12/12 и targeted ESLint passed. Final CI после push.

- Дополнительный доказанный routing blocker: configuredUrl||DEFAULT_RELAY_URL
  выбирал старый89-169-132-80 relay при пустой production env. Production streaming
  теперь требует явный canonical WSS до microphone/network; development legacy
  default и existing recorder fallback/VoiceInputButton phases/texts сохранены.
  Primary VoiceInputButton и Fit tokens/icons/markup прежние, transport-only scope.
  Три новых runtime cases (missing/empty/explicit old URL) проверяют отсутствие
  mic/network; существующий final-flush case теперь использует canonical production
  relay. VoiceInputButton+streaming20/20 и typecheck passed; полный check passed. Rotation сохраняет URL проверенного сокета; production JS не содержит старого relay.
- UI identity/voice-first context прочитан, public auth route открыт во встроенном
  браузере для самостоятельного входа владельца в test client. Authenticated role
  flows ещё не выполнены; credentials/PII не выводятся и не извлекаются.
- CI mainfc7b31d6 attempt1: Chromium environment port54322 busy до tests; attempt2
  уже запущен другим оператором, повтор не дублировался. Guards требуют success.

- Web `/api/` теперь получает тот же лимит50m и read timeout120s, что и прямой
  API. Buffering отключён на обоих API proxy: сохраняется ранее выявленное
  ограничение proxy_temp на VM. Проверяется существующим ingress policy test;
  runtime nginx-t/activation остаётся rollout-гейтом.

- mainfc7 CI38718724986 success; API release38721385510 остановлен до migration
  на backup. Изолированный ABI probe воспроизвёл GLIBC_2.38 not found: donor
  postgres17 был Debian13, runtime node24-bookworm — Debian12. Donor заменён
  на официальный digest-pinned PostgreSQL17-bookworm; build проверяет запуск
  pg_dump и pg_restore, не ослабляя обязательный backup перед migrations.

## Production readback после PR1645, 15.10

- PR CI38723303705 и main CI38725081174 success на619892be; API38726558866
  прошёл реальный backup/pending migrations/candidate/promotion. Frontend
  38726558952 и AI rebuild38728031198 success. Public monitor DNS3/3 и HTTP/TLS8/8,
  обе API health619892be, protected401; сертификаты89days.
- CORS38726722970 success, www OPTIONS204; Nginx web38727056363/API38727148937
  success, лимит50m/read120s/buffering off применены.
- GPT38727264363 external smoke passed и runtime aiEnabled:true; GitHub
  CLOUDRU_AI_ENABLED=true/readback. Это не замена authenticated AI acceptance.
- Speech38727437613: image built/audit0, upstream gRPC7 PERMISSION_DENIED.
  Cloud relay не активирован; прежний IAM-backed Yandex VM не переносится молча.
- Offsite bootstrap38726879615: AccessDenied403, приватность и restore не доказаны.
  Encryption keyv1 сохранён; privacy guards не ослаблялись.
- Legacy inspect38726726653: container/timer доступны, DNS list403. Локальные
  профили содержат ту же identity; старый статический ключ401, не обновлялся.
  DNS root/www на обоих ns1/ns2 пока158.160.171.31/158.160.184.183; API87.
- Old timer38726901087 success/PAUSED. API38727051982 deploy operation completed,
  затем health timeout. New proxy OPTIONS204, GET503≈60s. Точный Node22 image
  локально с реальным Cloud target возвращает200/619892be. Межоблачное соединение
  не принято; прежний DB-код не возвращался, ресурсы/ревизии/обе БД сохранены.
- Ops38727946166: Nginx, certbot.timer, disk>=2GiB, cert>=14days, API/hosting/marker
  passed. Speech/background units/backup freshness не готовы. Queue read-only
  pending22/overdue22/stale leases20/terminal0; доставка/архивация не запускались.
  Certbot staging renewal не выполнен: предыдущие checks остановили workflow.
- Тестовый callback показывает регистрацию, пользовательской формы не отправляли.
  Владелец попросил пояснить запрос: приёмка аккаунта отложена до готовности.
  Android production-routing38728035187 success, artifact fit-android-auth-smoke-apk;
  установка/пользовательские сценарии не проверены. Xcode отсутствует, iOS не собран.

Оставшиеся prerequisites доступа: восстановить разрешённый доступ operator к
существующей legacy DNS-зоне; проверить private backup bucket/access key в Cloud.ru;
для SpeechKit использовать действующий credential с ролью ai.speechkit-stt.user и
scope yc.ai.speechkitStt.execute. Новые Yandex IAM/key resources и расширение прав
не выполнялись. Требуется владелец либо уже разрешённый действующий доступ.

## Owner-console continuation, 15.10

- Current main8393bbe3/runtime8393bbe3, CI38737310804 success; nutrition fixes1646/1647
  preserved by merge without conflicts.
- Owner consoles have active sessions. Legacy zone is dns7eld4ceutkbftord9 in
  b1goqho12tlk9dibc3f3. Root ANAME points to old API Gateway, not a literal A.
  Prepared root ANAME→api.fit-training.ru/TTL60 was NOT saved: automatic approval
  rejected the exact target as insufficiently approved. Exact confirmation was requested; the owner asked to handle technical choices
  autonomously. The blocked DNS write remains unapplied. Host-preserving curl to87 returned frontend200; both old NS api→87.
- Created private backup bucket fit-cloudru-backups-c2ad3760 through owner console.
  Bootstrap38744078639 still fails AccessDenied403. No roles or access keys changed.
- Existing fit-stage-app parameters show global s3e.viewer and media-bucket
  s3e.editor/s3e.editor-acl. The parameter page shows assigned service roles; its
  separate access-rights tab manages access TO the account and is not an inventory
  of its data permissions.
- Existing startup and backup workflows consume the same media secret pair.
  Granting it backup write would also grant the API deletion of encrypted backups.
  Code now requires a dedicated backup pair, with no media fallback; isolated
  media-health env does not contain DB/encryption/dedicated backup credentials.
  No new SA/key/grant yet; owner action-time approval remains required for these.
- Four new credential cases cover dedicated selection with decoy runtime pair,
  no fallback for missing/incomplete pair, wrong tenant and control characters.
  Four ACL cases cover owner/approved-principal access, public and unknown
  principals, and rejection of backup-writer access-policy administration.
  Existing restore policy case additionally guards separate secret wiring and
  no runtime injection; no additional workflow test matrix. API crypto/privacy/
  credential/ACL14/14 and operational workflow9/9 passed. Final local acceptance passed: frontend lint/types2680, API lint/types1418+159 DB skips, infra302, hosting169, calendar12, relay5 and builds. The first check stopped at sandbox loopback EPERM; the remaining stages passed with loopback permission. API lint found a control-regex violation, corrected before API acceptance. CI pending.
- Restore workflow now waits for TCP127.0.0.1, matching the earlier actual local
  fixture failure/recovery: Unix readiness could observe initdb's temporary server.
  No timeout/retry reduction or RLS/public-access/privacy guard weakening.
- Manual bootstrap now explicitly scopes private ACL access to the existing owner
  and approved dedicated backup principal (READ/WRITE/READ_ACP); unknown grants
  fail closed. Normal backup does not write ACLs. This code is not deployed and
  no new principal has been approved or provisioned.


## Explicit owner approval and S3 diagnostic follow-up, 15.10

Owner explicitly approved the root ANAME target/TTL, dedicated backup SA/key with
bucket-only temporary admin followed by restricted roles, and media-only
s3e.viewer-acl. Root ANAME saved; both legacy NS return87.242.117.210 and site auth200.
Legacy www remains an independent old Gateway ANAME; no MX/TXT change.
Created fit-cloudru-backup with project UserServices and temporary admin only on
the backup bucket. Its key pair was transferred through an owner-only FIFO directly
to the two approved GitHub secrets, without a regular secret file or output.
API runtime never receives it. Readback confirms media-only viewer-acl on fit-stage-app.
PR1648 merged1ccf81d1; CI38754619608 and API release38756737947 succeeded, runtime verified.
Bootstrap38756948298 failed HTTP400 with an unknown standard storage code. Backup
acceptance is still blocked. This follow-up adds only constant operation stages
and reviewed S3 bad-request names; messages, identities, paths and SDK metadata
remain excluded. No retry, ACL or public-access guards are relaxed. Temporary admin
must be removed before a pause or accepting backup/restore under restricted roles.
The current Yandex console session cannot access the previous SpeechKit folder.
Fresh push and feedback delivery remain OFF; no production data rewrite occurred.

Temporary backup admin was removed after the failed bootstrap, before waiting
for diagnostic acceptance/CI. Owner-console readback confirms only bucket-scoped
s3e.viewer, s3e.editor and s3e.viewer-acl remain. No public ACL was requested.

Diagnostic follow-up local acceptance: full npm run check passed (frontend2680,
API1418 with159 local DB skips, infra302, hosting169, calendar12, relay5 and both
builds). Existing storage-redaction test now also checks reviewed HTTP400 names;
there is no new browser/test matrix. CI and operational retry remain pending.
