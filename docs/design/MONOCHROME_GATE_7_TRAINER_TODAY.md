# Gate 7 — Trainer Today

Статус: **production preview; PR #662, deployment verified**.

## Scope

- Роль: Trainer.
- Identity применяется только к `/today` без `view=review|save`.
- Route scope включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Review/save сохраняют принятый `workout-create-edit-identity`; Client Home,
  Clients, Schedule, Profile и остальные тренерские маршруты не меняются.

## Сохранённый продуктовый контракт

- Voice/text composer, parser, draft/resume, review, assignment и save используют
  прежние данные, mutation и переходы.
- First plan, ближайшая тренировка, attention/planning и install prompt строятся
  по существующим данным и условиям; их порядок и действия не менялись.
- Existing loading и disabled states сохранены. Искусственные empty, error или
  success states не добавлялись.

## Применённая UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, controls `14/500`, meta
  `12/500`, editable content `16/400`. Вес 600 не стал универсальным.
- Voice-first — одна primary surface 18 px с отдельным 48 px mic-control.
  Secondary text action остаётся 48 px и не конкурирует с голосовым стартом.
- Composer, ближайшая тренировка, attention/planning и install используют один
  neutral surface family; вложенные controls имеют радиус 14 px.
- Disabled сохраняет opacity 1 и читаемый semantic contrast. Base actions —
  48 px, compact — 44 px независимо от variant.
- Trainer navigation использует neutral active state. Coral, purple, glow и
  локальные hex в route CSS не добавлены.
- Light/dark сохраняют одинаковую геометрию и проверены отдельно.

## Реальные состояния и visual review

- First-plan/voice-first, text composer, ближайшая тренировка,
  attention/planning, install prompt и dark theme.
- Trainer workspace: 1440×1000. Mobile: 390×844 и 430×932; дополнительно
  проверен горизонтальный overflow на 360 и 375 px.
- Для Darwin и Linux добавлены отдельные full-page visual baselines; существующий
  WebKit dark baseline обновлён на новой identity.
- У пользователя без preview-флага `/today` сохраняет прежнюю identity; email не
  участвует во frontend, routing, компонентах или UI-условиях.

## Проверки

- AppLayout: enabled, flag-off и изоляция review/save scope — 46/46 unit tests.
- Chromium: 9/9 реальных Today start/review/save сценариев; отдельный flag-off
  smoke.
- WebKit: 5/5 focused checks — 360/375/390 px, draft/voice и dark contrast.
- Native visual: 5 passed, 1 ожидаемый desktop skip. Linux visual: 5 passed,
  1 ожидаемый desktop skip после чистого повторного comparison.
- Полный `npm run check` и повторный обязательный CI прошли. PR #662 влит
  отдельным squash commit, production deployment `6152753932` завершился
  успешно. Browser smoke был заблокирован административной policy до navigation;
  обход не применялся, authenticated smoke остаётся ручным пунктом.

## Rollback

`monochrome_preview=false` возвращает `/today` к прежней айдентике после
обновления authenticated session state. Откат не требует изменения workout
data, API, маршрутов или review/save lifecycle.
