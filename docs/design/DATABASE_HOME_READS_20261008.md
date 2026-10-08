# Компактные чтения главной и активной тренировки

## Запрос владельца

«Главная и поиск активной тренировки ещё загружают полную историю с упражнениями
и подходами. Пагинация ограничила отдельный ответ, но эти потребители собирают
все страницы. Нужны отдельные компактные чтения для активной тренировки и
сводки — без усечения доступной пользователю истории».

Поток: data-media. Базовый main: aa7362a8. Очередь: ранний активный PR1521.
Новые migrations, Supabase schema, IAM, rollout flags и ручной production apply
не нужны: чтение существующих таблиц под actor RLS.

## Этап 1 — активная тренировка и тренерская главная

1. `findActive` получает только один активный root, фильтрация до LIMIT.
2. Тренерская главная (Mono и Lime), очереди и выбор быстрого старта получают
   компактные representative roots. Все active и today plans сохраняются;
   для каждого клиента — existence, latest done/past plan, nearest future plan.
   Timed/untimed кандидаты сохраняются отдельно для прежних контекстных сортировок
   Mono/Lime; это ограниченное число roots на клиента, не страницы истории.
   Ответ не содержит упражнений/подходов; только точный exercise count и первые
   два названия для прежнего контекста Mono.
3. Права, локальная дата/timezone, loading/empty/error/retry, навигация и
   invalidation после изменения тренировки сохраняются.
4. История, detail, Progress и экспорт не ограничиваются и не подменяются home DTO.

Референсы — реальные `/today`, `/today?classic=1` и существующий
`role-home-visual-trainer-1440.png`/trainer-today baselines. Переиспользуются
Page, InlineRequestError, QuickStartWorkout, TrainerActiveWorkouts и прежние
queue sheets; CSS/icons/tokens не меняются. Primary и voice/text entry прежние.

## Этап 2 — клиентская главная

Она использует полную историю для ачивок, сравнения рекордов и карты нагрузки,
а Today дополнительно читает историю для recent exercise picker только при
его открытии. Нельзя заменить
её последними N тренировками или фальшивыми Workout с пустыми sets. Требуется
отдельный контракт сводки с паритетом этих расчётов. До его проверки текущие
клиентские данные остаются прежними; этап 1 не объявляется полной оптимизацией
всей клиентской главной. Предложение о разделении на два PR отправлено владельцу.

## Проверка этапа 1

- SQL: >100 исторических roots, старая active, несколько клиентов/active,
  today/future/past/cancelled/deleted, все representative roots без sets.
- Actor/RLS: клиент, автор, другой trainer, outsider; чужой client не = empty.
- API: auth/ambiguous/expired, validation, no-store, safe failure и retry.
- Repository: одиночные endpoints без history pagination/fallback; полная history
  по-прежнему собирает все страницы.
- Home: существующие action/planning/context правила и версии обоих дизайнов;
  WebKit на 390/430/1440, loading/error/retry/empty и переход к active/detail.
- `npm run check`, PostgreSQL17 actor tests и `npm run local:verify` (общие базы
  не сбрасываются при прежнем drift).

Локально: чистая цепочка PostgreSQL17 и actor/RLS134/134, API252/252,
targeted repository/queue/context/quick-start76/76, summary/realtime11/11,
WebKit10/10 на390/430/1440 (Mono/Lime, >100 history, old active, error/retry/empty).
Дополнительно iPhone13/WebKit1/1: коды диагностики home/metadata сохранились.
Полный `npm run check` прошёл: lint/typecheck/coverage/policies/API/build.
Локальных licensed Lime-fonts нет (0/2); визуальная проверка без изменения стилей
сравнивает тот же fallback, а CI должен проверить сборку со штатными fonts.
`local:verify` остановился до Yandex на прежнем legacy drift20260919145000;
общие базы не сбрасывались. SQL проверен в отдельном локальном Podman PG17.
Статус: локальная проверка выполнена; CI/production не подтверждены.
Без решения владельца о разделении этапов PR остаётся draft,
merge не выполняется: это не полное закрытие исходного запроса.
