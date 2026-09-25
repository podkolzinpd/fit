# Fit — текущее состояние проекта
> Rolling snapshot для продолжения между сессиями, максимум 120 строк; полная история хранится в Git, PR и Tracker.
Обновлено: 2026-09-25. База изменений: `c41224ab` (#1172). Frontend остаётся на Vercel, а production data plane — принятый Yandex Cloud stage stack.
Yandex ID является единственным production-входом; app-session, main routing и native registration включены глобально.

## Активная цель

Диагностика фонового dispatcher: `Background dispatch failed` теперь различает `push`/`app_feedback`, `prepare`/`finalize`, безопасный код и категорию ошибки, код rollback и release. Payload/SQL/stack не пишутся, повторы не добавлены. Это улучшение наблюдаемости; причина инцидента 24 сентября ещё не подтверждена.

Стабилизировать Yandex-only production после переключения и затем вывести Supabase из эксплуатации. До закрытия rollback-окна сохраняется общий доменный контракт без dual-write; гейты описаны в `docs/YANDEX_CUTOVER_PLAYBOOK.md`.

## Последняя проверенная продуктовая точка

- Assistant доступен обеим ролям; клиент работает только со своей карточкой, программы остаются за общим kill switch.
- Клиентская генерация четырёхнедельной программы работает через выбранный backend. Yandex API читает actor-scoped историю, цель, замеры и будущие занятия из PostgreSQL, использует короткие idempotent generation leases и вызывает тот же валидируемый YandexGPT generator вне DB-транзакции.
- Свои упражнения поддерживают текстовые metadata в обоих backend; изменение private JPEG всё ещё отклоняется, объекты не входят в подтверждённый перенос. Планирование, подробный план, результат и Live используют единые статичные миниатюры упражнений 48×48 с точным первым кадром или нейтральным fallback; крупная анимация остаётся только у текущего упражнения Live и в явном просмотре техники. Для всех 721 системных Vital, Vital Gym Pro и reference-анимаций заранее рассчитан безопасный canvas: 152 постера с однотонными полями продолжают фон карточки без растягивания или изменения масштаба фигуры; тот же контракт работает в миниатюрах и крупной технике.
- Legal acceptance и отменяемые deletion requests работают через выбранный backend с actor-scoped Yandex RLS/RPC и provider-neutral UI.
- Production auth показывает только действие «Продолжить с Yandex ID»; старые email/password/reset routes возвращаются на единый вход. Существующая связь Yandex ID с FIT-профилем при выдаче сессии атомарно создаёт отсутствующий `yandex/read_write` assignment или повышает прежний `yandex/read_only`; явный disabled/non-Yandex assignment остаётся административным запретом. Неизвестный Yandex ID получает recovery/new-account handoff. Recovery профиля одной транзакцией создаёт identity, `yandex/read_write` и первую app-session, а выбор нового аккаунта создаёт новый профиль; при любой ошибке всё откатывается. Callback различает незавершённую подготовку профиля и отключённый сервис сессий, не предлагает недоступный email-вход и показывает безопасную диагностику. Основной UI выбирает Yandex API без request-level fallback, а reload не сбрасывает активные Yandex requests.
- Frontend Yandex API принимает Postgres-native ISO timestamps с numeric offset (`+00:00`); карточка «Последняя тренировка» больше не падает из-за отличия от literal `Z`.
- Startup watchdog запускается в `<head>` до production JS/CSS: зависший или не загрузившийся asset через 12 секунд показывает восстановление вместо белого/чёрного экрана. Таймаут Yandex auth действует до полного получения ответа, а запрет browser storage завершает loading явной восстанавливаемой ошибкой.
- Client Home показывает компактную карту «Нагрузка по телу» за текущий месячный период: выбор зоны выводит только её процент, без рейтинга, количества подходов и списка упражнений. «Открыть в прогрессе» раскрывает карту того же периода сразу в режиме нагрузки; exact-workout срез удалён (YAFIT-538).
- Все запросы основного Yandex API и Yandex ID transport получают безопасный client-generated request ID, который API возвращает в ответе и использует как Fastify `reqId`. Штатные error-state позволяют скопировать этот ID вместе с release/status/operation без token, email, UUID профиля, request body и пользовательского текста.
- Короткие platform-level `502`, при которых Fastify ещё не вернул request ID, восстанавливаются для безопасных `GET`: параллельные чтения ждут один общий `/health` probe и после восстановления повторяются по одному разу. Любая mutation после 45 секунд без подтверждённого ответа API сначала выполняет общий безопасный `/health` preflight и отправляется ровно один раз только после его успеха; сама запись и application-level ошибки автоматически не повторяются. Одноразовые OAuth-коды защищены тем же контрактом.
- Stage API получает side-effect-free `POST /internal/warmup` от отдельного timer service account каждую минуту; endpoint не обращается к БД или внешней сети. Таймер делает до двух повторов с интервалом 10 секунд. Это уменьшает вероятность idle-suspension, не добавляя второй provisioned instance.
- После warmup health soak прошёл 1000/1000 запросов без retry (run `35649184489`), но 22 сентября снова зарегистрированы 502 на том же release `8b548a…` (диагностика `35698393630`). Health без БД не доказывает стабильность PostgreSQL. Системный 502 без прикладной записи теперь даёт `handler=unknown`, а не недоказанное `not_started`.
- `PgDatabasePool` обрабатывает фоновые ошибки idle-соединений: драйвер удаляет повреждённый client, процесс сохраняется, следующий запрос может открыть соединение заново. Событие `database_pool_idle_error` содержит только безопасные категорию и код; автоматического повтора транзакций нет. Регрессионный DB-тест закрывает idle backend через `pg_terminate_backend` и проверяет новый запрос. Связь этого дефекта с конкретными production 502 пока не доказана.
- `VITE_MAINTENANCE_MODE` выключен. Owner-only Supabase write gate остаётся в `paused`: он блокирует DML старых вкладок, RPC и background writers на 38 source-таблицах.
- `analytics.trainer_overview`/`client_overview` на Yandex приведены к parity с Supabase (000079_analytics_overview_parity). `is_test_account` всегда `false` (email на Yandex не хранится), `last_sign_in_at` — приближение по session-таблицам.
- Первое голосовое или текстовое действие клиента использует отдельную идемпотентную own-client команду. Она возвращает существующую карточку, восстанавливает архивную и исправляет перенесённый аккаунт, оставшийся на merged source, атомарной привязкой к активной канонической карточке; общий trainer create-контракт не меняется.
- Тренировки клиента получили третий статус «кем создана» — `workouts.origin` (`manual`/`ai`, пишется один раз при создании) на обоих backend; «Создана ИИ» ставится только для тренировок из сгенерированной ассистентом программы (`create_program_draft`/`schedule_program`), не для голосового/текстового логирования уже сделанной тренировки (`record_workout`). Тренерская ветка подписи не читает `origin`. Карточка тренировки из избранного показывает снэпшот его названия (`workouts.favorite_title`, тоже write-once, вариант C3: «⭐ Название · Создана вами») — план полностью реализован, `docs/design/workout-origin-and-favorite-title.md`.

## Yandex Cloud — подтверждённая база

- Существующий Terraform stack `fit/stage` принят как production data plane: Managed PostgreSQL 17, один private host, диск 10 GB, API/migration containers, Lockbox и Object Storage. Backup retention — 14 дней, окно — `00:30 UTC`; отдельный production cluster не создаётся.
- Текущий full-cohort manifest расширен до 35 таблиц: в snapshot входят `user_legal_acceptances`, `account_deletion_requests` и `favorite_workouts`. Import атомарно пересобирает их из свежего snapshot, сохраняя актуальные Yandex identity/session/rollout строки; устаревшие linked-привязки удаляются, а наличие нативного Yandex-профиля блокирует destructive rebuild.
- Локальная двухпроходная репетиция 35 таблиц снова зелёная. Tenant migration
  включает transaction-local restore mode, поэтому исторические progress/goal
  строки не обновляют `clients.updated_at`. Оба чистых прогона подтвердили
  одинаковые role/full-cohort fingerprints, repeat apply и checksum.
- Свежий current-snapshot cutover cycle при `paused` write gate завершён для
  всех 35 таблиц и 16 192 строк: source audit, target dry-run с rollback, первый
  apply и повторная полная пересборка подтвердили fingerprint
  `d59e1f1b9adb4361`.
  Оба apply проверили по 16 192 inserts; `favorite_workouts` — 1, legal
  acceptance — 128, deletion requests — 0. Media policy — `allow-missing`.
- Server-side rollout assignments для `linked-ready` профилей включены и
  проверены агрегированно. Server switches
  `YC_STAGE_YANDEX_NATIVE_REGISTRATION_ENABLED` и
  `YC_STAGE_YANDEX_ONLY_AUTH_ENABLED` включены; deploy `35467406265` прошёл
  migrations, runtime identity, health и readiness без rollback.
- Нативная регистрация через Yandex ID и финальный Yandex-only auth flow
  включены независимыми frontend/server switches. Неизвестный
  Yandex ID получает одноразовый 10-минутный handoff: старые Supabase
  credentials могут связать только уже перенесённый rollout-ready UUID, а новый
  профиль создаётся только после отдельного явного выбора. Неверный пароль не
  создаёт пустой профиль. Новая регистрация создаёт данные только в Yandex
  PostgreSQL.
- Для reviewed test-profile corrections добавлен приватный stage workflow
  отвязки Yandex identity по non-reversible tenant fingerprint. Он удаляет
  `app_private.auth_identities` provider `yandex` и отзывает активные
  `app_private.yandex_app_sessions` в одной транзакции без вывода raw UUID или
  provider subject в логи.
- Защищённый `/invite#token=…&source=…` в production читает и принимает новые
  и перенесённые legacy-ссылки только через Yandex API. Создание карточки
  спортсмена со ссылкой атомарно и идемпотентно по operation ID; client claim
  объединяет существующую самостоятельную карточку с данными тренера одной
  транзакцией, повтор безопасен, а активная связь требует явного отключения.
  Bearer-token хранится только в browser session; legacy `/join?code=…` также
  переживает Yandex OAuth.
  Production OAuth smoke подтвердил PKCE-переход на `oauth.yandex.ru`, а
  защищённый маршрут и старый password-recovery route возвращаются на единый
  Yandex ID экран без email/password формы.
- Yandex API покрывает основные read-write сценарии без fallback; каталог тренеров отдаёт только опубликованные анкеты принимающих клиентов по три карточки. Галерея до трёх фото хранит приватные оригиналы и миниатюры в Yandex Object Storage, метаданные — в Yandex PostgreSQL; каталог получает обложку, а публичная анкета — полноэкранную галерею. Старое одиночное фото остаётся совместимым. iPhone-файлы без MIME и HEIC/HEIF принимаются после клиентского преобразования, состояние загрузки видно рядом с кнопкой, а release smoke реально записывает, читает и удаляет фото в Yandex Object Storage. Рабочий список тренера содержит только активных клиентов, архив открывается отдельным последним пунктом и сохраняет карточку, историю, чат и восстановление.
- Анкета тренера, публичная карточка и фильтры каталога используют общий справочник метро Москвы и Санкт-Петербурга. Идентификаторы `msk-*` остаются совместимыми, новые станции используют `spb-*`; схема данных и Yandex API не менялись.
- Расписание тренера поддерживает неделю и две недели с сохранением диапазона при открытии дня; завершённая тренировка показывает расчёт активных калорий только при достаточных исходных данных.
- Для двух server-assigned тренеров активен Schedule V2. Колокольчик повторяет рабочую очередь, входящие объединяют вопросы и непрочитанный чат. Доводка от 25 сентября оставляет контекст над фокусом дневного таймлайна, не сбрасывает ручную прокрутку, нейтрализует прошедший незавершённый план, исключает отмены из недельной статистики, подписывает свободные дни и даёт независимый retry обоих источников входящих. Приватный серверный allowlist ограничен хешами этих двух подтверждённых логинов; другие тренеры остаются на V1.
- Yandex Web Push pipeline и production parser развёрнуты; нужны authenticated smoke push и summary. Push-dispatcher закрывает HTTP-сокет после каждого ответа и пишет безопасные этапы timer invocation (`received`/`rejected`/`completed`/`failed`) с request ID и длительностью без payload/текста ошибок. Уровень логов передаётся строкой для Cloud Logging, иначе INFO-фильтр скрывает записи Pino. Это поможет отделять platform-level 502 от сбоев обработчика, но первопричина прежних 502 не доказана; после деплоя нужен контроль таймера.
- Для 670 упражнений Vital Gym Pro завершён OIDC/private-runner перенос 2 010
  объектов (71 514 430 байт) по exact manifest. Первый apply загрузил и
  проверил все 2 010 объектов; повторный apply ничего не перезаписал
  (`uploaded=0`, `skipped=2010`). Финальный read-only audit подтвердил
  `verified=2010`, `missing=0`, `mismatched=0` и fingerprint
  `3f47c2c64d7d3a50`; signed-URL smoke и версионирование прошли. Main routing
  не включён, проверенные копии в Supabase сохранены.

## Открытые post-cutover задачи и риски

1. Выполнить успешный media migration без `allow-missing` для оставшихся chat
   и custom-exercise objects; Vital Gym Pro уже перенесён и полностью проверен.
2. Добавить Yandex custom-exercise photo adapter.
3. Frontend больше не создаёт Supabase SDK при импорте и не подписывается на
   Supabase Auth при Yandex-only входе; production сборка не требует
   `VITE_SUPABASE_*`. В Yandex-only режиме даже сохранённая конфигурация
   Supabase не разрешает создать browser client; отсутствие Yandex session у
   авторизованного actor не выбирает Supabase. Удаление browser vars из Vercel
   Production ждёт deployment и smoke. Legacy browser path остаётся для
   локальной разработки и Preview; серверный bridge нужен для recovery и media,
   его secrets не удалять. Публичная анкета выбирает источник вместе с routing без
   межпровайдерного fallback.
4. Провести ручной E2E matrix с реальными тестовыми identities: linked trainer,
   linked client, recovery старого email-only профиля, новый Yandex-only аккаунт
   и оба invitation path. Автоматизированы серверные контракты, production auth
   DOM, PKCE redirect и unauthenticated guards; реальный OAuth callback в этом
   cutover-сеансе не выполнялся.
5. Провести backup restore drill, повторить authenticated AI summary и push
   smoke. До завершения observation window Supabase не удалять: write gate
   остаётся paused, а обратной миграции Yandex writes нет.

## Ближайший порядок

1. Наблюдать Yandex auth/API errors и выполнить ручной E2E matrix тестовыми
   trainer/client accounts; при инциденте возвращать maintenance и делать
   forward-fix, а не включать Supabase UI поверх появившихся Yandex writes.
2. Закрыть media/custom-photo и AI/push/backup задачи.
3. По `docs/design/SUPABASE_DECOMMISSION_INVENTORY_2026-09-25.md` закрывать
   зависимости по одной; после окна стабильности отключить Supabase и удалить secrets.

## Отложено
- DataLens/Telegram/Tracker отложены; HA replica нужна только по SLA; APNs и Android/FCM не входят в Web Push cutover.
