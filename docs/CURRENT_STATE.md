# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-23
Проверенный базовый `main`: `c8cf33a` (`feat(yandex): add idempotent live workout core (#516)`)

## Активное изменение

- Ветка `codex/yandex-live-structure` переносит на Yandex stage структурные
  Live-действия существующего приложения: добавление упражнения и подхода,
  удаление подхода, замену упражнения, перестановку блока и комментарий.
- Команды доступны только через pilot API и короткоживущую Fit-сессию. Они не
  подключают production UI к Yandex Cloud и не меняют Supabase repositories.
- Каждая команда блокирует и версионирует workout root, сохраняет `updated_by`
  и использует `operationId`. Точный retry возвращает исходный version и UUID
  созданного/затронутого child; новая stale-операция получает conflict.
- Receipt хранит только внутренние UUID, действие, SHA-256 запроса и версию,
  удаляется через 30 дней и не читается runtime-ролью.
- Добавленный подход наследует последний план/факт. Последний подход удалить
  нельзя; замена упражнения после подтверждённого подхода запрещена; позиции
  после удаления и перестановки остаются непрерывными.
- Новый платный ресурс, секрет, IAM-роль или ручное применение stage migration
  не требуется. После merge существующий workflow применит `000011`, развернёт
  immutable API revision и выполнит structural smoke автоматически.

## Последняя проверенная продуктовая точка

- Главные страницы обеих ролей сохраняют voice-first действие и ввод текстом.
  Клиентская главная показывает ближайшее назначение, состоявшуюся неделю и не
  более одного вторичного акцента: ответ тренера, рекорд или цель.
- Создание тренировки использует единый ручной каталог направлений «Силовая» и
  «Бег», компактные фильтры, недавние упражнения и множественный выбор.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, разный порядок
  метрик, интервальный бег и явные связки. Неоднозначность открывает проверку, а
  не исправляется скрыто.
- Сохранённые тренировки используют компактную хронику упражнений с раскрытием
  подходов и отдельной кнопкой истории; копирование и удаление находятся в меню.
- Ручной беговой MVP, общая ИИ-сводка Progress и локальный public-domain каталог
  упражнений работают в production без внешнего медиасервиса.

## Инфраструктура и Yandex Cloud

- Локальная разработка и проверки используют только Podman. Docker не нужен.
- Stage содержит Managed PostgreSQL 17 и Serverless Containers. Миграции
  доставляются автоматически через GitHub OIDC, private runner и forward-only
  policy; `fit_api` не имеет прямых INSERT/UPDATE/DELETE grants на domain tables.
- Ограниченный Yandex ID pilot, clients, memberships, invitations, custom
  exercises и workout aggregate работают на stage. Миграции `000001–000010`,
  API revision и Live core автоматически доставлены workflow `32639680330`.
- Yandex OAuth использует PKCE и публичный Client ID. OAuth Client secret не
  нужен browser-контракту; Supabase-сессия при пилотном входе не создаётся.
- Стабильный branch-scoped Vercel Preview синхронизируется с каждым verified
  `main` без force-push; callback URL и CORS origin не меняются.
- Callback показывает pilot profile, clients, connections и training data, но
  workout UI остаётся read-only. Planned/Live writes пока проверяет только API
  smoke на синтетическом fixture без production или Supabase данных.
- Реальный invite → join → leave/remove smoke на двух разрешённых Yandex ID
  остаётся внешней stage-проверкой; локальный lifecycle и RLS-матрица зелёные.
- Полный cutover не выполнен. Production frontend и основной tenant продолжают
  использовать Supabase; Yandex stage не меняет остальные вкладки приложения.

## Проверки активной ветки

- API request/routes: 56 целевых unit-тестов зелёные; TypeScript зелёный.
- Полный quality gate зелёный: 654 frontend-теста с coverage, lint,
  TypeScript, DB types, iOS permissions, 34 infra policy tests, 94 API-теста
  и production build.
- PostgreSQL 17 migrations `000001–000011` чисто переиграны в существующем
  Podman-контейнере; 16/16 actor/RLS integration-тестов зелёные.
- Локальный Supabase reset и все 575 SQL/RLS-тестов зелёные.
- Stage workflow policy: 3/3 целевых теста зелёные; smoke включает replay structural
  commands, финальный порядок/комментарий/факт и stale finish conflict.

## Ближайший порядок

1. Завершить этот PR: документация, чистый DB replay, полный quality gate и CI.
2. Отдельно портировать feedback/reactions и вопросы/ответы после тренировки.
3. Отдельно портировать derived progress/chronicle reads.
4. После полного tenant-контракта провести две миграционные репетиции; только
   затем обсуждать первый sticky tenant cutover. Production пока на Supabase.

## Отложено

- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены.
- `YAFIT-245` не начинать без отдельного решения и описания рисков.
- `YAFIT-234` (SpeechKit relay) отложен; голосовой путь не менять.
- `YAFIT-235` — Webvisor сохранён для исследовательских метрик.
- Новые виды спорта, питание, социальные функции, внешние носимые устройства и
  дополнительные ИИ-блоки не брать до завершения P0/P1 и пилота.
