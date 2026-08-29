# Gate 5 — Client Progress

Статус: **implemented; local validation complete**.

## Scope

- Роль: Client.
- Route: `/me/progress`.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Client Home и Live сохраняют уже принятую identity; Trainer Progress и
  остальные маршруты не меняются.

## Сохранённый продуктовый контракт

- Периоды, расчёт лучшего результата, сводка тренировок, сравнение с прошлым
  периодом, карта тела, беговой прогресс и связь с целью используют прежние
  данные и условия показа.
- Добавление, редактирование и удаление замеров, история, график, нижние листы,
  error/retry и переходы работают через прежние команды и маршруты.
- API/RPC, права, тексты, порядок данных и продуктовая логика не менялись.

## Применённая UI Identity v1

- Onest и компактная шкала: заголовок страницы `24/600`, секции `16/600`,
  body `14/400`, labels `12/500`, ключевой результат `40/600`.
- Фильтры периода — нейтральные compact controls высотой 44 px. Active state
  задаётся контрастом поверхности и текста, а не цветной заливкой.
- Карточки, графики, оси и серии используют нейтральные foundation-токены без
  gradient, glow и dashboard-декора. Успешная динамика получает success token
  только вместе с числом и текстовым смыслом.
- Actions — 48 px; поля сохраняют `16/400`; геометрия light/dark одинакова.
- Нижняя навигация повторяет принятый Client Home pattern: divider, outline
  icons и текстовый active state без цветной pill.

## Реальные состояния

Покрыты существующие loading/error/ready и отсутствие данных сводки, выбор
периода, лучший результат, progress/load mode карты тела, доступные варианты
фигуры, условный беговой блок, детали прогресса, последние замеры, история,
график, создание/редактирование/удаление и ошибки формы. Искусственные состояния
не добавлялись.

## Visual review

- Light и dark: full-page baselines 390 и 430 px.
- Отдельно проверены основная сводка, scheme view и measurements/chart.
- В light сохранены тёплый фон и графитовая иерархия; в dark отдельно настроены
  фон, поверхности, controls и читаемость secondary.
- Coral и purple отсутствуют. Green используется только для реального
  положительного изменения; заголовки и декоративные элементы нейтральны.
- Пользователь без flag явно не получает `progress-identity`; server flag
  остаётся fail-closed.

## Проверки

- Полный `npm run check`: 123 app-файла / 869 tests, 225 API tests, policies,
  lint, typecheck и production build — green.
- Chromium: три Progress-сценария, включая реальный аккаунт без preview-флага;
  WebKit: пять client Progress/measurements/long-content сценариев — green.
- Light/dark visual baselines 390/430: 8/8 native WebKit и exact Linux
  no-update comparison — green.
- CI, deployment и production smoke фиксируются в PR до общего аудита Client
  Home → Live → Progress.

## Rollback

Переключение server-row `monochrome_preview=false` возвращает Client Progress
к прежней айдентике после обновления session state; новая сборка и изменение
продуктовых данных не требуются.
