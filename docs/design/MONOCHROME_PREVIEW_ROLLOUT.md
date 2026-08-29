# Fit — production rollout Foundation UI Identity v1

Статус: **server flag и authenticated runtime read доставлены; Client Home,
Live и Progress задеплоены и прошли общий visual audit; остальной клиентский
контур, workout lifecycle, Trainer Today и Trainer Clients также задеплоены.
Trainer Client Detail проходит отдельный Gate 7 rollout**.

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
| Trainer Client Detail `/clients/:id` | `trainer-client-detail-identity` | local validation complete |

Review/save относятся к workout lifecycle и не получают Client Home, Client
Card Edit или Trainer Today identity. Detail/completion/history используют
собственный scope и не наследуют Create/Edit; Live остаётся отдельной принятой
областью. Trainer Clients заканчивается на точном `/clients`; Trainer Client
Detail — на точном `/clients/:id`. Create/edit, goal и workouts не наследуют их.
У пользователя без `monochrome_preview` все перечисленные маршруты остаются в
текущей айдентике.
