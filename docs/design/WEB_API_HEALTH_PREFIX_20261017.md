# Проверка соединения веб-версии через /api/health

## Подтверждённое состояние до изменения

17.10.2026, main fb7926f9, опубликованный client Lime Live /workouts/:id/live,
WebKit390, изолированные синтетические ответы API. После ввода и нажатия
«Готово» появляется «Сохраняем…»: POST ещё не отправлен, preflight запрашивает
/health. Публичный GET /health возвращает200 text/html без x-fit-request-id;
/api/health возвращает200 с runtime-заголовком. Код healthEndpoint не менялся
между f92d4b12 и fb7926f9. Это соседний существующий дефект, отдельный от PR1677.

Уточнение: реальные API-ответы с x-fit-request-id поддерживают freshness45s,
поэтому дефект проявляется при истёкшей/отсутствующей отметке доступности либо
восстановлении чтения, а не доказывает отказ каждой записи у каждого пользователя.
Реальные пользовательские записи не изменялись.

## Уже работает → переиспользуем → меняем → ограничения

- Уже работает: /api/health, прямой API-host /health, runtime-header guard,
  общий preflight, лимит10s, freshness45s, отмена, безопасный retry.
- Переиспользуем: src/data/queries/request-diagnostics.ts и существующие tests
  yandex-main.queries.test.ts; не создаём новый транспорт/проверку доступности.
- Меняем только healthEndpoint: продуктовый путь /api/... проверяет
  /api/health; прямой API-origin по-прежнему /health. Query/hash удаляются.
- Не проверено: реальные записи клиентов/тренеров и физический iPhone.
  Приёмка опубликованного JS использует page-scoped synthetic API.

## План и приёмка

1. Покрыть строковый URL и Request для proxy-prefix, воспроизвести red test.
2. Сохранить prefix /api при вычислении health endpoint. Прежний guard
   x-fit-request-id, таймауты, freshness, payload, отмена и запрет повтора
   пользовательской записи остаются прежними. HTML200 не признаётся runtime.
3. Проверить targeted transport tests, опубликованный/локальный Live обеих
   ролей с полностью изолированным API, полный npm run check и exact-head CI.
4. Выпустить отдельным PR после1677; main CI, штатная публикация, все файлы
   frontend по hash, DNS/TLS/API health; public WebKit Live без подмены /health.
5. Собрать, установить и запустить новый native main. Сверить прежний прямой
   health origin и изменения1677. Закрыть отдельный тикет и YAFIT-617 по факту.

Поток identity-runtime. API/БД/права/данные/таймеры/LLM/SpeechKit/rollout,
production variables и Nginx-конфигурация не меняются. Общий транспорт затрагивает
клиента и тренера; прямой API/native путь должен остаться прежним.

## Результаты до PR

YAFIT-618. Два proxy-prefix случая сначала failed с mutation_preflight_failed,
после исправления31 transport tests passed. Полный npm run check exit0:
2718frontend/1426API+160standard DBskips, infra318/hosting169/build.
Production-config preview WebKit2/2: client Live (ввод, факт, правка, перенос,
reload) и trainer confirm. Реальные API-запросы заблокированы, page-scoped mocks
сохраняют /api prefix; /health не подменялся успешным ответом.
Приёмка требует именно /api/health и запрещает запрос корневого /health.
Нет новых E2E-матриц/CI-cases; два unit покрывают URL/Request.
