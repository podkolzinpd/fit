# Автопубликация FIT в Yandex Cloud

## Подтверждённый план, 27 сентября 2026

1. **Доступ к облаку:** отдельный сервисный аккаунт для публикации — запись только в frontend-бакет и обновление только frontend-шлюза. Без доступа к БД и секретам приложения; авторизация через OIDC, без постоянных ключей.
2. **Автозапуск:** после успешных обязательных проверок `main` собирать именно проверенный коммит с production-настройками.
3. **Публикация:** загружать сборку в отдельную версию, проверять файлы и только затем переключать шлюз. Старую версию сохранять для отката.
4. **Проверка:** проверить страницу входа, JS/CSS и прямые маршруты через технический адрес. При неудаче возвращать предыдущую версию.
5. **Первый выпуск:** проверить весь процесс и откат. Vercel и его публикацию не менять.

## Границы

Frontend only: нет миграций, изменений product API, auth logic, DNS, CORS,
сертификата, frontend request logging или Vercel. Технический адрес и
`fit-training.ru` используют один шлюз. DNS не блокирует release smoke.
Это не новая пользовательская функция; новые экраны/тексты/дизайн не вводятся.
Настоящий OAuth и browser WASM остаются отдельными проверками: HTTP smoke
не выдаётся за авторизованный E2E.

## Контракт выпуска

- `CI` проверяет также push в `main`. Успешный CI для PR не считается проверкой
  merge-коммита. `workflow_run` принимает только push из своего репозитория.
- Повторный запуск вручную принимает ID успешного CI на текущем `main`,
  не произвольную ветку или SHA. Проверяются workflow path, repository,
  event, branch, conclusion и совпадение с текущим head.
- `YC_FRONTEND_AUTODEPLOY_ENABLED=true` включает запуск только после подготовки
  IAM/environment. До этого workflow пропускается без облачных операций.
- Сборка выполняется без cloud identity в `fit-frontend-candidate`, используя
  существующие public build variables. В deployment job нет npm/install scripts;
  он получает только same-run artifact, повторно проверяет checksum/commit и
  обменивает OIDC через environment `fit-frontend-production`.
- `fit-frontend-production` разрешает только branch `main`. Subject:
  `repo:podkolzinpd/fit:environment:fit-frontend-production`. Audience:
  `https://github.com/podkolzinpd`. Отдельная переменная `YC_FRONTEND_DEPLOY_SA_ID`
  не переиспользует broad backend deploy identity.
- Один concurrency group, `cancel-in-progress=false`. Head повторно сверяется
  перед получением credentials и непосредственно перед activation.
- `releases/<commit>-<sha256>/` immutable: существующие bytes не перезаписываются;
  каждая загрузка сверяется скачиванием и SHA-256, затем проверяются metadata.
- Предыдущий OpenAPI JSON сохраняется до загрузки в artifact на 90 дней.
  Новая спецификация сохраняет прежние hashed asset routes. Нехватка места
  или лимит размера спецификации останавливают выпуск, не удаляют старые версии.
- Только WASM, превышающие лимит ответа Gateway, получают exact-object
  `public-read`. Проверяются redirect, bytes и CORS обоих frontend origins.
  Бакет целиком не открывается; его policy/CORS workflow не редактирует.
- Шлюз обновляется только через `--spec`; домены, certificate и log options
  не меняются. До и после проверяется ACTIVE и disabled request logging.
- HTTP smoke проверяет все файлы и их SHA-256 (после HTTP decompression),
  MIME/cache, `/auth`, callback, `/today`, missing CSS 404 и JS recovery.
- При ошибке activation/smoke текущая спецификация перечитывается. Откат
  допустим только когда она равна нашей candidate или старой версии, и шлюз
  уже ACTIVE. Чужую параллельную правку или зависшую UPDATING не затираем:
  запуск красный, требуется оператор с сохранённым backup.
- После rollback сверяются спецификация и HTML прежнего `/auth`; неуспешный
  выпуск остаётся красным даже после успешного отката.

## Одобренные права (не расширять автоматически)

`fit-frontend-deployer`:

- `s3:GetObject`, `s3:PutObject` только `fit-frontend-probe-b1goqho1/releases/*`;
- `s3:PutObjectAcl` только `releases/*/assets/*.wasm` этого бакета;
- `api-gateway.editor` только `d5drmhq5ovqk03jgsm8i` (роль также технически
  позволяет удалить шлюз; workflow не вызывает delete);
- `iam.serviceAccounts.user` только reader `aje67ouc4633u7i7oc2a`;
- OIDC subject выше; никаких статических ключей, ролей на каталог,
  доступа к PostgreSQL, Lockbox, media или DNS.

## Ручной откат / аварийное восстановление

Остановить новые запуски: repository variable
`YC_FRONTEND_AUTODEPLOY_ENABLED=false`. Не отменять процесс посреди activation.
Скачать artifact `yandex-frontend-gateway-<run_id>` именно нужного deployment
run. Проверить ACTIVE и отсутствие другого deployment; проверить, что
`previous-gateway.json` относится к frontend-шлюзу и нужному выпуску.
Под той же scoped identity выполнить:

```sh
yc serverless api-gateway update d5drmhq5ovqk03jgsm8i --spec previous-gateway.json
```

Сверить read-back спецификации, `/auth`, JS/CSS, service worker и request logs
disabled=true. Не менять DNS и не удалять сборки. При зависшей облачной
операции сначала определить её конечный статус, не посылать слепые повторы.

## Приёмка и фактура

| Пункт | Доказательство / статус |
| --- | --- |
| 1 | Созданы deploy SA/OIDC и main-only GitHub environment; gateway access работает. Storage policy сама по себе даёт 403: базовая IAM-роль требует дополнительного согласования. |
| 2 | Workflow и exact-main guards реализованы; тесты workflow проходят локально. |
| 3 | Unit tests проверяют порядок backup/upload/verify/activate, сохранение assets и коллизии; remote выпуск ещё не выполнен. |
| 4 | Unit tests: smoke failure, потерянный ответ update, чужое изменение, unsettled operation, rollback verification. |
| 5 | Требуются зелёный CI, первый remote выпуск и rollback drill; Vercel не менялся. |

Tracker недоступен в текущем окружении (нет авторизованного CLI/MCP);
утверждённый план и приёмка сохранены здесь, без вымышленного номера тикета.

Локальная проверка: `npm run check` прошёл lint/typecheck, 2021 unit/component
тест, generated types, iOS permissions, media и 172 infra tests. Пять hosting
HTTP-тестов остановил sandbox `listen EPERM`; отдельно с разрешённым localhost
полный hosting suite прошёл. API: 927 passed / 49 skipped, lint/typecheck/build.
Frontend production build с локальными placeholder-параметрами и startup guard
прошли. После уточнения guards повторно выполнены целевые deployment/CI tests.
