# Удаление frontend transport к закрытым AI API

База mainab412091, ветка codex/remove-legacy-ai-transport, поток assistant-ops.
Ранее открыты #1736 и #1738; их изменения не входят в задачу.

## Подтверждённая постановка

Давай уберём frontend transport к удалённым AI API. Native AI, Cloud Functions и media transport не трогаем. Дождись зелёного CI.

## Проверка существующего

| Уже работает | Переиспользуем/сохраняем | Действительно меняем | Приёмка |
| --- | --- | --- | --- |
| Native summary и diagnostics | Текущие app-session запросы | Ничего | Source parity и native success/error tests |
| Cloud Functions | Прямой вызов без override и все серверные исходники | Ничего | Source parity и request test |
| Media bridge | Общая проверка legacy API origin | Только путь импорта helper | Source parity и media tests |
| Удалённые серверные AI API | Больше не обслуживаются после #1737 | Удаление frontend bridge/orphan assistant-progress | No-network retirement tests |

## Неизменяемая приёмка

1. Удалены invokeAssistantProgressSummary и invokeLegacyCloudFunction, их orphan
   modules и только устаревшие тесты. Frontend не отправляет запросы к трём API.
2. Валидный explicit legacy override закрывает AI generation локально, без HTTP,
   token refresh или нового Cloud Function fallback. Native имеет прежний приоритет.
3. Legacy diagnostics возвращает явную ошибку без сети; signature сохранена для
   существующего компонента. Native diagnostics и runtime UI не меняются.
4. Media helper вынесен побайтно; media transport отличается только import path.
   Прямой Cloud Function-путь и native generation сохранены побайтно.
5. Полный npm run check и весь CI зелёные до передачи PR. Production не меняется.

## Проверки

- Targeted 6 files /35 tests: native success/error со stale override (2 cases),
  closed override без HTTP (1), прежний прямой Cloud Function (1), media bridge,
  native/closed legacy diagnostics и существующий summary repository.
- Старые bridge success/retry tests удалены вместе с закрытым transport;
  retirement заменён no-network проверками, native/media contracts сохранены.
- UI/темы/размеры не параметризуются: runtime компоненты не менялись.
- Full npm run check exit0: lint/typecheck/frontend2779/API1451+184conditional
  DBskip/infra332/calendar12/hosting173/build/startup. CI ожидается в PR.
- Source parity: native generation/direct CF/helper совпадают побайтно; media
  transport отличается только import path.
- Timing before/after
  удаления старых тестов не замерен. БД/Cloud Functions/prompts/rollout вне scope.
