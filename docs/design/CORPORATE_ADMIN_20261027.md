# Этап 1: кабинет управления тренерами Яндекса

## Прямой запрос и acceptance
1. Простой отдельный кабинет администратора.
2. Справочник офисов: добавление, редактирование, архивация.
3. Отметка «Тренер Яндекса» и привязка к нескольким офисам.
4. Существующие механики тренера и спортсмена не меняются.
5. Проверить и дать ссылку и инструкцию входа.

## Проверка существующего
База main75162bb8. Рабочая production-сборка/реальный OAuth: НЕ ПРОВЕРЕНО.
Уже работает: Yandex app-session, две account_role trainer/client, маршруты
/auth, /profile/settings, /me/settings. Переиспользуем Protected, Page, Field,
AsyncView, StatePanel, SaveStatus и ui-identity токены настроек. Новая desktop
страница не наследует phone-frame и не меняет общие стили.
Нужно: отдельная capability, справочник, corporate-привязки, защищённые команды.

## Границы
Поток product, новая migration159 (158 занята независимым Staff PR1835).
Capability не является account_role; нет самоназначения, регистрации admin,
UI/API управления администраторами. Первый доступ — отдельной owner-операцией
к существующему profile id, точная учётка ещё не выбрана пользователем.
Нет изменений Staff, клиентов, связей с тренером, каталога, расписания,
тренировок, оплаты, AI или персональных пилотов. Только corporate metadata.

## Проверка
Реальная чистая PG17 цепочка + actor/RLS/grants, запрет самоповышения,
оптимистическая блокировка, архив и несколько офисов, неизменность бизнес-данных.
API auth/validation; UI CRUD, ошибки/повтор, отказ доступа, обе темы,
1366/1440 и390/430. Итоговый npm run check и CI/PR; rollout отдельно.

## Локальная приёмка
- Реальный baseline /profile/settings native app-session до изменений просмотрен.
- API validation/auth5/5, repository + existing profile settings13/13.
- Новый PG17 suite7/7: реальные app-session, admin и non-admin, RLS/grants,
  запрет самоповышения, CAS/replay, архив, несколько офисов, неизменность
  завершённой тренировки и её RLS, Down/Up новой migration159.
- Browser12/12 Chromium+WebKit: CRUD, ошибка/retry с сохранением формы,
  отказ роли trainer/client, обе темы,1366/1440 и390/430 без overflow.
  Просмотрены реальные screenshots ноутбука и мобильного интерфейса.
- Frontend320 suites/2865tests, coverage82.46/76.97/82.17/86.89.
- Root lint/typecheck, final feature/e2e lint/typecheck, API lint/typecheck,
  migration-policy и diff-check прошли. API/frontend build/startup прошли.
- Полный check остановился на EPERM локального socket SpeechKit; оставшиеся
  infra/calendar/hosting проверки прошли после разрешения локального socket.
  API1520pass/203conditionalSkip, прежний compression test превысил5s;
  его отдельный неизменённый suite9/9 прошёл. Лимиты тестов не ослаблялись.
- local:verify блокируется прежним append_live_round в общей локальной БД;
  она не сбрасывалась. Новая схема проверена в собственном PG17 контейнере.
- В общем DB suite прежний calendar seed превысил5s и оставил fixture;
  одноразовый тестовый контейнер пересоздан, не затрагивая рабочие локальные БД.
  Итоговый полный DB suite192pass/2conditionalSkip, без изменения test timeout.

## Готовность запуска
Код и инструкция оператора подготовлены. CI, публикация, сверка выбранной
реальной учётки и выдача первого права не подтверждены. Контакт пользователь
передал в чате, он не хранится в репозитории. Public URL после выпуска:
https://fit-training.ru/admin; вход существующим Yandex ID через /auth.
Текущая production-ссылка не считается проверкой ещё не опубликованного PR.
