# Развёртывание stage в Yandex Cloud

Эта инструкция описывает создание изолированного stage-контура Fit. Она не
разрешает переключение production, публичный доступ к API или изменение
текущего production-контура на Supabase.

## 1. Однократная подготовка

- Используйте отдельный каталог Yandex Cloud с подключённым платёжным аккаунтом.
- Создайте приватный Object Storage bucket с включённым версионированием для
  хранения Terraform state.
- Вне этого Terraform-стека создайте service account с минимально необходимыми
  правами и статический S3-ключ для доступа к state.
- Скопируйте `infra/yandex/backend.hcl.example` в игнорируемый Git файл
  `backend.hcl` и замените пример имени bucket и ключа state.
- Скопируйте `terraform.tfvars.example` в игнорируемый stage tfvars-файл.
- Не запускайте несколько `terraform apply` одновременно. Механизм блокировки
  через Yandex YDB/DynamoDB устарел в актуальном Terraform, поэтому для MVP
  операции выполняются строго последовательно.

Никогда не коммитьте ключи backend, tfvars, сохранённые планы, Terraform state,
URL базы данных, OAuth-секреты или выгрузки пользовательских данных.

## 2. Инициализация и проверка Terraform

Перейдите в каталог `infra/yandex` и задайте значения только в текущей shell-сессии:

```sh
export AWS_ACCESS_KEY_ID="<идентификатор S3-ключа для state>"
export AWS_SECRET_ACCESS_KEY="<секретная часть S3-ключа>"
export TF_VAR_cloud_id="<идентификатор облака>"
export TF_VAR_folder_id="<идентификатор stage-каталога>"

TF_CLI_CONFIG_FILE=terraform.rc.example terraform init \
  -backend-config=backend.hcl
terraform fmt -check
terraform validate
terraform plan -out=stage.tfplan
```

Перед любым применением внимательно изучите сохранённый plan. Он может
содержать чувствительные метаданные и должен оставаться вне Git.

На этом этапе основная инфраструктура приложения ещё не создаётся. Запуск
`terraform apply` требует отдельного подтверждения, поскольку создаёт
оплачиваемые облачные ресурсы.

## 3. Первичное создание Container Registry

Serverless Container нельзя создать, пока его образ не загружен. При этом имя
репозитория образов формирует Terraform. Поэтому только при первом развёртывании
сначала создайте Registry и repository отдельным проверенным apply:

```sh
terraform apply \
  -target=yandex_container_registry.api \
  -target=yandex_container_repository.api
```

Из корня репозитория соберите API с помощью Podman. Затем присвойте образу имя
из Terraform output `api_repository_name` и загрузите его в Yandex Container
Registry через аутентифицированную сессию. В качестве тега используйте
неизменяемый SHA коммита, а не `latest`.

После загрузки образа установите `api_image_tag` равным этому SHA и сформируйте
новый полный plan. Не используйте bootstrap-plan для полного apply.

## 4. Создание stage-инфраструктуры

Первый полный apply создаёт оплачиваемые ресурсы и выполняется только после
отдельного подтверждения:

- приватный кластер Managed PostgreSQL 17;
- Serverless Container без постоянно прогретых экземпляров;
- VPC, subnet и security group для PostgreSQL;
- runtime service account, доступ к Registry и метаданные Lockbox.

У базы данных нет публичного IP. Порт PostgreSQL `6432` принимает соединения
только из пользовательской subnet и служебной сети Yandex Serverless Containers
`198.19.0.0/16`. Контейнер остаётся приватным, пока API не проверяет Yandex ID.

Сформируйте новый полный plan, проверьте перечень и параметры ресурсов и только
после этого примените его. Не включайте `allow_unauthenticated_api`.

## 5. Создание секретов и применение миграций

Получите сгенерированные учётные данные `fit_owner` и `fit_api` через Yandex
Connection Manager, не выводя их в логи, историю shell или чат. Вне Terraform
создайте две отдельные версии секретов Lockbox. Ключи payload должны в точности
совпадать со следующими именами:

