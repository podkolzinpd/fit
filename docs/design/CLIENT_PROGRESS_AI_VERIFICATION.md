# Проверка ИИ при пересборке Client Home / Progress

Владелец явно потребовал сохранить качество ИИ в автономно утверждённом плане Home/Progress. Изменения карты не меняют prompt, parser, API или историю пользователей.

Контролируемый workflow `34288992611` на `main` `178094d` проверил реальный разбор «Тестовая тяга Yandex stage, 42,5 килограмма, 10 повторений»: ожидаемые exerciseRef, вес и повторы приняты. Генерация сводки не началась: HTTP 400 `invalid_request`.

Причина — тестовый запрос workflow использовал `clientId/periodStart/periodEnd`, а `readAssistantProgressRequest` и действующий endpoint принимают `client_id/period_start/period_end`. Исправляются только три имени в синтетическом запросе. Регрессионный тест извлекает этот запрос из workflow и передаёт реальному API parser. Production API, модель, RLS, fixture и пользовательские данные не меняются.

После зелёного CI и merge нужен повтор штатного `smoke-yandex-stage-ai.yml` с `RUN_PAID_AI_SMOKE`. Это два ограниченных платных сценария в synthetic fixture с краткоживущей сессией. Успех парсинга не означает успешную генерацию сводки; полную live-проверку нельзя считать завершённой до повторного прогона. Ответы и session tokens не публикуются как артефакты.

Локально полный npm run check прошёл: 1262 frontend / 364 API / 112 infra, lint/typecheck/build; тест workflow действительно использует API parser.
