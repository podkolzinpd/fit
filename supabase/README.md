# Замороженный Supabase baseline — архив

SQL migrations (202), pgTAP tests (107), seed, config и generated types сохранены
побайтно из main4e283aa5. Они не запускаются из dev/local:prepare/local:verify,
npm check или GitHub CI. Root package/lockfile не устанавливают Supabase CLI.
Новые migrations создаются только в services/api/db/migrations.

Это исходники для отдельной legacy-репетиции, а не backup удалённой DB/Auth/Storage.
Generated types ещё читают operational consumers. Пути оставлены прежними для
manual source workflows и rollback tooling; их удаление не входит в этот этап.
Ресурсы/credentials/production и серверный media bridge не менялись.

## Целостность

Из корня checkout (macOS):

```sh
shasum -a 256 -c supabase/SHA256SUMS
node supabase/tools/check-db-types.mjs
```

В Linux вместо shasum можно использовать sha256sum -c.
Манифест фиксирует все tracked baseline-файлы; новые README/tools в него не входят.
Migration safety продолжает защищать обе истории от переписывания.
Архив хранится до отдельного решения по decommission/rollback.

## Только явная legacy-репетиция

Не нужна для разработки и native acceptance. Установите Podman и запустите его.
CLI запрашивается отдельно, pinned версия не добавляется в root dependencies.
Из корня checkout с локальным config (production env не передавать):

```sh
npm exec --yes --package=supabase@2.116.0 -- supabase start
npm exec --yes --package=supabase@2.116.0 -- supabase migration up --local
npm exec --yes --package=supabase@2.116.0 -- supabase test db --local
node scripts/run-local-tenant-rehearsal.mjs
npm exec --yes --package=supabase@2.116.0 -- supabase stop
```

Репетиция проверяет наличие source container заранее и готовит только локальный
native target через local:prepare. Она не включается из обычных команд или CI.
Сброс legacy seed при необходимости — отдельная явная команда
`npm exec --yes --package=supabase@2.116.0 -- supabase db reset --local`.
Этот reset удаляет локальные legacy-данные; к native PostgreSQL он не относится.
