import { expect, test } from '@playwright/test'

test('trainer can create client, complete workout and save progress', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Анна Тестова')
  await page.getByLabel('Начальный вес, кг').fill('61.5')
  await page.getByLabel('Цель').fill('Стать сильнее')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Анна Тестова' })).toBeVisible()
  const clientUrl = page.url()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Анна Тестова' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await expect(page.getByRole('button', { name: /Присед со штангой/ })).toBeVisible()
  await expect(page).toHaveScreenshot('exercise-picker-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03 })
  await page.getByLabel('Поиск упражнения').fill('Болгарский')
  await page.getByRole('button', { name: /Болгарский присед/ }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  // «＋ Подход» наследует параметры предыдущего подхода (40 кг × 10).
  await expect(page.getByLabel('Вес, подход 2')).toHaveValue('40')
  await expect(page.getByLabel('Повторы, подход 2')).toHaveValue('10')
  await page.getByLabel('Вес, подход 2').fill('35')
  await page.getByLabel('Повторы, подход 2').fill('12')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()
  // Крупный таймер тренировки по центру над подходами, идущий от старта (мм:сс).
  await expect(page.locator('.live-timer-big')).toContainText(/\d\d:\d\d/)
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  // Подтверждённый подход показывает зафиксированные значения ярко (не placeholder):
  // поле веса заблокировано и содержит реальное значение 42.5.
  await expect(page.locator('.set-row.locked input').first()).toHaveValue('42.5')
  await expect(page.locator('.set-row.locked input').first()).toBeDisabled()
  await expect(page.getByText(/Отдых 1:30/)).toBeVisible()
  // Отдых считается от абсолютного времени: через ~2 с значение должно уменьшиться.
  await expect(page.getByText(/Отдых 1:2\d/)).toBeVisible({ timeout: 4000 })
  // Кнопка +15с продлевает текущий отдых.
  await page.getByRole('button', { name: 'Плюс 15 секунд' }).click()
  await expect(page.getByText(/Отдых 1:3\d/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await page.getByRole('button', { name: '＋ Подход' }).click()
  // Дождаться, пока добавленный подход подтянется (refetch завершён и version
  // актуальна), иначе следующая правка ловит конфликт оптимистичной блокировки.
  await expect(page.getByText('Подход 3')).toBeVisible()
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByText('Готово', { exact: true })).toBeVisible()
  // Завершённая тренировка показывает фактический результат (вес × повторы),
  // а не только название упражнения.
  await expect(page.getByText(/42\.5 кг × 9 повт\./)).toBeVisible()
  // Сводка завершённой тренировки: время, тоннаж, группы мышц.
  // Тоннаж: факт 42.5×9 + план 35×12 (п2) + план 35×12 (п3, унаследован live «＋ Подход») ≈ 1.2 т.
  await expect(page.locator('.done-summary-3')).toContainText('Тоннаж')
  await expect(page.locator('.done-summary-3')).toContainText('1.2 т')

  // Без перезагрузки: после завершения тренировки статистика клиента обновляется
  // (finish инвалидирует client-stats). Возвращаемся SPA-навигацией, не goto.
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'История тренировок' })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.locator('.summary.stats')).toContainText('1')
  await expect(page.locator('.summary.stats')).toContainText('100%')

  await page.goto(clientUrl)
  await expect(page.getByText('Тренировок', { exact: true })).toBeVisible()
  await expect(page.locator('.summary.stats')).toContainText('1')
  await expect(page.locator('.summary.stats')).toContainText('100%')
  // Вместо «Последней» на карточке показываем ИМТ.
  await expect(page.locator('.summary.stats')).toContainText('ИМТ')

  // История и карточка используют один префикс ключа кэша, но разной формы —
  // переход туда-обратно не должен ронять приложение (регресс e.filter).
  await page.getByRole('link', { name: 'История', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'История тренировок' })).toBeVisible()
  await expect(page.locator('.card').first()).toBeVisible()
  // На карточке истории — тоннаж завершённой тренировки.
  await expect(page.locator('.card-meta').first()).toContainText('1.2 т')
  await page.locator('.card').first().click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // Заходим в аналитику упражнения и возвращаемся: «назад» с тренировки не должен
  // пинг-понгить обратно в историю упражнения (регресс петли навигации).
  await page.locator('.exercise-name-link').first().click()
  await expect(page.getByRole('heading', { name: 'История упражнения' })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'История тренировок' })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.locator('.summary.stats')).toContainText('100%')

  await page.getByRole('link', { name: 'Замеры и аналитика' }).click()
  await page.getByLabel('Дата').fill('2026-07-20')
  await page.getByLabel('Вес, кг').fill('61')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  // История замеров свёрнута по умолчанию — разворачиваем, чтобы увидеть карточку.
  await page.getByRole('button', { name: 'Показать' }).click()
  await expect(page.getByText('61 кг')).toBeVisible()
})

test('profile Cancel resets unsaved edits', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Профиль', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  const firstName = page.getByLabel('Имя')
  const original = await firstName.inputValue()
  await firstName.fill('Черновик Который Отменим')
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(firstName).toHaveValue(original)
})

test('schedule shows week strip and hour grid with day/week navigation', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
  await expect(page.locator('.schedule-count')).toHaveText(/\d+ трениров/)

  // Week strip has 7 day buttons, hour grid is rendered.
  await expect(page.locator('.week-day')).toHaveCount(7)
  await expect(page.locator('.day-grid-hour')).toHaveCount(24)

  // Picking another weekday selects it (active class moves) and does not error.
  const other = page.locator('.week-day').nth(1)
  await other.click()
  await expect(other).toHaveClass(/active/)

  // Week arrows shift the visible week — day numbers change.
  const firstDayBefore = await page.locator('.week-day .day-num').first().innerText()
  await page.getByRole('button', { name: 'Следующая неделя' }).click()
  await expect(page.locator('.week-day .day-num').first()).not.toHaveText(firstDayBefore)

  // «Сегодня» видна всегда: вне текущей недели активна и возвращает обратно,
  // на сегодняшней неделе — задизейблена.
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(page.locator('.week-day .day-num').first()).toHaveText(firstDayBefore)
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeDisabled()
})
