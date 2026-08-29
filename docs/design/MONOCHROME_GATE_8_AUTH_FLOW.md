# Gate 8 — auth-flow

Статус: **implemented; local acceptance complete**.

## Scope

- Public `/auth`, `/auth/forgot`, `/auth/reset`, `/auth/callback` и
  `/auth/yandex/callback`.
- Authenticated `/join` со всеми существующими invitation states.
- Login/register mode, recovery, callback loading/error, Yandex pilot data и
  Join claim/reconnect/success сохраняют текущую product logic.
- OAuth, repositories, routes, data contracts и server authorization не
  меняются.

## Global rollout и rollback

- `VITE_MONOCHROME_ROLLOUT_MODE=on` — production default для всех, включая
  unauthenticated users.
- `preview` — прежний `monochrome_preview` по authenticated `user_id`.
- `off` — один глобальный kill switch, который возвращает legacy UI даже при
  персональном флаге ON.
- Legacy components, CSS и `public.user_feature_flags` не удаляются.
- Email не используется во frontend rollout conditions.

## UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, controls `14/500`, compact
  labels `12/500`, editable fields `16/400`.
- Base actions — 48 px независимо от semantic priority; links сохраняют
  доступную compact target area 44 px.
- Login/register form, provider actions, recovery and callback panels образуют
  одну neutral surface family без coral, purple, gradient, glow и shadow.
- Light primary — warm graphite; dark primary — milk. Геометрия одинакова.
- Error/success используют утверждённые semantic colors только вместе с текстом.
- Join использует тот же action/form contract внутри существующего app shell.

## Реальные состояния

- Login/register, busy, disabled и repository error.
- Forgot initial, success и error; Reset initial и error.
- Auth callback loading/error/redirect.
- Yandex pilot disabled redirect, verify error, profile, clients,
  connections и training-data async states.
- Join manual code, invitation link, pending, wrong/expired code,
  disconnect-required и success.

## Проверки

- Unit: rollout `on / preview / off`, route scope и no-leakage.
- Visual: Login/Register/Reset light, Login/Forgot/Callback dark и Join
  manual/invitation light/dark на 390, 430 и 1440 px.
- Полная visual matrix проверена изолированно на чистом seed для каждого
  viewport: 390 — 29 passed / 2 skipped, 430 — 29 passed / 2 skipped,
  1440 — 17 passed / 14 skipped.
- Chromium public auth smoke и committed Darwin baselines.
- WebKit light/dark auth controls and horizontal-overflow smoke.
- Локальный Supabase runtime восстановлен через Podman. Полный authenticated
  auth/join lifecycle — 7/7 Chromium passed; public WebKit auth smoke passed.
- Полный project check зелёный: 123 app files / 962 tests, 225 API tests,
  typecheck, lint, coverage, DB types, iOS permissions, infra policy и
  production build. Linux visual baselines и production smoke остаются
  merge/deploy gates.

## Rollback

Set `VITE_MONOCHROME_ROLLOUT_MODE=off` and redeploy. No database, account,
OAuth or routing rollback is required.
