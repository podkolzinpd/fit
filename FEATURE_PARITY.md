# Feature parity с trainer-app

Baseline V1: зафиксированный снимок `legacy trainer-app`, commit `049773605235dc2d92dc9b9ccfaa0244d00795f5`.

| Область | Обязательный результат V2 | Статус |
|---|---|---|
| Auth | Email/password без confirmation для MVP, Google OAuth, session restore, logout, password reset | Implemented; production Google smoke passed, reset SMTP pending |
| Profile | Просмотр и изменение имени, корректный Cancel | Partial: edit/logout ready, Cancel UX pending |
| Clients | List/empty/error/retry, create, detail, edit, archive/restore | Implemented; core E2E + RLS ready |
| Exercises | System search/filter; custom create/edit/archive/restore | Implemented: complete catalog and shared picker covered; management E2E pending |
| Workout | Create/view/edit/correct/copy/delete, strength/distance/reps, atomic save | Implemented: multi-set plan and load correction covered; wider acceptance pending |
| Schedule | Week/month/local date, timed/untimed, open workout/back | Partial: grouped schedule ready, week/month controls pending |
| Live | Start, autosave, confirm, rest, append, resume, partial finish | Implemented: rest and transactional append covered; wider resume acceptance pending |
| History | Done workouts only, set list and max-value chart | Partial: done set list ready, max chart pending |
| Progress | Base/custom atomic save, edit/delete, chronological charts | Implemented; broader visual/E2E matrix pending |
| Navigation | URL/deep-link/refresh/back/404/unauthorized | Implemented; acceptance matrix pending |

Статус меняется на Done только после component/E2E и, где применимо, DB/RLS теста.

`Implemented` означает, что код сценария существует и его основной контракт покрыт тестами. Это не `Done`: релиз блокируют незакрытые acceptance tests, visual parity и пункты из `OPERATIONS.md`.

## Exercise acceptance contract

- Системный каталог содержит ровно 49 упражнений V1: ноги 11, грудь 7, спина 7, плечи 6, руки 6, кор 5, кардио 7.
- Системные упражнения остаются versioned application constant; workout хранит стабильный `ref` и snapshot названия, категории и типа ввода.
- Picker одинаково используется в плане и live: поиск без учёта регистра, фильтр по семи категориям, empty/loading/error/retry и создание своего упражнения.
- Силовой подход хранит вес и повторы; distance — время и дистанцию; cardio reps — время и повторы.
- План поддерживает несколько подходов, удаление, сброс значений и изменение веса на ±5% с округлением до 2,5 кг.
- Live поддерживает добавление подхода и упражнения отдельными транзакционными RPC, autosave факта, подтверждение, отдых 90 секунд и частичное завершение с предупреждением.
- Обязательные проверки: уникальность полного каталога, component search/filter/create, RPC rollback/cross-tenant, mobile visual snapshot и E2E plan → multi-set → live append → partial finish.
