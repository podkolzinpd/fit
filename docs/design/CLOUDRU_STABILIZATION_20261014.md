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
| 1 | Canonical web/Android/iOS build guard и тесты; credential-free proxy для старого API подготовлен | В работе |
| 2 | Публичная делегация исправна; stale resolver воспроизведён | В работе |
| 3 | API/frontend d10c2d12 выпущены38633109023/38633113898; runtime readback200; autodeploy включён | Выполнен для исходного main; новый выпуск после CI |
| 4 | Недостающие credentials/dispatch/relay проверяются | Не завершён |
| 5 | Пока только unauthenticated hosting/API guards | Не завершён |
| 6 | Disk retention работает; backup/restore/monitoring впереди | Не завершён |

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
