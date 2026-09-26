# Frontend: изолированная облачная проверка

Поток: assistant-ops. База: `e33ba9f0`, после #1181 и #1190.
Ветка: `codex/yandex-frontend-gateway`.

Подтверждённый scope: отдельный frontend-бакет и API Gateway в существующем
облаке пользователя; технический HTTPS-адрес без изменения Vercel, DNS,
backend и production routing. Домен будет предоставлен позже. Пользователь
снял прежний жёсткий предел 600 ₽/месяц; это не разрешение на неограниченные
расходы. Начинаем с нескольких синтетических файлов и одиночных HTTP-запросов.

## Приёмка

1. Отдельный закрытый бакет с версионированием и ограничением размера.
2. Отдельный API Gateway с техническим HTTPS-адресом.
3. Проверка SPA fallback, missing JS recovery и 404 для остальных assets.
4. Проверка чтения через отдельный аккаунт только нового бакета, MIME,
   Cache-Control, HEAD и условного GET. Не выдавать права на весь каталог.
5. Зафиксировать фактические результаты; не объявлять production-перенос
   выполненным по синтетическому тесту.

## Проверенные ресурсы 26 сентября 2026

- Каталог: `b1goqho12tlk9dibc3f3` (`fit-stage`).
- Gateway: `fit-frontend-routing-probe`, ID `d5drmhq5ovqk03jgsm8i`.
- HTTPS: `https://d5drmhq5ovqk03jgsm8i.wnq2w1o5.apigw.yandexcloud.net`.
- Бакет: `fit-frontend-probe-b1goqho1`, private, versioning, предел 1 ГБ.
- Созданы через консоль отдельно от production Terraform state. Не запускать
  существующий Terraform root поверх этих ресурсов без явного import/plan.
- Gateway использует `storage-probe.yaml` и три синтетических объекта; нет доступа к
  VPC, API, БД, Lockbox, OAuth или объектам рабочего media-бакета.

Облачный GET smoke подтвердил: `/` → 200 text/plain, `/trainer` → 200
text/html, `/assets/missing.js` и `/assets/nested/missing.js` → 200
application/javascript, `/assets/missing.css` → 404 text/plain. Все ответы
с `Cache-Control: no-store`. Таким образом, конкретный шаблон
`/assets/{file+}.js` работает, включая вложенные пути; это проверено запросами,
а не выведено только из документации.

## Object Storage smoke и кеширование

После отдельного согласования reader получил `storage.viewer` только на этот
бакет; без базовой IAM-роли одной bucket policy было недостаточно (403).
Политика reader разрешает GetObject. Ключи и роли каталога не создавались.
Консольная policy содержит отдельно согласованное правило AWS service и
PutObject текущему владельцу только для трёх тестовых объектов.

На `index.html`, `asset-recovery.js`, `not-found.txt` установлены системные
metadata `Cache-Control: no-store` и соответствующие MIME с UTF-8 через
`yc storage s3api copy-object --metadata-directive REPLACE`. Содержимое не
изменялось. Это не immutable assets и не реальный release приложения.

Финальный cloud smoke: GET и HEAD для `/`, `/trainer`, missing JS (включая
вложенный путь) и missing CSS — 10 проверок. Статусы 200/404, no-store и
точные байты fixtures подтверждены; HEAD без тела. Прямой анонимный запрос
к index.html в Object Storage возвращает 403.

Gateway передаёт Last-Modified, но не ETag. Проверенные If-Modified-Since и
If-None-Match (с ETag объекта из copy-object) возвращают 200 с полным телом,
не 304. Поэтому parity условного GET с локальным стендом НЕ достигнута.
No-store защищает HTML и recovery от сохранения; поддержку 304 нельзя
считать готовой или имитировать статическим ETag в спецификации.

## Пока не проверено

Immutable cache на существующих hash-assets, загрузка реального release, атомарная активация/откат,
browser OAuth, CORS, service worker и текущие пользовательские сессии.
Синтетический `routing-probe.yaml` не является production-конфигурацией.
Тестовый gateway пишет штатные логи; не отправлять в него реальные OAuth-коды
или персональные данные.

