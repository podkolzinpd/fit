# Yandex Cloud → Cloud.ru stage database migration

## Scope

Поток: `data-media`.

Пользовательский результат: подготовить уже созданный Cloud.ru PostgreSQL как
проверенную копию текущего PostgreSQL проекта в Yandex Cloud и запустить
Cloud.ru API локально на `fit-stage-app`, не переключая внешний трафик.

Базовый main commit: `6ac17b7c4806bfcbcc66b048b763976c3e4b1b43`.

Источник: production PostgreSQL в Yandex Cloud, строго read-only snapshot.
Цель: существующий `fit-stage-postgres` в Cloud.ru. Supabase не является
источником этой миграции.

Что запрещено этой задачей: менять маршрутизацию production, останавливать или
перезаписывать Yandex PostgreSQL, включать внешний Cloud.ru API, удалять
Yandex/Supabase rollback-ресурсы или ослаблять TLS-проверку.

## Неизменяемый acceptance-чеклист владельца

1. Создать PostgreSQL и сетевой доступ только от `fit-stage-app`.
2. Создать раздельных пользователей: migration owner и runtime с минимальными правами.
3. Безопасно разместить runtime secrets.
4. Проверить TLS-подключение.
5. Сделать backup/restore gate.
6. Запустить migration dry-run и затем миграции на пустой stage-БД.
7. Только после проверки запустить API локально без внешнего трафика и выполнить `/health`, `/ready` и продуктовый smoke.

Yandex production и её данные при этом не трогаем.

Уточнение владельца: PostgreSQL в Cloud.ru уже создан; данные мигрируются из
Yandex Cloud проекта.

## Реализация

- Yandex migration-container создаёт `pg_dump --format=custom --data-only` в
  одной согласованной read-only snapshot-транзакции. Таблица истории миграций
  исключена, потому что схема цели воспроизводится numbered migrations.
- Dump шифруется AES-256-GCM случайной одноразовой фразой до загрузки во
  временный private Object Storage key. В логи не попадают URL, credentials,
  PII, строки таблиц или ключ шифрования.
- Cloud.ru self-hosted runner скачивает encrypted object по короткоживущему
  signed URL, проверяет SHA-256, применяет dry-run и затем numbered migrations,
  требует пустые application tables и выполняет `pg_restore` с
  `--single-transaction --exit-on-error`.
- После restore выполняются database/runtime identity checks, `/health`,
  `/ready` и локальный product smoke через loopback. Контейнер не публикуется
  наружу.
- Временный encrypted object удаляется в `always()` cleanup; исходный Yandex
  PostgreSQL остаётся неизменным.

## Гейты

| Пункт | Доказательство | Статус |
| --- | --- | --- |
| Existing Cloud.ru cluster/private network | console readback: `fit-stage-postgres`, `10.70.10.67:5432`, same VPC/subnet as `fit-stage-app` | подтверждено |
| Separate roles | `fit_owner`, `fit_api` | подтверждено |
| Runtime secrets | Cloud.ru Secret Management `fit/stage/runtime`; GitHub receives only masked migration/runtime values approved by owner | подготовлено, transfer pending |
| TLS | verified connection from `fit-stage-app`; no `sslmode=disable` | pending |
| Backup/restore | ready backup `initial-backup`; encrypted source archive integrity and transactional restore | backup confirmed, restore pending |
| Migrations | dry-run then apply against empty target | pending |
| API | loopback-only health/ready/product smoke | pending |

