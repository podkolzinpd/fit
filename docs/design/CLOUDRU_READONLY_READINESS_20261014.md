# Cloud.ru — проверка готовности без переключения, 14 октября

Поток: `data-media`/инфраструктурная приёмка. Base main `be729b74`.
Владелец поручил начать проверку актуальности БД, HTTPS и авторизации сейчас.

## Acceptance и scope

1. Сверить текущий main/CI и реальные публичные DNS/HTTPS без изменений.
2. Сравнить полный SQL manifest существующей Yandex-БД и непустой Cloud.ru-БД:
   все таблицы трёх схем, количество строк и SHA-256 тем же алгоритмом переноса.
   Только READ ONLY; никаких chunks/дампов/импорта или пользовательских строк
   в логах/артефактах. История миграций исключена существующим контрактом.
3. Прочитать источник до и после target snapshot. Изменившийся источник даёт
   inconclusive, несовпадение данных — отдельный результат, не ложный успех.
4. Проверить loopback API health/ready/401, сохранённую ревизию, auth/CORS и
   AI-off конфигурацию без вывода credential values. Это не реальный OAuth E2E.
5. Сохранить предохранители initial apply: только пустой target, явные backup
   и apply подтверждения, отсутствие API-контейнера. Нельзя обходить их ради
   сравнения уже перенесённых данных.
6. Не менять DNS/NS, публичный nginx, сертификаты/CA terms, IAM, API runtime,
   БД/media/maintenance, флаги автодеплоя. Не останавливать writers.

## Реализация

Не создаётся параллельный deployment workflow. Существующий manual main-only
`transfer-yandex-sql-to-cloudru.yml` получает независимый режим `audit`.
Он использует существующий IAM-protected `/sql-snapshot/manifest` и target
`YandexSqlSnapshotSource.manifest()` в одной bounded READ ONLY транзакции.
Target connection default_transaction_read_only=on, один connection, statement
timeout60s/lock2s. Existing immutable RUNNING_SHA image используется без сборки,
остановки или переустановки API; reviewed TypeScript entrypoint mounted readonly.
TLS require остаётся ранее согласованным Cloud.ru контрактом, не ослабляется.

Отчёт содержит только table names/counts и причины несовпадения; ни row payload,
ни per-table hashes не печатаются. Результат equal не разрешает cutover: после
проверки новые source writes возможны. Даже стабильность before/after не
доказывает, что запись не произошла и не была отменена между snapshot reads.
Требуется отдельный финальный согласованный write-control/freshness gate.

## Исходная фактура

- Main CI38533857563 success, SHAbe729b74; ранних открытых PR нет.
- Public NS остаются Yandex, root158.160.171.31, api A отсутствует.
- Прямой HTTPS VM87.242.117.210:443 отвергает соединение; сертификат/вход не
  подтверждены. Не запускались certbot/public-ingress workflow.
- Yandex frontend38534376473 упал на read-only deployment API HTTP503 до
  активации. Отдельный запрос с этой машины timeout на connect5s; это не
  доказывает глобальную недоступность или её причину.
- Cloud.ru private frontend38532114217 success/revision3f5bf3d8, API447c283e;
  SQL import38415761657 уже состоялся13.10. Необходимость обновления данных
  определяется аудитом, а не предположением, что перенос не был выполнен.

## Локальная проверка

Audit+snapshot10/10, workflow/scope32/32, API lint/typecheck/build, YAML/Bash
syntax и diff check passed. Полный npm run check exit0: frontend2659/API1358
(142 стандартных DB integration skipped), infra253/hosting137/build passed.
Первый sandbox-прогон остановился на localhost listen EPERM старого curl-теста;
повтор с разрешённым localhost прошёл, тесты/timeout не менялись.
DB schema/API runtime/UI не меняются: local:verify/новая clean-chain и WebKit
не запускались. Exact-head CI/merge/live audit ещё гейты. Реальный OAuth login
не подменяется 401/config/CORS smoke.
