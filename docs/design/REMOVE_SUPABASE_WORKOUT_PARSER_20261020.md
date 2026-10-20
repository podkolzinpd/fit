# Удаление неиспользуемого Supabase parser

База main979eda75. Ветка codex/remove-supabase-workout-parser. Поток assistant-ops.
Более ранние активные PR: #1742–#1747. Работа останавливается на зелёном PR;
production/deploy и мобильные сборки не меняются. YAFIT не создавался.

## Подтверждённая постановка

Давай удалим SupabaseWorkoutParser и yandex-legacy-functions.ts. Native AI, Cloud Functions и media не трогаем. Дождись зелёного CI.

## Проверка существующего

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native parser/goal criteria | YandexWorkoutParser, validation, prompts | Только удаление Supabase adapter и его orphan interface | Платный LLM-вызов |
| Cloud Functions | Текущие entry points и deploy workflows | Только orphan yandex-legacy-functions.ts | Развёрнутые ресурсы |
| Media | Весь transport/adapters | Ничего | Production-файлы |

Исходники main979eda75, версия production-сборки не устанавливалась. UI, роли,
темы, флаги и маршруты не меняются. Поиск runtime imports и workflow entrypoints
подтвердил отсутствие вызовов удаляемого wrapper. Реальный UI не проверялся:
пользовательское взаимодействие в scope не меняется.

## Неизменяемая приёмка

1. SupabaseWorkoutParser, orphan LegacyWorkoutParser interface и bridge import
   удалены. yandex-legacy-functions.ts удалён. Других ссылок в runtime нет.
2. YandexWorkoutParser, validation, matching, prompts и native handlers прежние.
3. Cloud Functions/entry points/deploy workflows и media без изменений.
4. Полный npm run check и весь CI зелёные до передачи PR.

## Проверки и соответствие тестов

- Удалены3 tests Supabase adapter: Supabase auth/catalog, rejected JWT и
  RLS-scoped goal sources. Это проверки удалённого adapter, новых replacement
  для Supabase auth не добавлено. Retired HTTP routes уже защищены API404 tests.
- Native maxTokens1200/отсутствие каталога в prompt сохранены в existing native
  IAM parser test; goal prompt assertion — в existing invented-source test.
  Нативный matching покрывает прежний extracted-workout.test.ts.
- Existing native AI import guard дополнен запретом Supabase HTTP bridge.
  На Vitest baseline guard уже проходил (не считается red→green доказательством).
- Targeted6files/20tests passed: parser/extraction, native AI/media imports,
  Cloud Function parser/summary. Новых cases и матриц нет; native assertions
  расширены без дублирования сценариев. Timings до/после не сравнивались.
- Exact source parity: все retained declarations включая YandexWorkoutParser
  совпадают побайтно. Compiled old parser импортирует HTTP bridge, новый — нет.
  Node imports native parser/pilot parser с blocked bridge/SDK2/2 passed.
- Full npm run check exit0: lint/typecheck/frontend2785/API1450+185conditional
  DBskip/infra332/calendar12/hosting173/build/startup. Полный CI ожидается в PR.
- Действующие Cloud Functions, workflows, media, server/app, БД и frontend
  совпадают с baseline. Production, paid LLM и resource readback не выполнялись.
