# Cloud.ru: новые миграции перед выпуском API

## Решение владельца

14.10.2026 владелец поручил включить автоматическое применение новых миграций
Cloud.ru. Разрешены реализация, обычный PR/зелёный CI/merge, первый проверенный
ручной выпуск и последующее включение автоматического выпуска API. Yandex
Cloud не использовать, не повторять initial import и не сбрасывать БД.
Базовый main: 938b69e0, после более раннего зелёного документационного PR1622.
Включён main3b910679/PR1623; обе параллельные записи snapshot сохранены.

## Неизменяемая приёмка

1. Использовать существующий Release Cloud.ru API, только после полного зелёного
   CI точного текущего main; сохранить serial VM lock и защиту source/SHA.
2. Перед кандидатом API применять только pending Up из immutable exact-main
   образа, одной транзакцией со стандартным advisory lock node-pg-migrate.
   Dry-run — план, не доказательство исполнения SQL; успешный apply проверяется.
3. Использовать отдельного fit_owner через существующий private GitHub secret;
   не передавать owner в API runtime, не читать production secrets локально.
   Подключаться только к принятому Cloud.ru target и не менять TLS-политику.
4. Отказать при пустой/неизвестной истории, неправильном owner/target, concurrent
   migrator, transaction boundaries в Up и ошибках backup/SQL. Не создавать
   production схему заново; не делать down/reset/restore/snapshot import.
5. До pending apply сохранить приватный pre-migration pg_dump17 archive и
   проверить его pg_restore --list; не перезаписывать/публиковать/автоматически
   удалять backup. Обозначить ограничения локальной копии и retention.
6. При ошибке миграции оставить прежний API. После успеха сохранить существующие
   candidate/ready/unauthorized/switch/rollback checks. API rollback не является
   DB rollback; совместимость forward schema обязательна.
7. Проверить no-op/retry, atomic SQL failure, lock contention, backup failure,
   историю/identity и реальный локальный PostgreSQL17 backup/restore; добавить
   эти проверки в CI без ослабления старых gates. Локально только Podman.
8. После зелёных local/PR/main проверок один раз вручную выпустить текущий main;
   проверить реальные VM proofs и публичный API. Только затем включить API
   automatic-release flag и проверить readback. Frontend/AI/OAuth/DNS, migration
   numbering, исходные данные и первоначальные transfer workflows не менять.

## Проверка и статус

Реализация — release workflow и отдельный redacted owner CLI. Scope не добавляет
новой numbered migration, не меняет UI/DTO/RLS и не переносит данные из legacy.
Локально: полный npm run check exit0 (frontend2659/API1386 и151 стандартно
skipped DB tests/infra262/hosting137/build), отдельные unit26/workflow38 и JQ
contract checks passed. На нативном Podman PostgreSQL17.11 clean-chain через143,
actor/RLS142 и migrations/backup9 —151/151 passed, включая настоящий
pg_dump/pg_restore с сохранением исходных fixture rows. Предыдущий x64-on-arm
прогон149/151 упёрся в2 старых RLS deadline5s; таймауты/проверки не менялись.
После включения main3b910679 полный check повторён: frontend2659/API1387 и157
стандартно skipped DB tests/infra263/hosting137/build —exit0; свежий API check
после обработки idle-connection ошибок тоже1387 passed.
Новой схемы/SQL migrations нет, local:verify не запускался вместо изолированного
clean-chain. PR/main CI и production/manual/autoflag ещё гейты.
В CI real backup/restore использует уже существующий PostgreSQL17 service;
Docker engine только GitHub-hosted service, локально используется Podman.

YAFIT не создавался; задача и acceptance фиксируются этим документом и PR.