Tracker: попытка найти связанный YAFIT через доступный CLI не удалась:
нет настроенной авторизации, MCP-коннектора Tracker в сессии нет. Тикет не создан.

## Следующий гейт

Проверить immutable assets и решить, нужен ли 304 как обязательный контракт
выбранного cloud adapter. Бакет остаётся закрытым; backend identity не используется.
До cloud smoke не включать автоматический deployment реальной сборки и не
изменять `deployable: false` у offline release package.

## Подготовка настоящей сборки

`scripts/frontend-gateway-plan.mjs` компилирует проверенный release package
в candidate OpenAPI и точный список объектов `releases/<identity>/...`.
Каждый существующий файл получает отдельный маршрут, entrypoints относятся
только к активной версии. Сохраняются immutable assets переданных прошлых
версий; конфликт URL с разными байтами блокирует генерацию. Обратная генерация
со старой активной версией готовит конфигурацию отката. Изменяемые файлы имеют
no-store, immutable — годовой cache. Генератор ничего не загружает и не
активирует; deployable остаётся false.

18 локальных hosting tests проверяют также forward/rollback candidate.
Облачное применение полной спецификации, лимиты числа маршрутов и приоритет
точных файлов над fallback пока не проверены. Локальная проверка invalid paths
не доказывает аналогичное поведение Gateway.

Проверен список GitHub variables/secrets без чтения значений: отдельной
public build-конфигурации frontend пока нет. Текущий prepare workflow собирает
localhost rehearsal; публиковать его как работающее приложение запрещено.
Следующий этап требует release-prefix upload, review публичной конфигурации
и нового origin для OAuth/CORS; старые origin и Vercel сохраняются.

Владелец подтвердил единым scope release-prefix upload, изменение тестового
gateway, отдельную сборку из public VITE config и добавление origin в OAuth/CORS
без удаления Vercel/старых origin и без доступа к БД.

**Блокер полного release:** реальная локальная сборка из 184 файлов содержит
`assets/whisper-node-D3lYZyw6.wasm` (4 034 890 байт) и
`assets/whisper-node.threads-mC7Jd1_k.wasm` (4 223 519 байт).
[Документированный предел ответа API Gateway](https://yandex.cloud/ru/docs/api-gateway/concepts/limits)
— 2,5 МБ, спецификации — 3,5 МБ. Генератор отклоняет файлы свыше 2,4 МБ
и спецификации свыше 3,4 МБ с запасом под overhead. Полный release не загружен
и не активирован. Нужен пересмотр serving больших файлов (например, отдельный
Object Storage/CDN origin) с проверкой WASM/CORS/cache, либо другой frontend
hosting adapter. Удалять WASM или менять продуктовый voice flow ради лимита нельзя.

## Подготовленный вариант без CDN

При явном `FIT_FRONTEND_ORIGIN=https://<frontend-host>` генератор допускает
крупные immutable WASM: точный GET/HEAD маршрут отвечает 307 no-store на
версионированный объект `https://storage.yandexcloud.net/<bucket>/releases/...`.
JS, HTML, SW и остальные файлы остаются за приватной интеграцией Gateway.
Крупный JS или изменяемый файл по-прежнему блокирует генерацию: их нельзя
молча перенести на другой origin (worker/module semantics могут отличаться).

План перечисляет точные `publicReadObjects` и CORS только для frontend origin,
GET/HEAD. При применении нужны READ ACL только этих объектов; публичные флаги
бакета и листинг не включать. ACL/CORS ещё не применены. Политики бакета и
объектов должны быть проверены реальными анонимными запросами до activation.
В WASM нет пользовательских данных; review артефакта всё равно обязателен.
Публичные versioned WASM сохраняются вместе с retained releases для отката.

Локально: 19 hosting tests зелёные. Полная сборка из 184 файлов проходит
генератор с двумя public WASM, без изменения Vite base и продуктового voice flow.
Это проверка плана, не сети: browser fetch/instantiateStreaming, CORS,
Content-Type application/wasm, размер/хеш и приватность остальных объектов
должны быть проверены на облаке. Публикация всё ещё не выполнена.
