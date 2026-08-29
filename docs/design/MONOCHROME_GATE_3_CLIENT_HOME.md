# Gate 3 — Client Home

Статус: **implemented; PR visual validation in progress**.

## Scope

- Роль: Client.
- Route: только `/me` без `view=review|save`.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Live, Progress, Workouts, Profile, workout review/save и Trainer не меняются.

## Сохранённый продуктовый контракт

- Voice-first порядок и тексты действий сохранены.
- Ближайшая тренировка, прошедший план, недельный ритм, highlight, self-training,
  install prompt, loading и error/retry используют прежние данные и условия.
- Маршруты, запросы, мутации, права, тексты и порядок сценария не менялись.
- На экране остаётся одно очевидное primary-действие — голосовой старт.

## Применённая UI Identity v1

- Onest variable; `24/600`, `18/600`, `16/600`, `14/400`, `14/500`, `12/500`.
- Light: `#FBFAF7`, `#242426`, молочный контент `#F6F2EA` и утверждённые
  тёплые surfaces.
- Dark: `#111214`, primary `#F1EDE6`, поверхности
  `#1D1E21 / #26272B / #191A1D`, secondary `#999A9F`.
- Actions 48 px; controls 44 px только в компактном контексте; радиусы
  10/14/18 px; outline icons около 1.8 stroke.
- Voice action, flat information surface и bottom navigation сформированы как
  новая композиция, а не перекраска прежнего coral/purple UI.

## Реальные состояния

Стили покрывают состояния, уже существующие в Client Home: first run,
connected/self-training, next planned/active workout, past unresolved plan,
week summary, goal/record/trainer highlight, loading, error/retry, text composer,
recording controls и install prompt. Искусственные продуктовые состояния не
создавались.

## Visual review

- Light и dark: committed full-page baselines 390 и 430 px.
- Проверены safe area, статическая mobile tab bar, отсутствие horizontal
  overflow и 48 px action geometry.
- Пользователь без flag и свежесозданный local client не получают identity
  class; их существующие visual baselines остаются контрольной группой.
- Точный Linux/WebKit результат проверяется штатным PR CI. Локальный WebKit в
  Playwright Linux container на Apple Silicon не поддерживает используемый EGL;
  это не обходится ослаблением screenshot tolerance.

## Проверки

- AppLayout/auth/ClientHomeOverview: 43 tests.
- Typecheck, lint и diff check: green.
- Clean local Supabase reset с двумя flag-enabled demo users: green.
- Полный `npm run check`, CI visual/behavior и production smoke фиксируются в
  PR перед переходом к Live.

## Rollback

Удаление или переключение server-row `monochrome_preview=false` возвращает
Client Home к прежней айдентике после обновления session state; новой сборки и
миграции данных не требуется.
