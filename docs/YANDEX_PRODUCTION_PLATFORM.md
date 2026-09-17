# Минимальный production-контур в Yandex Cloud

## Результат

Fit получает чистое production-окружение на уже проверенном Yandex Terraform
stack. Оно изолировано от stage отдельным remote state и именами `fit-prod-*`,
но намеренно не добавляет инфраструктуру, которая не нужна продукту примерно до
1 000 пользователей.

Создание платформы само по себе не переносит данные, не делает API публичным,
не включает Yandex routing и не меняет текущий production Supabase.

## Профиль ресурсов

- отдельный Terraform state `fit/prod/terraform.tfstate`;
- существующий Yandex cloud/folder и OIDC deploy identity;
- один private Managed PostgreSQL 17 host `s3-c2-m8` без публичного IP;
- 20 GB network SSD и deletion protection;
- ежедневный managed backup с окном `00:30 UTC`;
- 14 дней automatic backup/PITR retention;
- отдельные `fit_owner` и `fit_api` credentials через Connection Manager;
- private API и private migration Serverless Containers;
- zero provisioned instances: контейнеры оплачиваются только при вызовах;
- private versioned Object Storage для новых медиа; старые Supabase objects этим
  bootstrap не копируются;
- существующие Container Registry, Lockbox и immutable image conventions.

Один host — осознанный MVP-компромисс. Во время обслуживания или отказа host
приложение может быть недоступно. Второй host добавляется только после фактической
потребности в SLA; схема данных и приложение для этого не меняются.

## Provisioning workflow

Workflow `.github/workflows/provision-yandex-production.yml` запускается только
вручную и single-flight.

Первый запуск:

1. `plan_only=true`;
2. проверить список создаваемых ресурсов и отсутствие delete/replace;
3. убедиться, что план содержит ровно один PostgreSQL host;
4. сохранить plan summary в журнале запуска; сам `.tfplan` не публикуется как
   artifact.

Apply требует отдельного запуска:

```text
plan_only=false
confirmation=PROVISION_FIT_YANDEX_PRODUCTION
```

Workflow применяет только узкий production platform target, собирает один
immutable API image, создаёт private API/migration containers, применяет
numbered Yandex migrations через private runner и проверяет `/health`, `/ready`,
private network, deletion protection и 14-дневный backup retention.

Workflow не создаёт push timer, не включает `system:allUsers`, не выдаёт
rollout assignments и не вызывает tenant data apply.

## Мониторинг

Для текущего масштаба используется встроенный Yandex Monitoring, без отдельного
observability stack. Перед data cutover оператор создаёт alerts из service
dashboards:

| Сигнал | Warning | Alarm |
| --- | --- | --- |
| `postgres-is_alive` | — | меньше `1` или no data |
| `disk.used_bytes` для 20 GiB | `17 179 869 184` bytes | `19 327 352 832` bytes |
| `serverless.containers.errors_per_second` для API | больше `0` пять минут | устойчивый рост десять минут |
| API synthetic `/health` и `/ready` | один сбой | три последовательных сбоя |

В single-host topology replication-lag alert не нужен. Он становится
обязательным одновременно с добавлением replica.

Ни alert, ни health-check не должны включать UUID, пользовательские данные,
токены или тела ошибок.

## Backup и восстановление

Managed PostgreSQL ежедневно создаёт backups и поддерживает point-in-time
recovery в пределах 14-дневного окна. Восстановление всегда выполняется в новый
временный cluster, а не поверх production.

Проверка перед первым cutover:

1. убедиться, что последний backup завершён не более 24 часов назад;
2. восстановить его в отдельный private cluster;
3. применить только необходимые forward migrations;
4. проверить количество таблиц и агрегированные counts без чтения PII в CI;
5. удалить временный cluster после фиксации результата проверки.

Автоматическое удаление production cluster запрещено Terraform plan policy даже
при ручном override.

## Не входит в bootstrap

- перенос Supabase tenant/full-cohort данных;
- Yandex ID-only регистрация;
- public API invocation и frontend routing;
- push dispatcher/timer;
- перенос старых media objects;
- отключение Supabase;
- HA replica и multi-zone topology.

Эти изменения выполняются только после отдельного parity/data/auth gate.
