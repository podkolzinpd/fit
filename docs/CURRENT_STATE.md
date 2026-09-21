# Fit — текущее состояние проекта
> Rolling snapshot для продолжения между сессиями, максимум 120 строк; полная история хранится в Git, PR и Tracker.
Обновлено: 2026-09-21. База изменений: `3e0e223b` (#1131). Frontend остаётся на Vercel, а production data plane — принятый Yandex Cloud stage stack.
Yandex ID является единственным production-входом; app-session, main routing и native registration включены глобально.

## Активная цель

Стабилизировать Yandex-only production после переключения и затем вывести Supabase из эксплуатации. До закрытия rollback-окна сохраняется общий доменный контракт без dual-write; гейты описаны в `docs/YANDEX_CUTOVER_PLAYBOOK.md`.

## Последняя проверенная продуктовая точка

- Assistant доступен обеим ролям; клиент работает только со своей карточкой, программы остаются за общим kill switch.
- Клиентская генерация четырёхнедельной программы работает через выбранный backend. Yandex API читает actor-scoped историю, цель, замеры и будущие занятия из PostgreSQL, использует короткие idempotent generation leases и вызывает тот же валидируемый YandexGPT generator вне DB-транзакции.
- Свои упражнения поддерживают текстовые metadata в обоих backend; изменение private JPEG всё ещё отклоняется, объекты не входят в подтверждённый перенос. Планирование, подробный план, результат и Live используют единые статичные миниатюры упражнений 48×48 с точным первым кадром или нейтральным fallback; крупная анимация остаётся только у текущего упражнения Live и в явном просмотре техники. Для всех 721 системных Vital, Vital Gym Pro и reference-анимаций заранее рассчитан безопасный canvas: 152 постера с однотонными полями продолжают фон карточки без растягивания или изменения масштаба фигуры; тот же контракт работает в миниатюрах и крупной технике.
- Legal acceptance и отменяемые deletion requests работают через выбранный backend с actor-scoped Yandex RLS/RPC и provider-neutral UI.
- Production auth показывает только действие «Продолжить с Yandex ID»; старые email/password/reset routes возвращаются на единый вход. Существующая связь Yandex ID с FIT-профилем при выдаче сессии атомарно создаёт отсутствующий `yandex/read_write` assignment или повышает прежний `yandex/read_only`; явный disabled/non-Yandex assignment остаётся административным запретом. Неизвестный Yandex ID получает recovery/new-account handoff. Recovery профиля одной транзакцией создаёт identity, `yandex/read_write` и первую app-session, а выбор нового аккаунта создаёт новый профиль; при любой ошибке всё откатывается. Callback различает незавершённую подготовку профиля и отключённый сервис сессий, не предлагает недоступный email-вход и показывает безопасную диагностику. Основной UI выбирает Yandex API без request-level fallback, а reload не сбрасывает активные Yandex requests.
- Frontend Yandex API принимает Postgres-native ISO timestamps с numeric offset (`+00:00`); карточка «Последняя тренировка» больше не падает из-за отличия от literal `Z`.
- Все запросы основного Yandex API и Yandex ID transport получают безопасный client-generated request ID, который API возвращает в ответе и использует как Fastify `reqId`. Штатные error-state позволяют скопировать этот ID вместе с release/status/operation без token, email, UUID профиля, request body и пользовательского текста.
- Короткие platform-level `502`, при которых Fastify ещё не вернул request ID, восстанавливаются для безопасных `GET`: параллельные чтения ждут один общий `/health` probe и после восстановления повторяются по одному разу. Любая mutation после 45 секунд без подтверждённого ответа API сначала выполняет общий безопасный `/health` preflight и отправляется ровно один раз только после его успеха; сама запись и application-level ошибки автоматически не повторяются. Одноразовые OAuth-коды защищены тем же контрактом.
- Stage API получает side-effect-free `POST /internal/warmup` от отдельного timer service account каждую минуту; endpoint не обращается к БД или внешней сети. Таймер делает до двух повторов с интервалом 10 секунд. Это уменьшает вероятность idle-suspension, не добавляя второй provisioned instance.
- Stage delivery подтверждает `min_instances` активной revision и проверяет её `/health` без retry. Application failure откатывает кандидата; platform failure без `x-fit-request-id` делает deploy красным, но не возвращает прошедший smoke API к непрогретой ревизии. Deploy `35634442287` повторно подтвердил исходный дефект: первый запрос после пяти минут простоя получил platform `502` до Fastify, следующий сразу вернул `200`; после выпуска warmup окончательный гейт — 1 000 `/health` за 50 минут без retry и `502` на одной revision.
- `VITE_MAINTENANCE_MODE` выключен. Owner-only Supabase write gate остаётся в `paused`: он блокирует DML старых вкладок, RPC и background writers на 38 source-таблицах.
- `analytics.trainer_overview`/`client_overview` на Yandex приведены к parity с Supabase (000079_analytics_overview_parity). `is_test_account` всегда `false` (email на Yandex не хранится), `last_sign_in_at` — приближение по session-таблицам.

## Yandex Cloud — подтверждённая база

- Существующий Terraform stack `fit/stage` принят как production data plane:
  Managed PostgreSQL 17, один private host, диск 10 GB, API/migration
  containers, Lockbox и Object Storage. Backup retention — 14 дней, окно —
  `00:30 UTC`; отдельный production cluster не создаётся.
- Текущий full-cohort manifest расширен до 35 таблиц: в snapshot входят
  `user_legal_acceptances`, `account_deletion_requests` и `favorite_workouts`.
  Import атомарно пересобирает их из свежего snapshot, сохраняя актуальные
  Yandex identity/session/rollout строки; устаревшие linked-привязки удаляются,
  а наличие нативного Yandex-профиля блокирует destructive rebuild.
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
- Расписание тренера поддерживает неделю и две недели с сохранением диапазона при открытии дня; завершённая тренировка показывает расчёт активных калорий только при достаточных исходных данных.
- Yandex Web Push pipeline и production parser развёрнуты; нужны authenticated end-to-end smoke push и текущего summary-контракта.
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
3. Убрать обязательность Supabase env и legacy bridge из production composition.
   Публичная анкета уже выбирает Supabase либо Yandex вместе с main routing без
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
3. После согласованного окна стабильности отключить Supabase Auth/Data API/
   Storage/Edge Functions, удалить fallback-код и production secrets.

## Отложено
- DataLens/Telegram/Tracker отложены; HA replica нужна только по SLA; APNs и Android/FCM не входят в Web Push cutover.
