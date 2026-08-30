# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-30
Проверенный базовый `main`: `34dbaac` (`Refine Progress visual hierarchy (#685)`)

## Текущий release gate

- Foundation UI Identity v1 принята. Задачи 8–28 — клиентский, тренерский,
  полный auth scope, Assistant, accessibility и visual release gate —
  завершены последовательно.
- Foundation UI Identity v1 становится единственным production UI: runtime-
  режимы `on / preview / off`, персональный preview, dark pilot и route-level
  old/new branches удалены в retirement-ветке.
- Историческая `public.user_feature_flags` больше не читается приложением и
  закрыта для frontend-ролей. Физический drop выполняется отдельным ручным
  destructive-окном согласно migration policy репозитория.
- Ручной видимый production smoke остаётся follow-up: встроенный браузер
  заблокирован admin-enforced policy; контроль не обходился.

## Последняя проверенная продуктовая точка

- Главные страницы обеих ролей сохраняют voice-first действие и ввод текстом;
  Client Home показывает ближайшее назначение, состоявшуюся неделю и максимум
  один вторичный акцент. Live разделяет нейтральный таймер и активный отдых.
- Создание, Live и завершение прошлого плана сохраняют прежнюю логику без
  дубликатов. Yandex stage поддерживает non-Live lifecycle, cancel/reschedule,
  комментарий и author-scoped soft-delete с optimistic/tenant checks.
- Единый мобильный viewport-контракт восстанавливает полную высоту Trainer,
  Client и авторизации после закрытия клавиатуры даже при resize WebKit.
  Создание тренировки — каталог «Силовая»/«Бег», недавние упражнения, фильтры.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, интервальный
  бег и связки; неоднозначность открывает проверку. Сохранённые тренировки —
  компактная хроника с копированием и удалением в меню.
- ИИ-сводка и production-разбор — через Yandex Cloud Functions, локальный разбор
  — в Supabase. Tracker sync `app_feedback` остановлен; команда читает через
  `analytics.app_feedback` и Telegram (`notify-app-feedback-telegram`).
- Assistant trainer-only защищён `TrainerOnly`; durable turns/actions и narrow
  RPC сохраняют owner/RLS. Новые turn'ы создают workout draft, прежние карточки
  остаются читаемыми; исходная диктовка сохраняется при уточнении клиента.
- PWA, беговой MVP, локальный каталог и Web Push `workout_reminder` работают;
  transport secrets синхронизируются из Yandex Lockbox без вывода в repo/CI.
- Client и Trainer Progress используют одну короткую историю подтверждённого
  периода: лучший результат, тренировки, `X/Y` недель, улучшенные упражнения,
  карта тела, сравнение с периодом, связь с целью и ближайший план. Тренер видит
  plan/fact, внутренние сигналы, редактор и статус публикации; выполнение плана
  не выдаётся за прогресс к цели.
- Карточка спортсмена у тренера — один нейтральный вход в планирование,
  равноправные переходы в историю/прогресс, действие «Добавить этапы». Выбор
  фигуры/схемы — настройка аккаунта тренера, не смешивается с выбором клиента.
- Расписание показывает месяц, неделю, события и планы без времени; Assistant
  сохраняет тренировку только после подтверждения черновика.
- Клиент может безопасно отключить текущего тренера в профиле: серверная
  операция атомарна, повтор идемпотентен, самостоятельная история, назначения,
  замеры и цели сохраняются. Серверное переподключение после явного отключения
  использует тот же атомарный merge и не допускает двух активных тренеров.

## Инфраструктура и Yandex Cloud

- Локальная разработка и проверки используют только Podman. Docker не нужен.
- Stage содержит Managed PostgreSQL 17 и Serverless Containers. Миграции
  доставляются автоматически через GitHub OIDC, private runner и forward-only
  policy; `fit_api` не имеет прямых INSERT/UPDATE/DELETE grants на domain tables.
- Ограниченный Yandex ID pilot, clients, memberships, invitations, custom
  exercises и workout lifecycle работают на stage (`000001–000020`); revision
  `796f958` прошёл migrations, runtime preflight и read/write smoke.
- Native AI использует metadata IAM token без статического ключа; точную роль
  один раз выдаёт `fit-stage-api` администратор, а OIDC не меняет folder IAM.
- Yandex OAuth использует PKCE и публичный Client ID. OAuth Client secret не
  нужен browser-контракту; Supabase-сессия при пилотном входе не создаётся.
- Стабильный branch-scoped Vercel Preview синхронизируется с каждым verified
  `main` без force-push; callback URL и CORS origin не меняются. Все остальные
  ветки исключены из Vercel Git deployments.
- Callback показывает pilot profile, clients, connections и training data, но
  pilot UI read-only. Client/custom-exercise и Planned/Live writes — только
  через stage API, production routing не затрагивают.
- Реальный invite → join → leave/remove smoke на двух Yandex ID — внешняя
  stage-проверка; локальный lifecycle и RLS-матрица зелёные. Production остаётся
  на Supabase; полный cutover не выполнен.

## Проверки активной ветки

- Self-service цели прошёл owner/linked-trainer/cross-tenant проверки:
  клиент управляет своей целью, а прямые записи и посторонний тренер запрещены.
- YAFIT-414 / Progress 1.1 добавил ручной `weight/waist/chest/hips` критерий
  и явные состояния без интерпретации старых целей по тексту; динамика и LLM отложены.
- Progress 1.2: deterministic-оценка `weight/waist/chest/hips` поддерживает все
  пять operations, стабильный baseline для `change_by`, текущее положение,
  динамику выбранного периода, значение на конец периода, достаточность и
  freshness. Удержание требует минимум 2 замера за 7+ дней.
- Progress 1.3: одна цель поддерживает до 10 независимо рассчитываемых
  критериев — рабочий вес, повторы, объём, лучший результат, дистанцию,
  темп, регулярность и пользовательские показатели. Карточка показывает факты
  и `X/Y`; LLM лишь предлагает настройку, расчёт остаётся deterministic.
- Первый этап нового визуального порядка Progress убрал общую внешнюю карточку:
  период, результат и остальные смысловые секции стали самостоятельными
  поверхностями. В составной цели сразу виден только основной критерий, а
  остальные раскрываются действием пользователя; расчёты и права не менялись.
- Tasks 25–28: auth/Assistant, WCAG AA, 44 px targets, reduced motion,
  app/API, Chromium/WebKit и Linux/Darwin visual matrix 390/430/1440 зелёные.
- Post-Progress UI cleanup мигрировал branding/system states, shared overlays,
  typography/icons и экранные хвосты, затем удалил только подтверждённый dead
  CSS. Классификация A/B/C/D зафиксирована в
  `docs/design/UI_IDENTITY_LEGACY_CLEANUP_2026-08-30.md`.
- Retirement regression: полный `npm run check` прошёл (908 app, 64 infra и
  230 API tests), visual на clean seed прошёл без перезаписи эталонов:
  390 — 30/30, 430 — 30/30, desktop — 17/17 применимых сценариев.
- Production Vercel `6158408571` и Yandex stage preview sync `33263066435`
  зелёные; для локального visual smoke используется standard Playwright runtime.

## Ближайший порядок

1. Отдельно согласовать ручное удаление исторической feature-flag таблицы после
   проверки внешних consumers.
2. Выполнить короткий production visual smoke под Client и Trainer test accounts
   после merge/deploy retirement.

## Отложено

- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены. `YAFIT-245` не начинать без решения; `YAFIT-234` отложен; `YAFIT-235` — Webvisor.
- Новые виды спорта, питание, social/wearables и ИИ-блоки — после P0/P1 и пилота.
