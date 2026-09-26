# Подготовка frontend к Yandex Cloud — шаг 1

Поток: assistant-ops. База: `2bbee209`.
Результат: независимая подготовка hosting-артефакта без отказа от Vercel.
Таблицы/API, provider routing, роли и продуктовые флаги не меняются.
Supabase/Yandex доменные реализации не затронуты.

## Согласованные границы

1. Подготовить инфраструктуру для frontend в Yandex Cloud.
2. Подготовить отдельный запуск сборки и публикации вручную.
3. Подготовить настройки маршрутов, кеширования и HTTPS.
4. Подготовить проверку новой версии и откат.
5. Подготовить инструкцию будущего переключения домена, OAuth и CORS.

Первый шаг выполняет только безопасную основу этих пунктов. Не создаём платные
ресурсы, не меняем DNS и production-настройки. Vercel работает как прежде.
Публикация, публичный доступ, переключение и удаление Vercel требуют отдельного
разрешения. Этот PR не означает готовность Yandex frontend к production.

## Фактически реализовано

- 1: отдельный Terraform root `infra/yandex-frontend`, выключенный по умолчанию.
  При будущем включении описывает только закрытый versioned bucket с защитой
  от удаления. Не подключён к действующему `infra/yandex` или его state.
- 2: ручной `prepare-yandex-frontend.yml` собирает offline rehearsal и сохраняет
  артефакт на 7 дней. У него только `contents: read`, нет cloud credentials,
  OIDC, upload в S3 или apply. Публикация намеренно остаётся следующим шагом.
- 3: манифест содержит MIME/cache metadata и точную копию текущих Vercel routes.
  Хешированные assets — immutable, остальные файлы (включая HTML, SW и recovery)
  — no-cache. Реализация маршрутов и TLS на целевом hosting ещё не выполнена.
- 4: SHA-256/размер каждого файла, commit SHA, проверка обязательных файлов,
  запрет symlinks, скрытых файлов, source maps и неизвестных расширений.
  `deployable: false` запрещает считать rehearsal готовым release. Versioning
  бакета само по себе не реализует атомарный rollout/rollback: это следующий шаг.
- 5: ограничения и gate переключения перечислены ниже.

## Локальная проверка

`node --test scripts/prepare-yandex-frontend.test.mjs`

После обычной локальной сборки (только локальные backend-настройки):

`node scripts/prepare-yandex-frontend.mjs dist <full-commit-sha> /tmp/frontend-manifest.json`

Манифест должен быть вне dist и не существовать: файл не перезаписывается.
Пакет состоит из dist и манифеста. Manifest описывает upload metadata, но не
меняет HTTP-ответы уже работающего сайта. Не публиковать rehearsal: он собран
с localhost/placeholder настройками, не с production environment.

Terraform: `init -backend=false`, `fmt -check`, `validate`, `test` с mock provider.
Тесты не требуют IAM и не вызывают cloud API. `apply` в этом шаге запрещён.
Перед настоящим apply отдельно выбрать state/backend, identity и folder,
проверить бюджет и точный plan; не использовать state действующего API stack.

## Gates следующего шага

- Выбрать домен и endpoint отдельно от Vercel; подтвердить бюджет.
- Реализовать и проверить HTTP parity: static files, `/trainer`, `/client`,
  `/auth/yandex/callback`, `/invite` с query/fragment, неизвестные JS через
  asset-recovery.js, прочие отсутствующие assets как 404, правильные MIME.
  Object Storage `error_document=index.html` НЕ эквивалентен Vercel rewrite:
  он может возвращать HTML со статусом ошибки и не воспроизводит recovery.
  Выбор router/gateway и его стоимость пока не согласованы.
- Отдельно подготовить проверенный public build env без OAuth secret и
  Supabase browser fallback; не копировать production env в локальные файлы.
- Разделить immutable release files и активный entrypoint; атомарно активировать
  release только после verification и сохранять assets предыдущих релизов.
  Проверить rollback, старые вкладки, service worker и cache invalidation.
- Настроить HTTPS, DNS, OAuth allowlist и API CORS только после разрешения.
  Storage и push привязаны к origin: проверить повторный вход и переподписку,
  старые уведомления и приглашения; сессии автоматически на новый домен не перенесутся.
- Провести локальные route tests, затем согласованный удалённый smoke обеих ролей.
- Vercel сохраняется до отдельного решения после успешного observation window.

Подготовка не меняет пользовательскую функцию, PRODUCT_WIKI не изменяется.
