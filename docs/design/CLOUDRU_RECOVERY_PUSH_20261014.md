# Разовое уведомление о восстановлении ФИТ

Поток: assistant-ops. Base main 938b69e0. Пользователь согласовал текст и
поручил подключить доставку из Cloud.ru и отправить уведомление.

## Acceptance

1. Доставка из новой Cloud.ru базы на существующие Web Push подписки.
2. Точный заголовок: «ФИТ снова работает 💪».
3. Точный текст: «Всё починили. Возвращайтесь к тренировкам!».
4. Нажатие открывает `/`; пользователи без подписки не входят в охват.
5. Исключить выключивших все категории и повторную постановку на устройство.
6. Проверить результат агрегатами, без идентификаторов/подписок/секретов в логах.

## Реализация и ограничения

Manual main-only workflow на доверенном Cloud.ru runner. Использует запущенный
immutable API image и read-only mount проверенного CLI, без выпуска API/UI.
Никаких миграций, IAM/DNS/AI/runtime изменений, записи в Yandex или старые БД.
Отдельный campaign key в существующем outbox. Транзакционная advisory lock и
существующий unique constraint обеспечивают enqueue идемпотентность.

Отправка только новой кампании, пачки до 20, максимум 2000 за запуск.
После таймаута прежнего helper используется прямой Web Push из Cloud.ru:
читаются прежние VAPID ключи из существующей версии Lockbox, без генерации,
rotation, Yandex deployment/IAM или изменения browser identity. Ключи только
в masked временном env-файле runner (0600) и памяти ephemeral контейнера,
с удалением файла при выходе. Provider socket timeout10s, ответы на устройства
фиксируются отдельно. Inspect — только SELECT агрегатов из Cloud.ru.

Confirmed successes не пересылаются. Известные ошибки записываются через
существующий multi-device finalizer; 404/410 удаляют только протухшее устройство.
Неизвестный результат доставки остаётся leased: автоматического resend/release
нет. В mixed batch confirmed rows получают отдельный lease token и штатный
finalize; socket/transport unknown rows сохраняют исходную lease. Это не
абсолютная гарантия exactly-once Web Push, чтения сообщения или
отображения на устройстве. Общий прежний dispatcher не следует включать для
этой кампании: он может автоматически повторить leased записи через 10 минут.
Исторический outbox не отправляется этим CLI. Новый cron/systemd timer не
устанавливается: задача — одна согласованная рассылка, не миграция всех
background jobs. Native APNs/FCM не добавляются; это существующий Web Push.

## Проверки

Изолированный локальный PostgreSQL17 fixture с настоящим deployed multi-device
finalizer: read-only inspect, opt-out, multi-device, repeat enqueue/send,
unrelated historical campaign, invalid endpoint, unknown transport outcome,
post-enqueue unsubscribe/opt-out, transient error и mixed known/unknown.
Прямой sender проверяет exact payload/оригинальные ключи/timeout10s/санитизацию.
Локально10/10 passed. Предыдущий полный check и CI38598199813 прошли, PR1623
слит3b910679. Новый полный npm run check exit0: frontend2659/API1363+149standardDBskip,
infra262/hosting137/build; policy42/42 и YAML/Bash passed. Новый CI ещё гейт. Это разовая owner-only административная операция
в существующей схеме, не новый actor API или периодический product producer;
миграции/гранты и application runtime не меняются.

## Production observation и продолжение

Inspect38602797888:513profiles/52subscribed users/66subscriptions, очередь0.
Run38603247613 прошёл transport auth probe, enqueue66; первый dispatch потерял
aggregate response через20s, без HTTP/individual provider receipt. Последующий
inspect38603753593 подтвердил sent0/pending46/uncertain20. Эти20 не повторяются
и не объявляются sent/discarded без подтверждения. Продолжение отправляет только
46 ещё не попытанных devices напрямую, с сохранением отдельных unknown leases.

VITE_VAPID_PUBLIC_KEY в repository variables отсутствует. Новые keys не
генерируются: используется текущая immutable sender identity; при наличии
frontend public variable она должна совпадать. Подписка новых устройств в
Cloud.ru frontend этой task не меняется и не заявляется проверенной.

Exact manual recovery workflow и его policy test внесены в существующий
non-browser allowlist наряду с другими Cloud.ru административными workflow:
не меняются browser код/fixtures/DOM/API маршруты. Проверки database/API/infra
остаются; любой frontend/CI/unknown workflow path по-прежнему требует E2E.

## Runner ENOSPC до начала отправки

Прямой sender PR1625 слитee094d06 после свежего CI38613605501 success.
Run38614434397 остановился на checkout до чтения ключей/enqueue/dispatch:
annotation116026133399 подтверждает ENOSPC в /opt/actions-runner/_diag.
Других попыток доставки этим run нет;20unknown остаются неповторёнными.

Первый main-only trusted-host шаг send до checkout проверяет свободное место.
При менее512MiB применяется только default `podman image prune --force`:
неиспользуемые dangling build images, без --all, volumes, tagged images,
release directories или backups. После cleanup снова требуется минимум512MiB,
иначе остановка до отправки. Inspect cleanup не выполняет. Если runner не
сможет стартовать даже этот шаг, потребуется доступ к VM вне runner.

Cache guards6/6, YAML/Bash и diff check passed. Полный check exit0:
frontend2659/API1389+158standardDBskip/infra271/hosting137/build.
