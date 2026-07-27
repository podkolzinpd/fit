# Feature parity с trainer-app

Baseline V1: зафиксированный снимок `legacy trainer-app`, commit `049773605235dc2d92dc9b9ccfaa0244d00795f5`.

| Область | Обязательный результат V2 | Статус |
|---|---|---|
| Auth | Email/password без confirmation для MVP, Google OAuth, session restore, logout, password reset; постоянные роли trainer/client | Implemented; role-aware registration/session routing ready, production Google smoke passed, reset SMTP pending |
| Client account | Клиент входит в тот же frontend, видит только связанную карточку; тренер и клиент подключаются одноразовым кодом; несколько тренеров получают membership-доступ | Implemented auth, invitations, realtime portal and role-scoped shared mutations: client performs assigned workouts and owns progress, manages trainer memberships and active invitations; membership trainers retain full workflow and can leave non-root memberships |
| Profile | Просмотр и изменение имени, корректный Cancel | Partial: edit/logout ready, Cancel UX pending |
| Clients | List/empty/error/retry, create, detail, edit, archive/restore | Implemented; aggregate list uses one tenant-scoped RPC; core E2E + RLS ready |
| Client stats | Сводка на карточке: количество выполненных, % выполнения, дата последней тренировки, дней в работе (от первой тренировки), индикатор «требует внимания» при 14+ днях без тренировки | Implemented: pure aggregation covered unit + E2E |
| Exercises | System search/filter; custom create/edit/archive/restore | Implemented: complete catalog and shared picker covered; management E2E pending |
| Workout | Create/view/edit/correct/copy/delete, strength/distance/reps, atomic save | Implemented: multi-set plan and load correction covered; wider acceptance pending |
| Voice notes | Browser-only Russian transcription into editable workout and client trainer notes; manual input remains available | Prototype: local whisper.cpp WASM ready; real-device acceptance pending |
| Schedule | Week/month/local date, timed/untimed, open workout/back | Implemented: недельная лента дней + часовая сетка на день (timed по времени, untimed отдельно), закреплённая шапка с прокруткой только сетки, автоскролл к 07:00/первой тренировке, кнопка «Сегодня», выбор дня и недели в URL, календарь-переход к дате; covered unit + E2E |
| Live | Start, autosave, confirm, rest, append, resume, partial finish | Implemented: rest, transactional append and non-retryable optimistic conflicts covered; wider resume acceptance pending |
| History | Done workouts only, set list and max-value chart | Implemented: set list and max-value progression chart (по типу упражнения) covered unit; broader visual pending |
| Progress | Base/custom atomic save, edit/delete, chronological charts | Implemented; duplicate-date create opens the existing entry without a failing DB request; broader visual/E2E matrix pending |
| Navigation | URL/deep-link/refresh/back/404/unauthorized | Implemented; acceptance matrix pending |

Статус меняется на Done только после component/E2E и, где применимо, DB/RLS теста.

`Implemented` означает, что код сценария существует и его основной контракт покрыт тестами. Это не `Done`: релиз блокируют незакрытые acceptance tests, visual parity и пункты из `OPERATIONS.md`.

## Client membership acceptance contract

- Клиент видит основного и дополнительных тренеров своей карточки; чужие пользователи не могут получить этот список.
- Основного тренера отключить нельзя. Дополнительного тренера клиент может отключить, а дополнительный тренер может самостоятельно покинуть пространство клиента.
- Основной тренер не может покинуть пространство клиента, чтобы карточка не осталась без root-владельца.
- Создатель видит только свои активные неиспользованные приглашения и может отозвать их; использованные, просроченные и отозванные приглашения в активном списке не показываются.
- Обязательные проверки: owner/member/root/cross-tenant SQL matrix, подтверждение необратимых действий в UI и E2E invite → join → leave/remove.

## Exercise acceptance contract

- Системный каталог содержит ровно 49 упражнений V1: ноги 11, грудь 7, спина 7, плечи 6, руки 6, кор 5, кардио 7.
- Системные упражнения остаются versioned application constant; workout хранит стабильный `ref` и snapshot названия, категории и типа ввода.
- Picker одинаково используется в плане и live: поиск без учёта регистра, фильтр по семи категориям, empty/loading/error/retry и создание своего упражнения.
- Силовой подход хранит вес и повторы; distance — время и дистанцию; cardio reps — время и повторы.
- План поддерживает несколько подходов, удаление, сброс значений и изменение веса на ±5% с округлением до 2,5 кг.
- Live поддерживает добавление подхода и упражнения отдельными транзакционными RPC, autosave факта, подтверждение, отдых 90 секунд и частичное завершение с предупреждением. Таймер отдыха считается от абсолютной метки времени и остаётся корректным при сворачивании вкладки.
- Обязательные проверки: уникальность полного каталога, component search/filter/create, RPC rollback/cross-tenant, mobile visual snapshot и E2E plan → multi-set → live append → partial finish.

## AI progress acceptance contract

- Метрики считаются детерминированно на сервере за выбранные 1/3/6 месяцев; модель не получает ФИО, контакты, заметки тренера и замеры тела.
- Один вызов модели возвращает две согласованные структуры: внутреннюю версию тренера и безопасную версию клиента.
- Внутренняя версия недоступна клиенту даже прямым Data API запросом. Клиент читает только отдельную безопасную таблицу без тренерских полей.
- Клиент может сам запросить или обновить сводку. Тренерская публикация/правка остаётся необязательной; клиент не может редактировать внутреннюю версию, публиковать или скрывать анализ.
- Роль определяется по защищённым строкам `trainers` / `clients.auth_user_id`, а не по `user_metadata`.
- Приглашение создаётся Edge Function с server-only ключом и привязывает только нового приглашённого Auth-пользователя. Уже существующий email не связывается без отдельного proof-of-control flow.
