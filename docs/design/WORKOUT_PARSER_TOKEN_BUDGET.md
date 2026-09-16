# Workout parser: ограничение платных вызовов

Статус: реализация.

## Зафиксированный план

1. Local parse first; if complete, return with 0 AI calls.
2. Send only unresolved lines to AI.
3. One user parse action => at most one model call; batch unresolved lines.
4. Remove automatic retry; surface local safe partial result and unresolved choices.
5. Reduce max output 2000 to around 1000–1200; avoid repeated output bloat.
6. Prevent duplicate same request while in-flight/same text.
7. Structured diagnostics local_only vs ai_fallback and exact counts/usage.
8. Tests mocked only, no real AI/token calls: exact local 0; 10 exact circuit 0; one or many unresolved max 1; invalid response no retry; no full catalog in prompt.

## Ожидаемый результат

- Однозначная запись тренировки не обращается к модели и не расходует токены.
- Все спорные строки одного пользовательского действия уходят одним компактным
  запросом; уже разобранные строки в него не попадают.
- Один пользовательский разбор не может создать больше одного модельного
  вызова, включая ошибочный ответ модели.
- Одинаковые подходы возвращаются моделью компактно и разворачиваются сервером
  после ответа.
- При недоступности модели пользователь сохраняет локально распознанные строки
  и получает ручной выбор для остатка.

## Проверка без расхода токенов

Все автоматические проверки используют внедрённые mock-ответы. Live AI smoke
для этой задачи не запускается. В production проверяются выпуск frontend и
функции, а не реальная генерация.
