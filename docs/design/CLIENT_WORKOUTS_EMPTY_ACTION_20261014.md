# Мои тренировки: плюсик и типографика — 14.10.2026

Основание: два скриншота владельца. Плюсик в пустом «Актуальном» не работает,
«Добавить» работает; подписи двух переключателей имеют разные размеры.
База: main d10c2d12. Референс — существующий `/me/workouts`, Fit Lime.

## Приёмка

1. Плюсик пустого «Актуального» открывает `/me?entry=workout`, как «Добавить».
   Доступная ссылка «Добавить тренировку», зона 44×44, клавиатура и touch.
2. В клиентском Lime подписи «Актуальное / История / Готовые» и
   «Список / Календарь» имеют одинаковые 14 px / 500; высота 44 px,
   выбранные состояния и переключение сохранены.
3. Проверить реальный маршрут в WebKit на 390/430, light/dark, пустой список,
   историю и календарь, возврат из создания; Mono и тренер не меняются.
4. Полный check, зелёный CI, штатный merge и Cloud.ru frontend rollout/readback;
   после merge свежий iOS production bundle build/install/launch.

## Реализация и границы

Переиспользуются `EmptyState`/`StatePanel`, `Link`, `AddIcon`, существующие
классы `.state-panel-mark`, client Lime сегменты и `--type-body-size`.
У `EmptyState` добавляется необязательное действие вместо декоративного mark;
все остальные потребители сохраняют прежний mark. Primary — «Добавить»;
плюсик остаётся вторичным входом того же действия. Shared typography и
глобальные tokens не меняются. БД/API/LLM/SpeechKit/главная/флаги вне scope.
Coachmark не нужен: исправляется уже показанный вход и косметическая разница.

## Доказательства

Задача: YAFIT-609. Исходный WebKit-тест после правильной настройки fixture
воспроизвёл отсутствие доступного входа. Первый запуск не прошёл auth из-за
пропущенного fixture OAuth client id; продукт по нему не менялся.

1. Выполнено: `Link` вместо декоративного mark, tap/Enter и возврат в список.
2. Выполнено: обе группы 14 px/500/min44, выбранные состояния сохранены.
3. WebKit: новые4 + прежние list/calendar4 =8/8; loading/error/retry2/2;
   Mono430 и trainer1440 Lime/Mono3/3. Снимки просмотрены:
   [до](client-workouts-empty-action-20261014/before-dark-390.png),
   [после dark390](client-workouts-empty-action-20261014/after-dark-390.png),
   [после light430](client-workouts-empty-action-20261014/after-light-430.png).
   Unit shared UI19/19; Chromium4/4. Первый after-тест требовал URL без штатного draft
   query; затем ранний Back опередил replace draft. Приёмка теперь ждёт
   существующий draft параметр, assertions действий/геометрии сохранены.
4. Полный check завершён exit0: frontend2661/API1387+156standardDBskip;
   infra275/hosting137/build/fonts2/2 passed. CI/merge/Cloud.ru rollout/readback и свежая
   native-сборка ещё не выполнены; доказательства выпуска — в PR/Tracker.

Лицензированные YS Geo2/2 переиспользованы из подготовленной worktree;
lock-файлы совпадают, зависимости скопированы локально для Vite font serving.
Production data и настройки публикации не менялись. Изменённый visual spec
автоматически требует full Fit Lime CI; scope digest не обновляется.

Первый full check: frontend2661 passed, остановка в policy inventory на
620!=616. Guard обновлён строго до616+4 с отдельной проверкой четырёх новых
кейсов, полная union/disjoint проверка обоих engines7/7 прошла. Второй full
check запущен после исправления; ни один прежний тест не исключён.

Второй full check дошёл до API lint и показал отсутствующие типы Fastify: ранее
переиспользованный каталог API node_modules оказался пустым. Зависимости
восстановлены из worktree YAFIT-607 с совпадающим API lock; код API не менялся.
Третий полный check завершён exit0. Схема не меняется, local:verify не нужен.
