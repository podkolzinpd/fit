# Fit — production rollout Foundation UI Identity v1

Статус: **server flag и authenticated runtime read доставлены; Client Home,
Live и Progress задеплоены и прошли общий visual audit; остальной клиентский
контур, workout lifecycle, Trainer Today, Trainer Clients и Trainer Client
Detail/Create/Edit/Goal, Schedule, Trainer Progress и Exercise Catalog также
задеплоены. Trainer Profile проходит отдельный Gate 7 rollout**.

## Контракт

- Runtime-флаг называется `monochrome_preview`.
- Источник правды — `public.user_feature_flags`, ключ — authenticated `user_id`.
- Отсутствующая строка и значение `false` означают OFF.
- Пользователь может читать только свою строку через RLS и не может менять флаг.
- Изменение флага выполняется серверной административной ролью без новой сборки.
- Два согласованных production-аккаунта включаются одноразовой серверной
  инициализацией: email используется только для разрешения существующих Auth
  UUID, после чего runtime работает исключительно с `user_id`.
- Email нельзя добавлять во frontend, routing, CSS или UI-условия.

## Безопасная последовательность

1. Отдельно применить таблицу, RLS, grants и initial server values.
2. После успешного production database deployment добавить frontend-read и
   default-false mapping в authenticated actor.
3. Каждый мигрированный route подключать к новому identity-классу отдельно.
4. Немигрированные routes не получают новый класс даже у участника preview.
5. Отключение строки немедленно возвращает весь интерфейс пользователя к
   текущей айдентике после обновления auth/session state.

## Не входит в server-foundation PR

- product CSS и компоненты;
- route gating;
- Client Home, Live и Progress;
- глобальное включение новой айдентики.

## Runtime mapping

- Authenticated session читает только `monochrome_preview` собственной строки.
- Значение `true` преобразуется в `actor.featureFlags.monochromePreview`.
- Отсутствующая строка, `false` или ошибка чтения дают `false` и не блокируют
  вход в приложение.
- Само наличие runtime-флага не меняет UI: каждый экран подключается отдельно.

## Route rollout

| Route | Preview class | Статус |
| --- | --- | --- |
| Client Home `/me` | `client-home-identity` | production preview |
| Live `*/live` | `live-identity` | production preview |
| Progress `/me/progress` | `progress-identity` | production preview |
| My Workouts `/me/workouts` | `client-workouts-identity` | production preview |
| Client Profile `/me/profile` | `client-profile-shell-identity` | production preview |
| Client Card Edit `/me/edit` | `client-card-edit-identity` | production preview |
| Workout Create/Edit `/workouts/new`, `/workouts/:id/edit` | `workout-create-edit-identity` | production preview |
| Workout Review/Save `/today?view=review\|save`, `/me?view=review\|save` | `workout-create-edit-identity` | production preview |
| Workout Detail `/workouts/:id` | `workout-detail-history-identity` | production preview |
| Exercise History `/workouts/:id/history/:exerciseSlug` | `workout-detail-history-identity` | production preview |
| Trainer Today `/today` без review/save | `trainer-today-identity` | production preview |
| Trainer Clients `/clients` | `trainer-clients-identity` | production preview |
| Trainer Client Detail `/clients/:id` | `trainer-client-detail-identity` | production preview |
| Trainer Client Create/Edit `/clients/new`, `/clients/:id/edit` | `trainer-client-form-identity` | production preview |
| Trainer Client Goal `/clients/:id/goal` | `trainer-client-goal-identity` | production preview |
| Trainer Schedule `/schedule` | `trainer-schedule-identity` | production preview |
| Trainer Progress `/progress/:clientId` | `trainer-progress-identity` | production preview |
| Exercise Catalog `/exercises` | `exercise-catalog-identity` | production preview |
| Trainer Profile `/profile` | `trainer-profile-identity` | local validation in progress |

Review/save относятся к workout lifecycle и не получают Client Home, Client
Card Edit или Trainer Today identity. Detail/completion/history используют
собственный scope и не наследуют Create/Edit; Live остаётся отдельной принятой
областью. Trainer Clients заканчивается на точном `/clients`; Trainer Client
Detail — на точном `/clients/:id`. Create/edit, goal и workouts не наследуют их.
Goal заканчивается на точном `/clients/:id/goal` и не меняет schedule, progress
или workout routes. Schedule заканчивается на точном `/schedule` и не меняет
workout create/detail, Trainer Progress, Exercises или Profile. Trainer Progress
заканчивается на точном `/progress/:clientId`; query views `running` и
`measurements` используют тот же scope. Exercise Catalog заканчивается на
точном trainer route `/exercises` и не меняет workout picker или Profile.
Trainer Profile заканчивается на точном trainer route `/profile` и не меняет
Client Profile, Join, Exercise Catalog или другие trainer routes.
У пользователя без `monochrome_preview` все перечисленные маршруты остаются в
текущей айдентике.
