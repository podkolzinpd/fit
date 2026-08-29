# Gate 9 — Task 28: visual regression and release

Статус: **implemented; release acceptance complete with one documented manual
production visual follow-up**.

## Scope и инварианты

- Финальная identity matrix охватывает Client 390/430 и Trainer 1440×1000.
- Light/dark, реальные product states, auth family, workout lifecycle,
  trainer workspaces и Assistant проверяются на принятом UI Identity v1.
- Product logic, routes, data contracts, OAuth, roles и Assistant orchestration
  не меняются.
- Новая identity остаётся production default. Legacy UI, server-managed
  `monochrome_preview` и режимы rollout `on / preview / off` сохраняются.

## Visual regression

- В репозитории закреплено 346 согласованных Linux/Darwin snapshot-файлов:
  125 для Client 390, 125 для Client 430 и 96 для Trainer 1440.
- Финальная CI matrix прошла 72 применимых visual-сценария; 18 пропусков —
  намеренные role/viewport skips, а не отсутствующее покрытие.
- Отдельно прошли 73 Chromium behavior-сценария.
- Baselines обновляются только при намеренном визуальном решении. Task 28 не
  меняет изображения: последняя геометрическая коррекция Schedule уже принята
  в Task 27 и подтверждена одинаково в light/dark.

## WebKit и iOS safe areas

- Оба обязательных WebKit shard завершены успешно.
- Покрыты 390/430, dynamic viewport, открытие/закрытие клавиатуры, fixed bars,
  bottom navigation, forms, auth, Progress, workout review и Assistant
  composer.
- Геометрия light/dark остаётся одинаковой; горизонтального page overflow нет.

## Стабилизация release-тестов

- Visual navigation один раз повторяет только browser-internal failure или
  подтверждённый пустой app document. Network, populated application и
  assertion failures не перехватываются.
- Длинный Client Goal audit получил локальный бюджет 60 секунд; остальные
  visual tests сохраняют стандартный timeout.
- Это изменение относится только к E2E harness и не меняет production bundle.

## Production evidence

- Task 27 merge `6e344d6` доставлен Vercel deployment `6158408571`; GitHub
  deployment status — `success`.
- Финальный authenticated Chromium/WebKit контракт выполнен на clean seed с
  обеими ролями и всеми мигрированными route scopes.
- Встроенный браузер не разрешил открыть даже публичный production URL:
  admin-enforced security policy не удалось проверить. Контроль не обходился.
  Поэтому ручной видимый smoke под Client и Trainer остаётся отдельным
  follow-up владельца продукта, а не скрыто отмечается выполненным.
- Это ограничение не блокирует обратимый rollout: deploy зелёный, продуктовая
  логика не менялась, полный browser CI прошёл.

## Быстрый ручной smoke

Проверить под production test accounts:

1. Client: `/me`, `/me/progress`, `/me/workouts`, `/me/profile`, создание и
   Live — light/dark, нижняя навигация и fixed actions.
2. Trainer: `/today`, `/clients`, Client Detail, `/schedule`, Progress,
   `/exercises`, `/profile`, `/assistant` — light/dark и desktop/mobile shell.
3. Public: `/auth`, `/auth/forgot`, `/join` — новая auth family до входа.

Проверка не должна создавать искусственные product states или менять реальные
данные сверх обычного test-account smoke.

## Rollback

Set `VITE_MONOCHROME_ROLLOUT_MODE=off` and redeploy to return legacy UI for all
users. Set it to `preview` to restore server-managed `monochrome_preview` by
authenticated `user_id`. No database, route, OAuth or product-data rollback is
required. Keep legacy UI and both rollback modes for at least one stable release
cycle; cleanup is a separate task.
