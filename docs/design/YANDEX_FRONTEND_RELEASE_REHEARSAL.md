# Frontend hosting: offline release и HTTP-контракт

Поток: assistant-ops. База `89f85227`, после #1181.
Домен будет предоставлен позже. Подтверждён потолок 600 ₽/месяц на frontend,
отдельно от backend и домена; это не расчёт фактической стоимости.
БД, API, provider routing, auth, UI, роли и продуктовые флаги не меняются.
Ни Supabase-, ни Yandex-адаптеры продуктовых данных не затронуты.

## Scope текущего шага

Подготовить проверяемый пакет релиза и HTTP-репетицию до выбора облачного
router adapter. Не создавать ресурсы, не менять DNS, OAuth, CORS, Vercel env,
не запускать remote Preview, upload или production rollout.

Это **не законченная публикация в Yandex Cloud**. Пакет остаётся
`deployable: false`; локальный сервер не предназначен для production.
Конкретные Yandex service, TLS, цена и cloud identity ещё не выбраны.

## Исходные пункты плана и результат этого шага

1. Подготовить инфраструктуру для frontend в Yandex Cloud.
   — Без изменений: private default-off bucket template из #1181.
2. Подготовить отдельный запуск сборки и публикации вручную.
   — Ручная сборка теперь создаёт проверенный self-contained JSON-пакет файлов.
   `planRelease` формирует object keys и metadata для будущего uploader;
   сетевой executor отсутствует. Загрузка и активация остаются невыполненными.
3. Подготовить настройки маршрутов, кеширования и HTTPS.
   — Локальный HTTP adapter повторяет проверенный Vercel routing-контракт:
   files first, missing JS → recovery, other missing assets → 404,
   остальное → index.html без redirect. Добавлены GET/HEAD, ETag, MIME и cache.
   Некорректные/скрытые пути отклоняются, mutation получает 405.
   HTTPS и облачный adapter остаются невыполненными.
4. Подготовить проверку новой версии и откат.
   — До запуска проверяются hashes, size, release identity и routing.
   Identity включает commit и полный SHA-256 пакета: разные build env одного
   коммита не получают один object prefix. Пакет содержит байты вместе с
   metadata, поэтому после проверки нет чтения изменившегося dist на запросе.
   При выборе активного пакета можно сохранить immutable assets прошлых
   пакетов; конфликт одного immutable URL с разными байтами блокирует запуск.
   Локально проверен выбор A→B и B→A, но атомарное облачное переключение,
   concurrent deploy, retention и cache invalidation ещё не реализованы.
5. Подготовить инструкцию будущего переключения домена, OAuth и CORS.
   — Гейты #1181 остаются; бюджета и согласования домена недостаточно для
   автоматического создания платных ресурсов или переключения пользователей.

## Проверка

```sh
npm run frontend:hosting:test
node scripts/frontend-release.mjs dist <full-commit-sha> /tmp/frontend-release.json
node scripts/frontend-rehearsal-server.mjs /tmp/frontend-release.json
```

CLI не перезаписывает существующий пакет. Собирать только с локальной
конфигурацией, как существующий rehearsal workflow. Сервер слушает случайный
порт только на `127.0.0.1`, не имеет cloud credentials и не пишет request URL
или query в логи. Не передавать реальные OAuth-коды при локальной проверке.
JSON содержит публичные bytes сайта в base64, это не шифрование и не secret
scanner. Hash доказывает целостность, но не доверенное происхождение.

Для проверки предыдущих assets передать дополнительные пакеты после активного:

```sh
node scripts/frontend-rehearsal-server.mjs /tmp/new-release.json /tmp/old-release.json
node scripts/frontend-rehearsal-server.mjs /tmp/old-release.json /tmp/new-release.json
```

Сервер держит проверенные файлы в памяти; это намеренно локальный стенд,
не рекомендация по production memory sizing или Cloud Functions deployment.
Query не влияет на выбор файла и не перенаправляется; fragment вообще не
передаётся браузером на HTTP-сервер. Реальная OAuth-авторизация, browser storage,
push-подписки и браузерный старый-tab сценарий этим тестом не доказываются.

| Контракт | Доказательство |
| --- | --- |
| `/trainer`, `/client`, callback, invite, legacy join | HTTP test: 200 HTML, no redirect |
| static GET/HEAD/304, SW и manifest | HTTP test: MIME, ETag, cache, empty HEAD body |
| Missing JS / CSS / image | HTTP test: recovery no-store / 404 |
| Повреждённый пакет / неизвестный routing | fail-closed до запуска сервера |
| Новая версия и локальный rollback | active HTML/SW + оба поколения assets |
| Нет cloud write | workflow без secrets/OIDC/upload/apply, deployable false |

## Следующий отдельный шаг

Локально 2026-09-26: `npm run check` прошёл; 17 hosting tests и 11 CI contract
tests зелёные. Настоящая сборка упакована с проверкой 184 файлов; HTTP smoke
подтвердил HTML 200 на client/trainer/callback/invite, JS recovery 200 no-store,
missing CSS 404 и SW no-cache. Remote smoke и browser OAuth не выполнялись.

Выбрать Yandex adapter, способ HTTPS и посчитать стоимость под подтверждённый
бюджет; затем связать его с object-key/HTTP контрактом и добавить uploader с
проверкой remote bytes до activation. Cloud-проверка и переключение требуют
отдельного разрешения. PRODUCT_WIKI не меняется: продуктового изменения нет.
