# Gate 6 — Client My Workouts

Статус: **implemented; local validation complete**.

## Scope

- Роль: Client.
- Route: только `/me/workouts`.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Создание, review, карточка, редактирование, завершение и Live остаются в
  своих текущих route scopes до задач workout lifecycle.

## Сохранённый продуктовый контракт

- Предстоящие тренировки, планы с просроченным решением, история и empty state
  используют прежние запросы, разбиение и порядок данных.
- Добавление тренировки, переход в карточку, выбор действия и подгрузка истории
  сохраняют прежние маршруты и команды.
- Loading, error/retry и отсутствие клиентской карточки появляются только по
  существующим условиям. Новые состояния не создавались.
- API/RPC, права, тексты и продуктовая логика не менялись.

## Применённая UI Identity v1

- Заголовок страницы `24/600`, секции `18/600`, дата/объект `16/600`, body
  `14/400`, status и meta `12/500`.
- Секции отделяются ритмом 24 px, карточки — нейтральной поверхностью и тонкой
  границей; glow, gradients и декоративные brand-заливки удалены из route scope.
- Header action использует compact 44 px, основной empty-state action — 48 px.
  Приоритет создаётся полярной заливкой, а не иной высотой semantic variant.
- Current/partial/success/danger получают semantic color только вместе с
  понятной текстовой подписью. Обычный planned/history остаётся нейтральным.
- Bottom navigation полностью переиспользует принятый Client Home pattern.

## Реальные состояния

Покрыты существующие: loading, error/retry, отсутствие client card, пустой
список, upcoming, in-progress, past decision, completed/partial/skipped history,
personal record, feedback/discomfort и pagination. Искусственные состояния не
добавлялись.

## Visual review

- Light и dark: committed full-page baselines 390 и 430 px.
- Native WebKit/Chromium и exact Linux screenshots подтверждают одинаковую
  композицию, отсутствие horizontal overflow и цельную bottom navigation.
- Отдельные WebKit-сценарии проверяют partial, past decision и сохранение
  результата без запуска Live; existing behavior и тексты не изменились.
- Новый аккаунт без preview-флага явно не получает identity class.

## Проверки

- Полный `npm run check`: 123 app-файла / 870 tests, 225 API tests, policies,
  lint, typecheck и production build — green.
- AppLayout route scope: 28/28 tests; fail-closed Chromium account — green.
- WebKit real states: 3/3; native light/dark visual 390/430: 2/2;
  exact Linux no-update comparison 390/430: 2/2.
- CI, deployment и production smoke фиксируются в PR до перехода к задаче 11.

## Rollback

Переключение server-row `monochrome_preview=false` возвращает My Workouts к
прежней айдентике после обновления session state. Вложенные workout routes не
получают `client-workouts-identity` независимо от значения флага.