- `DATABASE_URL` использует пользователя `fit_api` и подключается только к API;
- `MIGRATION_DATABASE_URL` использует `fit_owner` и подключается только к
  временному migration container.

Значение `DATABASE_URL` должно включать:

- пользователя `fit_api`;
- приватный FQDN primary-хоста PostgreSQL;
- порт `6432` и базу `fit`;
- session pooling;
- `target_session_attrs=read-write`;
- небольшой connection timeout;
- `sslmode=verify-full`;
- `sslrootcert=/app/certs/yandex-cloud-ca.pem`.

Runtime-образ содержит публичный набор сертификатов Yandex Cloud из
`https://storage.yandexcloud.net/cloud-certs/CA.pem`. Проверенный SHA-256:
`6d148f85b5213445b23ad22ff45e47e1aa2be968f183f9bd6ff39de54d47a8ef`.
Перед истечением сертификатов или после публикации замены со стороны Yandex
необходимо проверить и обновить файл в репозитории.

Для применения миграций временно задайте:

- `database_owner_url_secret_version_id` — ID версии секрета владельца;
- `migration_invoker_member` — единственную заранее одобренную учётную запись
  оператора.

Проверьте и примените plan. Terraform создаст приватный migration container с
concurrency `1`, без публичного invoker.

От имени указанной учётной записи один раз вызовите `POST /migrate`. Runner
использует PostgreSQL advisory lock, применяет проверенные файлы из
`db/migrations` и возвращает только их имена. При ошибке API отдаёт общий ответ
без деталей подключения.

Проверьте таблицу `app_private.fit_migrations`. Затем верните
`database_owner_url_secret_version_id` и `migration_invoker_member` в `null`,
сформируйте новый plan и примените его. Это удалит migration container, отзовёт
его доступ к Lockbox и удалит invoker binding. После проверки деактивируйте
версию owner-secret.

В конце задайте `database_url_secret_version_id`, снова проверьте plan и
разверните revision основного API. Никогда не запускайте миграции при каждом
старте API и не подключайте учётные данные `fit_owner` к основному контейнеру.

## 6. Smoke-проверки

Вызывайте приватный контейнер от имени авторизованной учётной записи Yandex
Cloud:

1. `GET /health` возвращает `200 {"status":"ok"}` — это проверка процесса без БД.
2. `GET /ready` возвращает `200 {"status":"ready"}` и выполняет `select 1`
   через runtime pool.
3. При отсутствующем или заведомо неверном database secret `/ready` возвращает
   только `503 {"status":"not_ready"}`, без деталей подключения.
4. Убедитесь, что у PostgreSQL по-прежнему нет публичного IP.
5. Убедитесь, что контейнер нельзя вызвать от имени `system:allUsers`.
6. Проверьте наличие миграций `000001`–`000003` в
   `app_private.fit_migrations`.
7. Убедитесь, что временный migration container удалён, а версия owner-secret
   деактивирована.

Зафиксируйте ID ресурсов, digest образа, версию миграций и результаты smoke.
Не сохраняйте значения секретов.

## 7. Условие завершения stage readiness

Stage считается готовым только после успешной приватной авторизации вызова,
DB-readiness и проверки миграций. До реализации и ревью Yandex ID и
пользовательских сессий запрещено:

- включать публичный invoker;
- менять frontend API URL;
- переключать production-переменные;
- отключать или изменять текущий Supabase-контур.

После успешного stage smoke следующий этап — Yandex ID, вертикальный срез
профиля и серверная tenant-allowlist. Первый пилот использует только внутренние
или синтетические аккаунты и остаётся read-only. Перенос остальных доменных
функций продолжается только после проверки этого auth-среза. Полная схема
когортного переключения описана в `docs/design/yandex-cloud-migration.md`.
