# Feature parity с trainer-app

Baseline: `podkolzinpd/yandex-fit-prototype@049773605235dc2d92dc9b9ccfaa0244d00795f5`.

| Область | Обязательный результат V2 | Статус |
|---|---|---|
| Auth | Email/password, confirmation, Google OAuth, session restore, logout, password reset | Implemented; real Google smoke pending |
| Profile | Просмотр и изменение имени, корректный Cancel | Partial: edit/logout ready, Cancel UX pending |
| Clients | List/empty/error/retry, create, detail, edit, archive/restore | Implemented; core E2E + RLS ready |
| Exercises | System search/filter; custom create/edit/archive/restore | Partial: CRUD ready, search/filter E2E pending |
| Workout | Create/view/edit/correct/copy/delete, strength/distance/reps, atomic save | Implemented for planned CRUD/copy; extended correction acceptance pending |
| Schedule | Week/month/local date, timed/untimed, open workout/back | Partial: grouped schedule ready, week/month controls pending |
| Live | Start, autosave, confirm, rest, append, resume, partial finish | Partial: durable live/resume/partial finish ready; rest/append pending |
| History | Done workouts only, set list and max-value chart | Partial: done set list ready, max chart pending |
| Progress | Base/custom atomic save, edit/delete, chronological charts | Implemented; broader visual/E2E matrix pending |
| Navigation | URL/deep-link/refresh/back/404/unauthorized | Implemented; acceptance matrix pending |

Статус меняется на Done только после component/E2E и, где применимо, DB/RLS теста.

`Implemented` означает, что код сценария существует в foundation-ветке. Это не `Done`: релиз блокируют незакрытые acceptance tests, visual parity и пункты из `OPERATIONS.md`.
