# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-24
Проверенный базовый `main`: `a27d1e0` (`fix: keep workout deployment usable after access bootstrap (#531)`)

## Активное изменение

- Ветка `codex/yandex-functions-safe-deploy` делает production-деплой двух
  Yandex Cloud Functions воспроизводимым после одноразового IAM bootstrap.
- `parse-workout` и `summarize-client-training` больше не меняют публичный
  invoker binding при каждом релизе. Перед публикацией запоминается предыдущая
  версия `$latest`, новая версия проверяется как `ACTIVE`, а публичный endpoint
  обязан вернуть `401` на запрос без пользовательского токена.
- Если metadata или authentication smoke не проходит, `$latest` возвращается
  на предыдущую активную версию и workflow остаётся красным. Первая версия без
  rollback target безопасно завершается ошибкой.
- Дополнительная роль production deploy service account не нужна: последний
  summary run создал secret-backed версию `ACTIVE` и упал только на повторном
  `add-access-binding`, а parser стал зелёным после удаления этой операции.
- Рекомендация поддержки про `functions.editor` относится к отдельному deployer
  stage Serverless Container, а не к production Functions. Расширять IAM
  production Functions на основании этого ответа нельзя.

## Последняя проверенная продуктовая точка

- Главные страницы обеих ролей сохраняют voice-first действие и ввод текстом.
  Клиентская главная показывает ближайшее назначение, состоявшуюся неделю и не
  более одного вторичного акцента: ответ тренера, рекорд или цель.
- Прошлый план можно завершить через предзаполненную форму факта без перехода в
  Live и без дубликата; отмена оставляет план неизменным. Тренер может сохранить
  завершённую тренировку на выбранную дату, включая будущую.
- Клиентский экран проверки сохраняет полную высоту после закрытия клавиатуры
  на iPhone. Создание тренировки использует каталог «Силовая» и «Бег», недавние
  упражнения, компактные фильтры и множественный выбор.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, разный порядок
  метрик, интервальный бег и явные связки. Неоднозначность открывает проверку, а
  не исправляется скрыто.
- Сохранённые тренировки используют компактную хронику упражнений с раскрытием
  подходов и отдельной кнопкой истории; копирование и удаление находятся в меню.
- Общая ИИ-сводка и production-разбор тренировки вызываются через Yandex Cloud
  Functions. Локальный разбор остаётся в локальном Supabase. Форма обратной связи
  сохраняет сообщения в `app_feedback`; канал уведомлений решается отдельно.
- PWA предлагает понятную установку на домашний экран. Ручной беговой MVP и
  локальный public-domain каталог упражнений работают без внешнего медиасервиса.

## Инфраструктура и Yandex Cloud

- Локальная разработка и проверки используют только Podman. Docker не нужен.
- Stage содержит Managed PostgreSQL 17 и Serverless Containers. Миграции
  доставляются автоматически через GitHub OIDC, private runner и forward-only
  policy; `fit_api` не имеет прямых INSERT/UPDATE/DELETE grants на domain tables.
- Ограниченный Yandex ID pilot, clients, memberships, invitations, custom
  exercises и workout aggregate работают на stage. Миграции `000001–000011`,
  API revision, Live core и структурные Live-команды доставлены автоматически.
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

- PR `#530` прошёл app, Supabase DB, Yandex PostgreSQL 17, E2E и Vercel checks;
  `parse-workout` endpoint возвращает ожидаемый `401` без токена.
- Последний stage delivery на `14d4ab9` зелёный; PostgreSQL, migration runner и
  API revision активны, ежедневные автоматические backup завершены успешно.
- Полный `npm run check` зелёный: 672 frontend-теста с coverage, lint,
  TypeScript, DB types, iOS permissions, 39 infra policy tests, 100 API-тестов
  (ещё 16 пропущены по штатным условиям), API build и production app build.

## Ближайший порядок

1. Слить безопасный smoke/rollback и убедиться, что оба production Functions
   workflow зелёные без изменения IAM.
2. Закрыть client/profile/custom-exercise mutations на Yandex API.
3. Отдельно портировать feedback/reactions и вопросы/ответы после тренировки.
4. Отдельно портировать progress/goals и derived progress/chronicle reads.
5. После полного tenant-контракта провести две миграционные репетиции; только
   затем обсуждать первый sticky tenant cutover. Production пока на Supabase.
6. Не начинать `YAFIT-350–354` до завершения внешней задачи по ИИ-составлению
   программ и нового решения владельца продукта.

## Отложено

- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены.
- `YAFIT-245` не начинать без отдельного решения и описания рисков.
- `YAFIT-234` (SpeechKit relay) отложен; голосовой путь не менять.
- `YAFIT-235` — Webvisor сохранён для исследовательских метрик.
- Новые виды спорта, питание, социальные функции, внешние носимые устройства и
  дополнительные ИИ-блоки не брать до завершения P0/P1 и пилота.
