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
Существующий Yandex Web Push sender переиспользуется как транспорт: новая БД
остаётся Cloud.ru. Читается только существующий dispatch secret; VAPID private
key остаётся в существующем Lockbox/function, ключи не генерируются.
До enqueue authenticated malformed probe проверяет доступность transport без
пользовательской отправки. Inspect — только SELECT агрегатов из Cloud.ru.

Confirmed successes не пересылаются. Известные ошибки записываются через
существующий multi-device finalizer; 404/410 удаляют только протухшее устройство.
Неизвестный результат доставки остаётся leased: автоматического resend/release
нет. Это не абсолютная гарантия exactly-once Web Push, чтения сообщения или
отображения на устройстве. Общий прежний dispatcher не следует включать для
этой кампании: он может автоматически повторить leased записи через 10 минут.
Исторический outbox не отправляется этим CLI. Новый cron/systemd timer не
устанавливается: задача — одна согласованная рассылка, не миграция всех
background jobs. Native APNs/FCM не добавляются; это существующий Web Push.

## Проверки

Изолированный локальный PostgreSQL17 fixture с настоящим deployed multi-device
finalizer: read-only inspect, opt-out, multi-device, repeat enqueue/send,
unrelated historical campaign, invalid endpoint, unknown transport outcome,
post-enqueue unsubscribe/opt-out, transient error. Локально 7/7 passed; workflow/CI policy39/39 и YAML/Bash syntax passed.
Полный npm run check exit0: frontend2659, API1361 (148 стандартных
DB/isolated tests skipped; отдельные семь PostgreSQL проверок запущены явно),
infra262, hosting137, build. Это разовая owner-only административная операция
в существующей схеме, не новый actor API или периодический product producer;
миграции/гранты и application runtime не меняются. Production ещё не менялся.
