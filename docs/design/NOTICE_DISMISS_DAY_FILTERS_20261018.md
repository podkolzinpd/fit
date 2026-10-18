# Закрытие объявления и чистый «День» — 18.10.2026

Решение владельца: одно закрытие крестиком скрывает текущее объявление после повторного открытия приложения; новое объявление получает новый campaign ID. Фильтров на «Дне» нет, самостоятельные занятия и client/status остаются только в «Расписании».

## План и границы
1. Заменить sessionStorage служебной плашки на постоянное localStorage по аккаунту и стабильному ID объявления. Смена сборки/текста сама по себе не создаёт новую кампанию. Обычное закрытие не меняет другие аккаунты и будущие объявления. Очистка данных/другой браузер — новое локальное хранилище; межустройственная синхронизация не добавляется.
2. Убрать панель фильтров с Day. Игнорировать client/status и сохранённый independent toggle при построении Day: показываются обычные тренерские занятия без дополнительной пользовательской фильтрации. Schedule сохраняет свои фильтры; переход в Day не переносит их, Back восстанавливает исходный Schedule URL. Существующая подсказка Day привязана к рабочей сводке и больше не советует искать фильтры на главной.
3. Переиспользовать ServiceNotice/CloseIcon, существующие localStorage/account conventions, TrainerScheduleV2, Coachmark, Page, semantic tokens и текущую primary «Новая тренировка». Новые primitives/CSS/palette не нужны. API/БД/LLM/SpeechKit/клиентские тренировки/rollout cohorts не меняются.
4. Расширить существующие unit и browser acceptance вместо дублирующих матриц: закрытие/reload/account/newcampaign; Schedule→Day→Back, stale query parameters и independent preference. Проверить WebKit/Chromium,390/430/1440,light/dark, реальный маршрут и отсутствие overflow.
5. Обязательный check/CI, обычная очередь PR, merge, Cloud.ru frontend release и public readback; обновить затронутый native bundle штатным способом. Старое разрешение на внеочередной email-выпуск не переносится на эту задачу.

Источник UI: текущие Day/Schedule, скриншот владельца и существующий AppLayout. Состояния загрузки/ошибки/retry данных расписания сохраняются; блокировка localStorage не ломает закрытие в текущем монтировании, но не обещает сохранение после reload.

## Preflight и доказательства
База реализации: main26f59eefd7ad4d3eac0c82181db16a740d8821da. Реальный исходный экран дан владельцем; поведение проверено существующими тестами маршрутов и актуальным кодом.

| Статус | Контракт и доказательство |
|---|---|
| Уже работает | Крестик/44px, исключение Live/chat — ServiceNotice/AppLayout; Schedule сохраняет independent toggle по аккаунту |
| Переиспользуем | CloseIcon, localStorage account convention, существующие Day/Schedule/Coachmark и семантические стили |
| Меняем | session-only close→account+campaign persistence; Day перестаёт читать/показывать фильтры и передавать их в ссылках |
| Проверено локально | AppLayout/preference71 unit, existing route34 browser + notice6, WebKit/Chromium390/430/1440; synthetic accounts, no production data |
| Не проверено на этой стадии | Физический iPhone и межустройственная синхронизация; последняя не входит в scope |

Browser evidence: /private/tmp/fit-notice-browser-results и /private/tmp/fit-notice-banner-results. Частный notice harness сохранён в /private/tmp/fit-notice-verification, в продуктовый diff не включён. Первые browser failures были конфигурацией dev server и неверным ожидаемым числом в fixture (два существующих занятия тренера); runtime не подгонялся под эти сбои. Frozen CI inventory hash не меняется; изменённые specs требуют full browser acceptance.
