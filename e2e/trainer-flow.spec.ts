import { expect, test, type Page } from '@playwright/test'

async function mockWorkoutParser(page: Page, items: unknown[]) {
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, unmatched: [] }) })
  })
}

async function fillNewClientProfile(page: Page) {
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
}

async function selectClient(page: Page, name: string, id?: string) {
  const trigger = page.locator('.client-picker-trigger')
  if (new URL(page.url()).searchParams.has('client')) {
    await expect(page.locator('.workout-header-meta')).toContainText(name)
    return
  }
  await trigger.click()
  const option = id
    ? page.locator(`.client-picker-item[data-client-id="${id}"]`)
    : page.locator('.client-picker-item').filter({ hasText: name }).first()
  await option.click()
}

test('форма: быстрый ввод разбирает текст в упражнения и подходы', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Аналитика', exact: true })).toHaveCount(0)
  // Пилот YAFIT-317 default-off: вне allowlist входы в верхнюю навигацию
  // («Ассистент», шестерёнка профиля в навигации) не рендерятся вовсе.
  // «Открыть профиль» проверяется внутри навигации: аватар в шапке «Сегодня»
  // легитимно носит тот же aria-label вне пилота.
  await expect(page.getByRole('link', { name: 'Ассистент', exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Открыть профиль' })).toHaveCount(0)
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.goto('/workouts/new')
  // Внутри создания нет конкурирующего таббара; заметка не занимает экран до
  // явного раскрытия, а быстрый ввод упражнений открыт сразу.
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Заметка' })).toBeHidden()
  await page.locator('.workout-notes summary').click()
  await expect(page.getByRole('textbox', { name: 'Заметка' })).toBeVisible()
  await selectClient(page, 'Анна Смирнова')
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await page.getByLabel('Запись тренировки').fill('Присед 80 на 8, 85 на 6, 90 на 5 RPE 8 затем Планка 3 по 45 сек')
  await expect(page.getByText('Уточните упражнение')).toBeVisible()
  await expect(page.getByText('Выберите вариант ниже или допишите деталь: положение, тренажёр или оборудование.')).toBeVisible()
  await expect(page.getByText(/«Присед 80 на 8, 85 на 6, 90 на 5 RPE 8» — выберите вариант/)).toBeVisible()
  await page.getByRole('button', { name: 'Все варианты' }).click()
  await expect(page.getByLabel('Поиск упражнения')).toHaveValue('Присед')
  await page.getByRole('button', { name: 'Закрыть' }).click()
  // Короткое название не угадывается: базовый присед идёт первым, но тренер
  // всё равно подтверждает подходящий вариант одним тапом.
  const squatCandidates = page.locator('.quick-workout-candidates button')
  await expect(squatCandidates).toHaveCount(3)
  await squatCandidates.first().click()
  await expect(page.getByText('Распознано: 2')).toBeVisible()
  await expect(page.getByText('Уточните упражнение')).toBeHidden()
  await page.getByRole('button', { name: 'Добавить в план (2)' }).click()
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('80')
  await expect(page.getByLabel('Вес, подход 2')).toHaveValue('85')
  await expect(page.getByLabel('Повторы, подход 3')).toHaveValue('5')
  const squatEditor = page.getByRole('article').filter({ hasText: 'Присед со штангой' })
  await squatEditor.getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Указать RPE' }).click()
  await expect(squatEditor.getByLabel('Целевой RPE, подход 1')).toHaveValue('8')
  await expect(page.getByLabel('Время, сек, подход 3')).toHaveValue('45')
})

test('форма: короткая беговая фраза создаёт редактируемые интервалы в метрах', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/workouts/new')
  await page.getByLabel('Запись тренировки').fill('6 по 400 метров')
  await expect(page.getByText('Распознано: 1')).toBeVisible()
  await expect(page.getByText('Бег — интервалы · 6 подходов')).toBeVisible()
  await page.getByRole('button', { name: 'Добавить в план (1)' }).click()

  await expect(page.getByText('Бег — интервалы', { exact: true }).last()).toBeVisible()
  await expect(page.getByLabel(/Расстояние, подход/)).toHaveCount(6)
  await expect(page.getByLabel('Расстояние, подход 1')).toHaveValue('400')
  await expect(page.getByLabel('Единица расстояния, подход 1')).toHaveValue('m')
  await page.locator('.planned-exercise').getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Настройки упражнения' }).click()
  await expect(page.getByLabel('Отдых между подходами, с')).toHaveValue('90')
})

test('гребной тренажёр использует темп на 500 м и частоту гребков', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/workouts/new')
  await selectClient(page, 'Анна Смирнова')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Гребной тренажёр')
  await page.getByRole('button', { name: /Гребной тренажёр/ }).first().click()
  await page.getByRole('button', { name: 'Добавить к выбранным' }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()

  await page.getByLabel('Время, подход 1').fill('5:08')
  await expect(page.getByLabel('Единица расстояния, подход 1')).toHaveValue('m')
  await page.getByLabel('Расстояние, подход 1').fill('500')
  await page.getByLabel('Гребков в минуту').fill('30')
  await page.getByLabel('Гребков в минуту').press('Tab')

  await expect(page.getByLabel('Время, подход 1')).toHaveValue('5:08')
  await expect(page.getByLabel('Расстояние, подход 1')).toHaveValue('500')
  await expect(page.getByText('Темп 5:08/500 м')).toBeVisible()
  await expect(page.getByLabel('Гребков в минуту')).toHaveValue('30')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 430, height: 932 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('стартовый экран показывает точный результат автоматического распознавания до сохранения', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/today')
  await mockWorkoutParser(page, [{ sourceText: 'Жим гантелей на наклон 3×8 24 кг', exerciseRef: 'fedb-incline-dumbbell-press', confidence: 1, sets: [{ weightKg: 24, reps: 8 }, { weightKg: 24, reps: 8 }, { weightKg: 24, reps: 8 }] }])
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим гантелей на наклон 3×8 24 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.getByText('Жим гантелей на наклонной')).toBeVisible()
})

test('trainer can create client, complete workout and save progress', async ({ page }, testInfo) => {
  const trainerAlias = `Анна ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Анна Тестова')
  await expect(page.getByLabel('Возраст')).toHaveValue('')
  await expect(page.getByLabel('Рост, см')).toHaveValue('')
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('61.5')
  await page.getByLabel('Цель').fill('Стать сильнее')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Анна Тестова' })).toBeVisible()
  const clientUrl = page.url()

  await page.getByRole('button', { name: 'Действия с профилем спортсмена' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать профиль' }).click()
  await page.getByLabel('Имя', { exact: true }).fill(trainerAlias)
  await page.getByLabel('Имя в моём списке').fill(trainerAlias)
  await page.getByLabel('Личная заметка').fill('Моя приватная заметка')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()
  await page.goto('/clients')
  await expect(page.getByText(trainerAlias)).toBeVisible()
  await page.goto(clientUrl)

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, trainerAlias)
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ Упражнение' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await expect(page.getByRole('heading', { name: 'Тип тренировки' })).toBeVisible()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await expect(page.locator('.picker-item-technique').first()).toBeVisible()
  const firstExerciseImage = page.locator('.picker-list .exercise-image').first()
  await expect(firstExerciseImage).toBeVisible()
  await expect(firstExerciseImage.locator('img').first()).toHaveCSS('object-fit', 'contain')
  const firstExerciseImageBox = await firstExerciseImage.boundingBox()
  expect(firstExerciseImageBox?.width).toBe(firstExerciseImageBox?.height)
  expect(firstExerciseImageBox?.width).toBeGreaterThanOrEqual(48)
  // Список упражнений маскируем: миниатюры-фото волатильны и различаются по ОС.
  // Под визуальным контролем — search-first хром пикера.
  await expect(page).toHaveScreenshot('exercise-picker-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03, mask: [page.locator('.picker-list')] })
  // Группа → мышца → оборудование собраны в одном компактном фильтре.
  await page.getByRole('button', { name: 'Фильтры' }).click()
  await page.getByLabel('Группа мышц').selectOption('legs')
  await page.getByLabel('Мышца').selectOption('Передняя поверхность бедра')
  await expect(page.getByLabel('Оборудование')).toBeVisible()
  await expect(page.getByLabel('Оборудование')).toContainText('Штанга')
  await expect(page).toHaveScreenshot('exercise-picker-equipment-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03, mask: [page.locator('.picker-list')] })
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await page.getByRole('button', { name: 'Фильтры' }).click()
  await page.getByLabel('Поиск упражнения').fill('Болгарский')
  await expect(page.getByText(/Найдено: \d+/)).toBeVisible()
  await expect(page.getByLabel('Группа мышц')).toBeHidden()
  await expect(page).toHaveScreenshot('exercise-picker-search-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05, mask: [page.locator('.picker-list')] })
  await expect(page.getByRole('button', { name: 'Очистить поиск' })).toBeVisible()
  await page.getByRole('button', { name: /Посмотреть технику: Болгарский присед \(Штанга\)/ }).click()
  await expect(page.getByRole('heading', { name: 'Техника' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Болгарский присед (Штанга)' })).toBeVisible()
  await expect(page.locator('.picker-technique-view .exercise-image-technique')).toBeVisible()
  await expect(page.getByText('Как выполнять')).toBeVisible()
  await expect(page).toHaveScreenshot('exercise-picker-technique-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05, mask: [page.locator('.picker-technique-view .exercise-image-technique')] })
  await page.getByRole('button', { name: 'Назад к выбору' }).click()
  await expect(page.getByLabel('Поиск упражнения')).toHaveValue('Болгарский')
  await page.getByRole('button', { name: /Выбрать: Болгарский присед \(Штанга\)/ }).click()
  await expect(page.getByText('Выбрано: 1')).toBeVisible()
  await expect(page).toHaveScreenshot('exercise-picker-selected-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05, mask: [page.locator('.picker-list')] })
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await expect(page.getByRole('button', { name: '＋ Упражнение' })).toBeVisible()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  // «＋ Подход» наследует параметры предыдущего подхода (40 кг × 10).
  await expect(page.getByLabel('Вес, подход 2')).toHaveValue('40')
  await expect(page.getByLabel('Повторы, подход 2')).toHaveValue('10')
  await expect(page.locator('.planned-set-table-head')).toHaveCount(1)
  await expect(page.locator('.planned-set-table-head')).toContainText('№')
  await expect(page.locator('.planned-set-table-head')).toContainText('Кг')
  await expect(page.locator('.planned-set-table-head')).toContainText(/Повт\./i)
  await expect(page.locator('.planned-set-number')).toHaveCount(2)
  await page.getByLabel('Вес, подход 2').fill('35')
  await page.getByLabel('Повторы, подход 2').fill('12')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()
  // Крупный таймер тренировки по центру над подходами, идущий от старта (мм:сс).
  await expect(page.locator('.live-timer')).toContainText(/\d\d:\d\d/)
  await expect(page.locator('.live-session-header .workout-status')).toHaveCount(1)
  await expect(page.locator('.live-exercise-head .workout-status')).toHaveCount(0)
  await expect(page.locator('.live-timer')).not.toHaveClass(/resting/)
  const neutralTimerBackground = await page.locator('.live-timer').evaluate((element) => getComputedStyle(element).backgroundColor)
  // Текущий подход раскрыт для ввода, следующий — компактной строкой.
  await expect(page.locator('.live-set-table')).toHaveCount(1)
  await expect(page.locator('.live-set-table > .live-set')).toHaveCount(1)
  await expect(page.locator('.live-set-table > .live-set-compact')).toHaveCount(1)
  const compactInputAction = page.getByRole('button', { name: 'Заполнить подход 2' })
  await expect(compactInputAction).toBeVisible()
  await expect(compactInputAction).toContainText('План 35 кг × 12 повт.')
  await expect(compactInputAction).toContainText('Заполнить')
  const compactActionStyle = await compactInputAction.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return { backgroundColor: style.backgroundColor, color: style.color, height: box.height, width: box.width }
  })
  expect(compactActionStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  const liveForeground = await page.locator('.phone-frame').evaluate((element) => getComputedStyle(element).color)
  expect(compactActionStyle.color).toBe(liveForeground)
  expect(compactActionStyle.height).toBeGreaterThanOrEqual(44)
  expect(compactActionStyle.width).toBeGreaterThan(200)
  const addSetBackground = await page.getByRole('button', { name: '＋ Подход' }).evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(addSetBackground).toBe('rgba(0, 0, 0, 0)')
  // Факт сразу начинается с плановых значений; тренер правит число напрямую.
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('40')
  await expect(page.getByLabel('Фактические повторы').first()).toHaveValue('10')
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.locator('.live-timer').click()
  await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Редактировать подход' })).toBeVisible()
  // Подтверждённый подход становится компактной строкой с зафиксированным фактом.
  await expect(page.locator('.live-set-compact.confirmed')).toContainText('42.5 кг')
  await expect(page.getByText(/Отдых 1:30/)).toBeVisible()
  await expect(page.locator('.live-timer')).toHaveClass(/resting/)
  await expect.poll(() => page.locator('.live-timer').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(neutralTimerBackground)
  // Отдых считается от абсолютного времени: через ~2 с значение должно уменьшиться.
  await expect(page.getByText(/Отдых 1:2\d/)).toBeVisible({ timeout: 4000 })
  // Дедлайн переживает reload: тренер может вернуться к live после перехода
  // или перезагрузки WebView, не теряя текущий отдых.
  await page.reload()
  await expect(page.getByText(/Отдых 1:2\d/)).toBeVisible()
  // Кнопка +15с продлевает текущий отдых.
  await page.getByRole('button', { name: 'Плюс 15 секунд' }).click()
  await expect(page.getByText(/Отдых 1:3\d/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await page.getByRole('button', { name: '＋ Подход' }).click()
  // Дождаться, пока добавленный подход подтянется (refetch завершён и version
  // актуальна), иначе следующая правка ловит конфликт оптимистичной блокировки.
  await expect(page.locator('.live-set-number', { hasText: '3' })).toBeVisible()
  // Быстрый переход к третьему подходу не теряет введённый факт второго:
  // строка сворачивается, но показывает только что сохранённые числа.
  await page.getByLabel('Фактический вес').first().fill('37.5')
  await page.getByLabel('Фактические повторы').first().fill('11')
  await page.getByRole('button', { name: 'Заполнить подход 3' }).click()
  await expect(page.locator('.live-set-compact.upcoming')).toContainText('Введено 37.5 кг × 11 повт.')
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Добавить: Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  // Есть незавершённые подходы → inline-подтверждение частичного завершения.
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  await expect(page.locator('.workout-completion')).toContainText('Подтверждено 1 из 4 подходов')
  await expect(page.locator('.workout-completion')).toContainText('Вернуться к клиенту')
  await expect(page.locator('.completed-exercise-list')).toBeVisible()
  await expect(page.locator('.completed-exercise').first()).toBeVisible()
  await expect(page.locator('.completed-exercise-block')).toHaveCount(0)
  // Завершённая тренировка показывает фактический результат (вес × повторы)
  // только по подтверждённым подходам, а не только название упражнения.
  await expect(page.locator('.completed-set-summary').filter({ hasText: /42\.5 кг × 9/ })).toBeVisible()
  // Неподтверждённые подходы показаны прочерками в их позиции: план за факт
  // не выдаётся, а порядок остаётся читаемым до раскрытия.
  await expect(page.locator('.completed-set-summary').filter({ hasText: '—' }).first()).toBeVisible()
  // Сводка завершённой тренировки: время, тоннаж, группы мышц.
  // Тоннаж считает только подтверждённый факт: 42.5×9 = 383 кг.
  await expect(page.locator('.workout-fact-summary')).toContainText('Тоннаж')
  await expect(page.locator('.workout-fact-summary')).toContainText('383 кг')

  // Завершённую тренировку можно исправить без возврата в live: редактор
  // открывает сохранённый факт; сохранение дополняет все подходы и статус
  // возвращается к полностью завершённой тренировке.
  await page.getByRole('link', { name: 'Изменить результат' }).click()
  await expect(page.getByLabel('Фактический вес, подход 1')).toHaveValue('42.5')
  await page.getByLabel('Фактический вес, подход 1').fill('45')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.locator('.workout-detail-page .workout-status-completed')).toHaveCount(0)
  await expect(page.locator('.completed-set-summary').filter({ hasText: /45 кг × 9/ }).first()).toBeVisible()

  // «Назад» с завершённой тренировки ведёт в расписание (все запланированные).
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()

  // После завершения тренировки статистика клиента обновлена.
  await page.goto(clientUrl)
  await expect(page.locator('.client-detail-activity')).toContainText('1 тренировка')
  await expect(page.locator('.client-detail-activity')).toContainText('100%')
  await expect(page.locator('.client-detail-vitals')).toContainText('ИМТ')

  // Новая тренировка подхватывает фактические значения всех подходов из
  // последнего завершённого выполнения этого упражнения.
  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, trainerAlias)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await expect(page.getByText('Последние у клиента')).toBeVisible()
  await expect(page.getByText('Разминка и мобилити')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Посмотреть технику: Болгарский присед \(Штанга\)/ })).toHaveCount(1)
  await page.getByLabel('Поиск упражнения').fill('Болгарский')
  await page.getByRole('button', { name: /Выбрать: Болгарский присед \(Штанга\)/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('45')
  await expect(page.getByLabel('Повторы, подход 1')).toHaveValue('9')
  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()

  // История и карточка используют один префикс ключа кэша, но разной формы —
  // переход туда-обратно не должен ронять приложение (регресс e.filter).
  await page.getByRole('link', { name: 'История тренировок', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировки клиента' })).toBeVisible()
  await expect(page.locator('.card').first()).toBeVisible()
  // На карточке истории — список упражнений (а не группы мышц) и тоннаж.
  await expect(page.locator('.cards .card').first()).toContainText('Болгарский присед')
  await expect(page.locator('.cards .card').first()).toContainText('45 кг × 9 повт.')
  const personalRecordCard = page.locator('.cards .card').first()
  await expect(personalRecordCard).toHaveClass(/has-pr/)
  await expect(personalRecordCard.locator('.workout-pr-badge')).toHaveText('Личный рекорд')
  await expect(personalRecordCard.locator('[data-icon="record"]')).toBeVisible()
  await expect(page.locator('.card-meta').first()).toContainText('1.2 т')
  await page.locator('.card').first().click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // Заходим в аналитику упражнения и возвращаемся: «назад» с упражнения ведёт
  // на тренировку, «назад» с тренировки — в расписание (без петли).
  await page.locator('.exercise-history-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  // После одной проведённой тренировки статистика показывает текущий результат.
  const progressProof = page.getByLabel('Доказательство прогресса')
  await expect(progressProof).toBeVisible()
  await expect(progressProof).toContainText('ПРОГРЕСС ПО УПРАЖНЕНИЮ')
  await expect(progressProof).toContainText('45 кг × 9 повт.')
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()

  // Прогресс открывается из карточки клиента, без отдельного списка-посредника.
  await page.goto(clientUrl)
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()
  await page.getByRole('link', { name: 'Прогресс и замеры' }).click()
  await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await page.getByLabel('Дата').fill('2026-07-20')
  await page.getByLabel('Вес, кг').fill('61')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  // История замеров свёрнута по умолчанию — разворачиваем, чтобы увидеть карточку.
  await page.getByRole('button', { name: /История ·/ }).click()
  await expect(page.getByText('61 кг')).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()
})

test('live: планка вводится в секундах, таймер закреплён, подтверждённый подход правится карандашом', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Планка Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('75')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Планка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Планка Клиент')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: 'Выбрать: Планка (Своё тело)', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  // Планка — точное время в секундах, а не вес или минуты.
  await expect(page.getByLabel('Время, сек, подход 1')).toBeVisible()
  await expect(page.getByLabel('Время, сек, подход 1')).toHaveAttribute('placeholder', 'сек')
  await page.getByLabel('Время, сек, подход 1').fill('60')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-set-table-head')).toContainText('Сек.')
  await expect(page.locator('.live-set-table-head')).not.toContainText('Кг')
  await expect(page.locator('.live-timer')).toContainText(/\d\d:\d\d/)
  // #3: закреплённый блок с таймером (и отдыхом) sticky — не уезжает при скролле.
  await expect(page.locator('.live-pinned')).toHaveCSS('position', 'sticky')
  // #6: подтверждаем подход, затем правим карандашом.
  await page.getByLabel('Фактическое время, сек').first().fill('75')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.locator('.live-exercise-collapsed').click()
  await expect(page.getByRole('button', { name: 'Редактировать подход' })).toBeVisible()
  await page.getByRole('button', { name: 'Редактировать подход' }).first().click()
  await expect(page.getByLabel('Фактическое время, сек').first()).toBeEnabled()
  await page.getByLabel('Фактическое время, сек').first().fill('90')
  await page.getByRole('button', { name: 'Сохранить' }).first().click()
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
})

test('план: порядок упражнений меняется в отдельном режиме и сохраняется', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Порядок Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Порядок Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Порядок Клиент')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const [index, q] of ['Присед со штангой', 'Жим лёжа'].entries()) {
    await page.getByRole('button', { name: index === 0 ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
    if (index === 0) await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.locator('.picker-select-mark').first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  // В обычном режиме стрелок нет: порядок включается из меню упражнения.
  await expect(page.getByRole('button', { name: 'Вверх' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Изменить порядок' }).click()
  await expect(page.getByText('Изменение порядка')).toBeVisible()
  // Первое «Вверх» задизейблено (граница), последнее «Вниз» — тоже.
  await expect(page.getByRole('button', { name: 'Вверх' }).first()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Вниз' }).last()).toBeDisabled()
  // Двигаем второе упражнение вверх → порядок меняется.
  await page.getByRole('button', { name: 'Вверх' }).nth(1).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // В просмотре первым идёт «Жим лёжа».
  await expect(page.locator('.cards .exercise strong').first()).toContainText('Жим лёжа')
})

test('live: порядок упражнений меняется в отдельном режиме', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Live Порядок')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Live Порядок' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Live Порядок')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const [index, q] of ['Присед со штангой', 'Жим лёжа'].entries()) {
    await page.getByRole('button', { name: index === 0 ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
    if (index === 0) await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.locator('.picker-select-mark').first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
    await page.getByLabel('Вес, подход 1').nth(index).fill(index === 0 ? '70' : '50')
    await page.getByLabel('Повторы, подход 1').nth(index).fill(index === 0 ? '8' : '10')
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  // В live рабочей остаётся только текущая карточка. Будущее упражнение —
  // компактный ориентир: название, ближайший план, число подходов и меню,
  // без таблицы подходов и RPE.
  const upcomingExercise = page.locator('.live-exercise-upcoming')
  await expect(upcomingExercise).toHaveCount(1)
  await expect(upcomingExercise).toContainText('Жим лёжа')
  await expect(upcomingExercise).toContainText('1 подход')
  await expect(upcomingExercise).toContainText('План: 50 кг × 10 повт.')
  await expect(upcomingExercise.locator('.workout-set-table')).toHaveCount(0)
  // В обычном live стрелок нет; включаем отдельный режим в меню упражнения.
  await expect(page.getByRole('button', { name: 'Вверх' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Изменить порядок' }).click()
  await expect(page.getByText('Изменение порядка')).toBeVisible()
  // Границы: первое «Вверх» и последнее «Вниз» задизейблены.
  await expect(page.getByRole('button', { name: 'Вверх' }).first()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Вниз' }).last()).toBeDisabled()
  // Первым идёт «Присед…», двигаем второе (Жим) вверх.
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Присед')
  // Подтверждаем подход первого упражнения: оно сворачивается, а второе
  // автоматически становится текущим и остаётся доступно для ручной перестановки.
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-exercise-collapsed')).toHaveCount(1)
  await expect(page.locator('.live-exercise.current .workout-set-table')).toHaveCount(1)
  await page.locator('.live-exercise.current').getByRole('button', { name: 'Вверх' }).click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Жим лёжа')
})

test('замена упражнения: в форме плана и в live', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Замена Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Замена Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Замена Клиент')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  // Добавляем «Присед», задаём подход.
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой (Штанга)', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('50')
  await page.getByLabel('Повторы, подход 1').fill('10')

  // Заменяем на «Жим лёжа» (тот же тип) — значения подхода сохраняются.
  // «Заменить» теперь в меню «⋯» (редкое действие вне постоянной видимости).
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Добавить: Жим лёжа/ }).first().click()
  await expect(page.locator('.exercise header strong').first()).toContainText('Жим лёжа')
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('50')

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Live: заменяем нетронутое упражнение на «Тяга верхнего блока».
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Жим лёжа')
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Тяга верхнего блока')
  await page.getByRole('button', { name: /Добавить: Тяга верхнего блока/ }).first().click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Тяга верхнего блока')
  // После подтверждения меню остаётся для редких действий, но «Заменить»
  // пропадает: начатое упражнение нельзя подменить другим.
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
  await page.locator('.live-exercise-collapsed').click()
  await page.getByRole('button', { name: 'Ещё действия' }).click()
  await expect(page.getByRole('menuitem', { name: 'Заменить' })).toHaveCount(0)
})

test('карточка упражнения: шапка с оборудованием/мышцами и табы', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Карточка Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Карточка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Карточка Клиент')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  // Импортированное упражнение с картинкой/оборудованием/мышцами.
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('тяга штанги в наклоне (штанга)')
  await page.locator('.picker-item').filter({ hasText: 'Тяга штанги в наклоне (Штанга)' }).first().locator('.picker-select-mark').click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Открываем карточку упражнения через отдельное действие «История».
  await page.getByRole('link', { name: /Тяга штанги в наклоне/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  // Шапка: оборудование и группы мышц из каталога.
  const detailExerciseImage = page.locator('.exercise-image-detail')
  await expect(detailExerciseImage.locator('img')).toHaveCSS('object-fit', 'contain')
  const detailExerciseImageBox = await detailExerciseImage.boundingBox()
  if (detailExerciseImageBox === null) throw new Error('Exercise image is not visible')
  // Linux Chromium can report one side with a tiny subpixel rounding delta.
  expect(Math.abs(detailExerciseImageBox.width - detailExerciseImageBox.height)).toBeLessThan(0.01)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('exercise-image-detail.png'), fullPage: true })
  await expect(page.getByText('Оборудование: Штанга')).toBeVisible()
  await expect(page.getByText(/Основная группа мышц:/)).toBeVisible()
  // Табы: Статистика (по умолчанию), История, Техника.
  await expect(page.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Техника' }).click()
  await expect(page.getByRole('tab', { name: 'Техника' })).toHaveAttribute('aria-selected', 'true')
  // Каталог остаётся статичным, а второй кадр загружается только в крупной
  // демонстрации техники.
  const techniqueImage = page.locator('.exercise-image-technique')
  await expect(techniqueImage.locator('img')).toHaveCount(2)
  await expect(techniqueImage).toHaveClass(/exercise-image-motion/)
  await expect(techniqueImage.locator('.exercise-image-frame-end')).not.toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(techniqueImage.locator('.exercise-image-frame-end')).toHaveCSS('animation-name', 'none')
  await expect(techniqueImage.locator('.exercise-image-frame-end')).toHaveCSS('opacity', '0')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const techniqueImageBox = await techniqueImage.boundingBox()
  if (techniqueImageBox === null) throw new Error('Technique image is not visible')
  expect(Math.abs(techniqueImageBox.width / techniqueImageBox.height - 1.5)).toBeLessThan(0.02)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('exercise-technique-390.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 430, height: 932 })
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  // Инструкции техники присутствуют (нумерованный список).
  await expect(page.locator('.how-steps li').first()).toBeVisible()
})

test('план: два упражнения объединяются в суперсет, тип виден в просмотре', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Суперсет Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Суперсет Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Суперсет Клиент')
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const [index, q] of ['Присед со штангой', 'Жим лёжа'].entries()) {
    await page.getByRole('button', { name: index === 0 ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
    if (index === 0) await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.locator('.picker-select-mark').first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  // Объединяем первое упражнение со следующим в блок → появляется селектор типа.
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Объединить со следующим в блок' }).click()
  await expect(page.getByLabel('Тип блока')).toBeVisible()
  await expect(page.getByLabel('Тип блока')).toHaveValue('set')
  await expect(page.locator('.block-options')).not.toHaveAttribute('open', '')
  // Задаём 2 круга → форма раскладывается по кругам: «Круг 1» и «Круг 2»,
  // каждый содержит оба упражнения; кнопки «＋ Подход» внутри блока нет.
  await page.getByLabel('Кругов').fill('2')
  await expect(page.locator('.planned-round')).toHaveCount(2)
  await expect(page.locator('.planned-round').first().locator('.planned-round-exercise-name')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '＋ Подход' })).toHaveCount(0)
  // «Кругов» стирается курсором (Backspace до пустого), а не только заменой
  // выделенного — регресс контролируемого поля, «возвращавшего» старое число.
  await page.getByLabel('Кругов').click()
  await page.getByLabel('Кругов').press('End')
  await page.getByLabel('Кругов').press('Backspace')
  await expect(page.getByLabel('Кругов')).toHaveValue('')
  await page.getByLabel('Кругов').type('2')
  await expect(page.locator('.planned-round')).toHaveCount(2)
  // В каждом подходе есть план: в live его можно быстро подтвердить без
  // отдельного ручного ввода факта. Полностью пустые подходы не подтверждаются.
  for (let index = 0; index < 2; index += 1) {
    await page.getByLabel('Вес, подход 1').nth(index).fill('40')
    await page.getByLabel('Повторы, подход 1').nth(index).fill('10')
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // В просмотре тренировки виден бейдж «Сет · 2 кр.».
  await expect(page.locator('.block-badge').first()).toContainText('Сет · 2 кр.')

  // Live идёт по кругам: круг 1 (упр.A → упр.B), потом круг 2. Счётчик показывает
  // текущий круг; отдых — после завершения круга (последнего упражнения круга).
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  // Счётчик круга закреплён с таймером (.live-pinned) и продублирован в шапке
  // блока — проверяем закреплённый (всегда виден при скролле по кругам).
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 1 из 2')
  // Первое упражнение круга 1 — отдых НЕ запускается (круг ещё не завершён).
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Редактировать подход' })).toHaveCount(1)
  await expect(page.getByText(/Отдых/)).toHaveCount(0)
  // Второе (последнее) упражнение круга 1 — круг завершён, отдых запускается,
  // счётчик переключается на «Круг 2 из 2».
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByText(/Отдых/)).toBeVisible()
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 2 из 2')
  // Подсветка: круг 1 закрыт (зелёный, done), круг 2 в работе (серый, current).
  await expect(page.locator('.circuit-round').nth(0)).toHaveClass(/done/)
  await expect(page.locator('.circuit-round').nth(1)).toHaveClass(/current/)

  // Круг 2: упр.A → отдыха нет; упр.B — последнее упражнение последнего круга,
  // блок завершён → отдых НЕ запускается (регресс: раньше запускался лишний).
  await page.getByRole('button', { name: 'Пропустить' }).click()
  // Берём кнопки именно из текущего круга. На странице остаются disabled-кнопки
  // уже завершённого круга, поэтому глобальный `.first()` иногда выбирал их,
  // а клик уходил в закреплённую нижнюю панель.
  const currentRound = page.locator('.circuit-round.current')
  const currentRoundConfirm = currentRound.getByRole('button', { name: 'Готово, отдых' })
  await expect(currentRoundConfirm).toHaveCount(2)
  await expect(currentRoundConfirm.first()).toBeEnabled()
  await currentRoundConfirm.first().click()
  await expect(currentRoundConfirm.last()).toBeEnabled()
  await currentRoundConfirm.last().click()
  await expect(page.getByText(/Отдых/)).toHaveCount(0)
})

test('profile Cancel resets unsaved edits', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  // В новом стартовом маршруте профиль открывается из аватара, а не из таббара.
  // Прямой переход исключает зависимость настройки профиля от структуры навигации.
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  const firstName = page.getByLabel('Имя')
  const original = await firstName.inputValue()
  await firstName.fill('Черновик Который Отменим')
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(firstName).toHaveValue(original)

  const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
  await expect(darkTheme).not.toBeChecked()
  await darkTheme.check()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
  // Preview trainer Profile owns the accepted dark shell color; flag-off
  // accounts continue to receive the legacy theme metadata.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111214')

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Тёмная тема' })).toBeChecked()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
})

test('schedule shows week strip and hour grid with day/week navigation', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Расписание' })).toBeVisible()
  await expect(page.locator('.schedule-selected-date')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()

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

test('расписание: тренировка без времени остаётся видимой после фокуса часовой сетки', async ({ page }, testInfo) => {
  const clientName = `Без времени ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  await page.goto('/schedule')
  await page.locator('a[href^="/workouts/new?date="]').click()
  await selectClient(page, clientName)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой (Штанга)', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.goto('/schedule')
  const untimed = page.locator('.schedule-untimed-section')
  await expect(untimed).toBeVisible()
  await expect(untimed.getByText('Без времени', { exact: true })).toBeVisible()
  await expect(untimed).toContainText(clientName)
  await expect(untimed).toContainText('Присед со штангой')
  await page.locator('.day-grid-scroll').evaluate((scroller) => { scroller.scrollTop = 480 })
  const placement = await untimed.evaluate((section) => {
    const scroller = document.querySelector<HTMLElement>('.day-grid-scroll')
    if (!scroller) return null
    const sectionRect = section.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    return {
      beforeScroller: sectionRect.bottom <= scrollerRect.top + 1,
      gridWasScrolled: scroller.scrollTop > 0,
    }
  })
  expect(placement).toEqual({ beforeScroller: true, gridWasScrolled: true })
})

test('расписание: создание тренировки из расписания с датой выбранного дня', async ({ page }, testInfo) => {
  const clientName = `Расписание ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  // Идём в расписание и создаём тренировку прямо оттуда.
  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Запланировать' }).click()
  // Форма открылась; дата предзаполнена (не пустая), клиента выбираем.
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await expect(page.getByLabel('Дата')).not.toHaveValue('')
  await selectClient(page, clientName)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой (Штанга)', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
})

test('расписание: отмена создания возвращает к выбранному дню', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  const selectedDay = page.locator('.week-day').nth(1)
  await selectedDay.click()
  const selectedNumber = await selectedDay.locator('.day-num').innerText()
  await page.getByRole('link', { name: 'Запланировать' }).click()
  const selectedDate = await page.getByLabel('Дата').inputValue()
  await page.getByRole('button', { name: 'Назад' }).click()

  await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`date=${selectedDate}`))
  await expect(page.locator('.week-day.active .day-num')).toHaveText(selectedNumber)
})

test('расписание: карточка события — время, имя клиента, до двух упражнений', async ({ page }, testInfo) => {
  const clientName = `Карточка ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await page.getByRole('link', { name: 'Запланировать' }).click()
  await selectClient(page, clientName)
  await page.getByLabel('Начало').fill('09:00')
  // Три упражнения — на карточке должны показаться два названия и счётчик остатка.
  for (const [index, q] of ['присед со штангой', 'жим ногами', 'подтягивания'].entries()) {
    await page.getByRole('button', { name: index === 0 ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
    if (index === 0) await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.locator('.picker-select-mark').first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Навигация таббара проверяется отдельно; здесь фиксируем только
  // отображение только что созданного события в расписании.
  await page.goto('/schedule')
  await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
  const card = page.locator('.day-grid-event').filter({ hasText: clientName })
  await expect(card.locator('.day-grid-event-time')).toHaveText('09:00')
  await expect(card.locator('.day-grid-event-name')).toHaveText(clientName)
  // Время и имя — в одной строке (общий контейнер .day-grid-event-top).
  await expect(card.locator('.day-grid-event-top .day-grid-event-name')).toBeVisible()
  // Упражнения собраны в одну компактную строку: два названия и счётчик остатка.
  const summary = card.locator('.day-grid-event-summary')
  await expect(summary).toContainText('Присед со штангой')
  await expect(summary).toContainText('Жим ногами')
  await expect(summary).toContainText('ещё 1')
  await expect(summary).not.toContainText('Подтягивания')
})

test('комментарий тренера к упражнению: план → live → история', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Коммент Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Коммент Клиент' })).toBeVisible()
  const commentClientUrl = page.url()
  const commentClientId = commentClientUrl.split('/').at(-1)!

  await page.getByRole('link', { name: /Запланировать/ }).click()
  // Имя может повторяться между параллельными/прошлыми прогонами; выбираем
  // ровно созданного клиента по value, а не по видимой подписи.
  await selectClient(page, 'Коммент Клиент', commentClientId)
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой (Штанга)', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('90')
  await page.getByLabel('Повторы, подход 1').fill('8')
  // Комментарий тренера к упражнению в форме плана.
  await page.locator('.planned-exercise').getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Настройки упражнения' }).click()
  await page.getByLabel('Комментарий к упражнению').fill('Держи спину прямо')
  await page.getByRole('button', { name: 'Готово' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // В live заметка не занимает место до явного раскрытия, но сохранённый текст
  // остаётся доступен для правки.
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  const liveNote = page.locator('.live-exercise-note').first()
  await expect(liveNote.locator('summary')).toContainText('Заметка тренера')
  await expect(liveNote).not.toHaveAttribute('open')
  await expect(page.getByLabel(/Комментарий: Присед/)).not.toBeVisible()
  await liveNote.locator('summary').click()
  await expect(page.getByLabel(/Комментарий: Присед/)).toBeVisible()
  await page.getByLabel('Фактический вес').first().fill('92.5')
  await page.getByLabel('Фактические повторы').first().fill('8')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  // Ждём, пока подход реально подтвердится (RPC), иначе «Завершить» словит
  // подтверждение частичного завершения (window.confirm) и не сработает.
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Комментарий виден в истории упражнения.
  await page.locator('.exercise-history-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await page.getByRole('tab', { name: 'История' }).click()
  await expect(page.getByText('💬 Держи спину прямо', { exact: true }).first()).toBeVisible()

  // Комментарий виден и в карточке истории тренировок клиента (список упр.).
  // В параллельных прогонах уже могут существовать одноимённые клиенты, поэтому
  // возвращаемся в только что созданную карточку по её точному URL, а не по
  // первому совпавшему тексту из списка.
  await page.goto(commentClientUrl)
  await expect(page.getByRole('heading', { name: 'Коммент Клиент' })).toBeVisible()
  await page.getByRole('link', { name: 'История тренировок', exact: true }).click()
  // Дожидаемся, что история клиента открылась и список подгрузился (не «Загрузка…»),
  // потом ищем карточку/коммент. Явный timeout переживает холодный кэш запроса
  // list_workouts под нагрузкой (иначе .card ловил таймаут до ответа RPC).
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+\/workouts$/)
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.workout-exercise-comment').first()).toContainText('Держи спину прямо')
})

test('live: удаление подхода и наследование факта при добавлении', async ({ page }, testInfo) => {
  const clientName = `Сет Клиент ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
  const clientId = page.url().split('/').at(-1)!

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, clientName, clientId)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.locator('.picker-select-mark').first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('90')
  await page.getByLabel('Повторы, подход 1').fill('8')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()

  // Подтверждаем факт 92.5×8.
  await page.getByLabel('Фактический вес').first().fill('92.5')
  await page.getByLabel('Фактические повторы').first().fill('8')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.locator('.live-exercise-collapsed').click()
  await expect(page.getByRole('button', { name: 'Редактировать подход' }).first()).toBeVisible()

  // Правка подтверждённого подхода: 100×10 — значение должно сохраниться на экране.
  await page.getByRole('button', { name: 'Редактировать подход' }).first().click()
  await page.getByLabel('Фактический вес').first().fill('100')
  await page.getByLabel('Фактические повторы').first().fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).first().click()
  await page.locator('.live-exercise-collapsed').click()
  await expect(page.locator('.live-set-compact.confirmed')).toContainText('100 кг')
  await page.reload()
  await page.locator('.live-exercise-collapsed').click()
  await expect(page.locator('.live-set-compact.confirmed')).toContainText('100 кг × 10 повт.')

  // Параллельная правка возвращает бизнес-конфликт: live перечитывает сервер,
  // объясняет результат и не делает blind overwrite. Повтор уже с новой
  // версией проходит штатно.
  let rejectAppendAsStale = true
  await page.route('**/rest/v1/rpc/append_live_set', async (route) => {
    if (!rejectAppendAsStale) { await route.continue(); return }
    rejectAppendAsStale = false
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PT409', details: null, hint: null, message: 'workout_conflict' }),
    })
  })
  await page.getByRole('button', { name: '＋ Подход' }).first().click()
  await expect(page.getByText(/Тренировка изменилась в другом окне/)).toBeVisible()
  await page.getByRole('button', { name: '＋ Подход' }).first().click()
  await page.unroute('**/rest/v1/rpc/append_live_set')

  // Добавленный подход наследует факт (100), а не план (90).
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('100')

  // Если ответ autosave потерялся из-за сети, введённый факт остаётся на
  // устройстве и восстанавливается после reload для безопасного повтора.
  await page.route('**/rest/v1/rpc/save_live_set_draft', (route) => route.abort('failed'))
  await page.getByLabel('Фактический вес').first().fill('105')
  await page.locator('.live-timer').click()
  await expect(page.locator('.error').filter({ hasText: 'Ответ сервера не получен' })).toBeVisible()
  await page.unroute('**/rest/v1/rpc/save_live_set_draft')
  await page.reload()
  await expect(page.getByText(/Восстановили несохранённые данные/)).toBeVisible()
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('105')

  // Удаляем добавленный подход — остаётся один. Подтверждаем через in-app
  // confirm (useConfirm), а не нативный window.confirm.
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Удалить подход' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.exercise')).toHaveCount(1)
})

test('live: «Готово» без ввода факта — подход считается выполненным по плану', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Готово Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Готово Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await selectClient(page, 'Готово Клиент')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.locator('.picker-select-mark').first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('100')
  await page.getByLabel('Повторы, подход 1').fill('5')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  // Не вводим факт — сразу «Готово»: план должен стать фактом.
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // В завершённой тренировке подход выполнен по плану, без пометки «не выполнено».
  await expect(page.getByText('не выполнено')).toHaveCount(0)
  await expect(page.locator('main')).toContainText('100 кг')
})
