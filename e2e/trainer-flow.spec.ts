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

test('форма: быстрый ввод разбирает текст в упражнения и подходы', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.goto('/workouts/new')
  // Таббар остаётся доступен, заметка не занимает экран до явного раскрытия,
  // а быстрый ввод упражнений открыт сразу.
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Заметка' })).toBeHidden()
  await page.locator('.workout-notes summary').click()
  await expect(page.getByRole('textbox', { name: 'Заметка' })).toBeVisible()
  await page.getByLabel('Клиент').selectOption({ label: 'Анна Смирнова' })
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
  await page.getByRole('button', { name: 'Добавить распознанные (2)' }).click()
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('80')
  await expect(page.getByLabel('Вес, подход 2')).toHaveValue('85')
  await expect(page.getByLabel('Повторы, подход 3')).toHaveValue('5')
  await expect(page.getByRole('article').filter({ hasText: 'Присед со штангой' }).getByLabel('Целевой RPE, подход 1')).toHaveValue('8')
  await expect(page.getByLabel('Время, сек, подход 3')).toHaveValue('45')
  await page.getByRole('button', { name: 'Отмена' }).click()
})

test('стартовый экран показывает точный результат автоматического распознавания до сохранения', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.goto('/today')
  await mockWorkoutParser(page, [{ sourceText: 'Жим гантелей на наклон 3×8 24 кг', exerciseRef: 'fedb-incline-dumbbell-press', confidence: 1, sets: [{ weightKg: 24, reps: 8 }, { weightKg: 24, reps: 8 }, { weightKg: 24, reps: 8 }] }])
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
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

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

  await page.getByRole('link', { name: 'Редактировать профиль' }).click()
  await page.getByLabel('Имя', { exact: true }).fill(trainerAlias)
  await page.getByLabel('Имя в моём списке').fill(trainerAlias)
  await page.getByLabel('Личная заметка').fill('Моя приватная заметка')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()
  await page.goto('/clients')
  await expect(page.getByText(trainerAlias)).toBeVisible()
  await page.goto(clientUrl)

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: trainerAlias })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await expect(page.getByRole('button', { name: /Присед со штангой/ }).first()).toBeVisible()
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
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click()
  await page.getByRole('button', { name: 'Фильтры' }).click()
  await page.getByLabel('Поиск упражнения').fill('Болгарский')
  await expect(page.getByText(/Найдено: \d+/)).toBeVisible()
  await expect(page.getByLabel('Группа мышц')).toBeHidden()
  await expect(page).toHaveScreenshot('exercise-picker-search-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05, mask: [page.locator('.picker-list')] })
  await page.getByRole('button', { name: /Болгарский присед/ }).click()
  await expect(page.getByText('Выбрано: 1')).toBeVisible()
  await expect(page).toHaveScreenshot('exercise-picker-selected-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05, mask: [page.locator('.picker-list')] })
  await page.getByRole('button', { name: 'Добавить 1' }).click()
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
  await expect(page.locator('.live-timer-big')).toContainText(/\d\d:\d\d/)
  // Подходи — компактные строки единого упражнения, не самостоятельные карточки.
  await expect(page.locator('.live-exercise > .live-set')).toHaveCount(2)
  await expect(page.locator('.live-exercise > .live-set > .live-set-grid')).toHaveCount(2)
  await expect(page.locator('.live-exercise > .live-set').nth(1)).toHaveCSS('border-top-width', '1px')
  // Пока факт пуст, ± начинает от плана, а не от нуля.
  await page.getByRole('button', { name: 'Добавить вес' }).first().click()
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('42.5')
  await page.getByRole('button', { name: 'Убавить повторы' }).first().click()
  await expect(page.getByLabel('Фактические повторы').first()).toHaveValue('9')
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.locator('.live-timer-big').click()
  await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  // Подтверждённый подход показывает зафиксированные значения ярко (не placeholder):
  // поле веса заблокировано и содержит реальное значение 42.5.
  await expect(page.locator('.set-row.locked input').first()).toHaveValue('42.5')
  await expect(page.locator('.set-row.locked input').first()).toBeDisabled()
  await expect(page.getByText(/Отдых 1:30/)).toBeVisible()
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
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  // Есть незавершённые подходы → inline-подтверждение частичного завершения.
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByText('Готово', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.workout-completion')).toContainText('Выполнено 1 из 4 подходов')
  // Завершённая тренировка показывает фактический результат (вес × повторы)
  // только по подтверждённым подходам, а не только название упражнения.
  await expect(page.getByText(/42\.5 кг × 9 повт\./)).toBeVisible()
  // Неподтверждённые подходы (план без факта) помечены «не выполнено», план
  // за факт не выдаётся.
  await expect(page.locator('.workout-history-set.missed .plan-note').first()).toContainText('не выполнено')
  // Сводка завершённой тренировки: время, тоннаж, группы мышц.
  // Тоннаж считает только подтверждённый факт: 42.5×9 = 383 кг.
  await expect(page.locator('.done-summary-3')).toContainText('Тоннаж')
  await expect(page.locator('.done-summary-3')).toContainText('383 кг')

  // Завершённую тренировку можно исправить без возврата в live: редактор
  // открывает сохранённый факт, а после сохранения статус остаётся «Готово».
  await page.getByRole('link', { name: 'Изменить результат' }).click()
  await expect(page.getByLabel('Фактический вес, подход 1')).toHaveValue('42.5')
  await page.getByLabel('Фактический вес, подход 1').fill('45')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.getByText('Готово', { exact: true })).toBeVisible()
  await expect(page.getByText(/45 кг × 9 повт\./)).toBeVisible()

  // «Назад» с завершённой тренировки ведёт в расписание (все запланированные).
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()

  // После завершения тренировки статистика клиента обновлена.
  await page.goto(clientUrl)
  await expect(page.getByText('Тренировок', { exact: true })).toBeVisible()
  await expect(page.locator('.summary.stats')).toContainText('1')
  await expect(page.locator('.summary.stats')).toContainText('100%')
  // Вместо «Последней» на карточке показываем ИМТ.
  await expect(page.locator('.summary.stats')).toContainText('ИМТ')

  // Новая тренировка подхватывает фактические значения всех подходов из
  // последнего завершённого выполнения этого упражнения.
  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: trainerAlias })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Болгарский')
  await page.getByRole('button', { name: /Болгарский присед/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('45')
  await expect(page.getByLabel('Повторы, подход 1')).toHaveValue('9')
  await expect(page.getByText(/Значения с тренировки/)).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()

  // История и карточка используют один префикс ключа кэша, но разной формы —
  // переход туда-обратно не должен ронять приложение (регресс e.filter).
  await page.getByRole('link', { name: 'История', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'История тренировок' })).toBeVisible()
  await expect(page.locator('.card').first()).toBeVisible()
  // На карточке истории — список упражнений (а не группы мышц) и тоннаж.
  await expect(page.locator('.cards .card').first()).toContainText('Болгарский присед')
  await expect(page.locator('.card-meta').first()).toContainText('1.2 т')
  await page.locator('.card').first().click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // Заходим в аналитику упражнения и возвращаемся: «назад» с упражнения ведёт
  // на тренировку, «назад» с тренировки — в расписание (без петли).
  await page.locator('.exercise-name-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  // После одной проведённой тренировки статистика показывает текущий результат.
  await expect(page.locator('.stat-single')).toContainText('Текущий результат')
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()

  // Прогресс сохраняем из карточки клиента («Замеры и аналитика»).
  await page.goto(clientUrl)
  await expect(page.getByRole('heading', { name: trainerAlias })).toBeVisible()
  await page.getByRole('link', { name: 'Замеры и аналитика' }).click()
  await page.getByLabel('Дата').fill('2026-07-20')
  await page.getByLabel('Вес, кг').fill('61')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  // История замеров свёрнута по умолчанию — разворачиваем, чтобы увидеть карточку.
  await page.getByRole('button', { name: 'Показать' }).click()
  await expect(page.getByText('61 кг')).toBeVisible()
})

test('live: планка вводится в секундах, таймер закреплён, подтверждённый подход правится карандашом', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Планка Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('75')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Планка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Планка Клиент' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: /^Планка/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  // Планка — точное время в секундах, а не вес или минуты.
  await expect(page.getByLabel('Время, сек, подход 1')).toBeVisible()
  await expect(page.getByLabel('Время, сек, подход 1')).toHaveAttribute('placeholder', 'сек')
  await page.getByLabel('Время, сек, подход 1').fill('60')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toContainText(/\d\d:\d\d/)
  // #3: закреплённый блок с таймером (и отдыхом) sticky — не уезжает при скролле.
  await expect(page.locator('.live-pinned')).toHaveCSS('position', 'sticky')
  // #6: подтверждаем подход, затем правим карандашом.
  await page.getByLabel('Фактическое время, сек').first().fill('75')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  await expect(page.getByLabel('Фактическое время, сек').first()).toBeDisabled()
  await page.getByRole('button', { name: 'Редактировать подход' }).first().click()
  await expect(page.getByLabel('Фактическое время, сек').first()).toBeEnabled()
  await page.getByLabel('Фактическое время, сек').first().fill('90')
  await page.getByRole('button', { name: 'Сохранить' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
})

test('план: порядок упражнений меняется в отдельном режиме и сохраняется', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Порядок Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Порядок Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Порядок Клиент' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
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
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Live Порядок')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Live Порядок' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Live Порядок' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
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
  // Подтверждаем подход первого упражнения — двигать завершённые блоки можно.
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.getByRole('button', { name: 'Вверх' }).nth(1).click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Жим лёжа')
})

test('замена упражнения: в форме плана и в live', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Замена Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Замена Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Замена Клиент' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  // Добавляем «Присед», задаём подход.
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('50')
  await page.getByLabel('Повторы, подход 1').fill('10')

  // Заменяем на «Жим лёжа» (тот же тип) — значения подхода сохраняются.
  // «Заменить» теперь в меню «⋯» (редкое действие вне постоянной видимости).
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await expect(page.locator('.exercise header strong').first()).toContainText('Жим лёжа')
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('50')

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Live: заменяем нетронутое упражнение на «Тяга верхнего блока».
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Жим лёжа')
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Тяга верхнего блока')
  await page.getByRole('button', { name: /Тяга верхнего блока/ }).first().click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Тяга верхнего блока')
  // После подтверждения подхода «⋯»-меню упражнения пропадает (заменять начатое нельзя).
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Ещё действия' })).toHaveCount(0)
})

test('карточка упражнения: шапка с оборудованием/мышцами и табы', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Карточка Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Карточка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Карточка Клиент' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  // Импортированное упражнение с картинкой/оборудованием/мышцами.
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('тяга штанги в наклоне (штанга)')
  await page.getByRole('button', { name: /Тяга штанги в наклоне \(Штанга\)/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Открываем карточку упражнения через ссылку «↗ история».
  await page.getByRole('link', { name: /Тяга штанги в наклоне/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  // Шапка: оборудование и группы мышц из каталога.
  await expect(page.getByText('Оборудование: Штанга')).toBeVisible()
  await expect(page.getByText(/Основная группа мышц:/)).toBeVisible()
  // Табы: Статистика (по умолчанию), История, Техника.
  await expect(page.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Техника' }).click()
  await expect(page.getByRole('tab', { name: 'Техника' })).toHaveAttribute('aria-selected', 'true')
  // Инструкции техники присутствуют (нумерованный список).
  await expect(page.locator('.how-steps li').first()).toBeVisible()
})

test('план: два упражнения объединяются в суперсет, тип виден в просмотре', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Суперсет Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Суперсет Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Суперсет Клиент' })
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  // Объединяем первое упражнение со следующим в блок → появляется селектор типа.
  await page.getByRole('button', { name: /Объединить со следующим/ }).first().click()
  await expect(page.getByLabel('Тип блока')).toBeVisible()
  await expect(page.getByLabel('Тип блока')).toHaveValue('set')
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
  await expect(page.locator('.live-timer-big')).toBeVisible()
  // Счётчик круга закреплён с таймером (.live-pinned) и продублирован в шапке
  // блока — проверяем закреплённый (всегда виден при скролле по кругам).
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 1 из 2')
  // Первое упражнение круга 1 — отдых НЕ запускается (круг ещё не завершён).
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toHaveCount(1)
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
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Профиль', exact: true }).click()
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#15131a')

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Тёмная тема' })).toBeChecked()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
})

test('schedule shows week strip and hour grid with day/week navigation', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  // Заголовок «Расписание» намеренно скрыт (sr-only) — он дублирует таб-бар;
  // признак экрана — счётчик тренировок и недельная лента.
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

test('расписание: создание тренировки из расписания с датой выбранного дня', async ({ page }, testInfo) => {
  const clientName = `Расписание ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  // Идём в расписание и создаём тренировку прямо оттуда.
  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await expect(page.locator('.schedule-count')).toBeVisible()
  await page.getByRole('link', { name: 'Новая тренировка' }).click()
  // Форма открылась; дата предзаполнена (не пустая), клиента выбираем.
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await expect(page.getByLabel('Дата')).not.toHaveValue('')
  await page.getByLabel('Клиент').selectOption({ label: clientName })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
})

test('расписание: отмена создания возвращает к выбранному дню', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  const selectedDay = page.locator('.week-day').nth(1)
  await selectedDay.click()
  const selectedNumber = await selectedDay.locator('.day-num').innerText()
  await page.getByRole('link', { name: 'Новая тренировка' }).click()
  const selectedDate = await page.getByLabel('Дата').inputValue()
  await page.getByRole('button', { name: 'Отмена' }).click()

  await expect(page.locator('.schedule-count')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`date=${selectedDate}`))
  await expect(page.locator('.week-day.active .day-num')).toHaveText(selectedNumber)
})

test('расписание: карточка события — время, имя клиента, до двух упражнений', async ({ page }, testInfo) => {
  const clientName = `Карточка ${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill(clientName)
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await page.getByRole('link', { name: 'Новая тренировка' }).click()
  await page.getByLabel('Клиент').selectOption({ label: clientName })
  await page.getByLabel('Время').fill('09:00')
  // Три упражнения — на карточке должны показаться максимум два и « …».
  for (const q of ['присед со штангой', 'жим ногами', 'подтягивания']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.locator('.picker-item').first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Навигация таббара проверяется отдельно; здесь фиксируем только
  // отображение только что созданного события в расписании.
  await page.goto('/schedule')
  await expect(page.locator('.schedule-count')).toBeVisible()
  const card = page.locator('.day-grid-event').filter({ hasText: clientName })
  await expect(card.locator('.day-grid-event-time')).toHaveText('09:00')
  await expect(card.locator('.day-grid-event-name')).toHaveText(clientName)
  // Время и имя — в одной строке (общий контейнер .day-grid-event-top).
  await expect(card.locator('.day-grid-event-top .day-grid-event-name')).toBeVisible()
  // Упражнения — отдельными строками (до двух), третье свёрнуто в « … ».
  const exercises = card.locator('.day-grid-event-exercise')
  await expect(exercises).toHaveCount(3)
  await expect(exercises.last()).toHaveText('…')
  await expect(card.locator('.day-grid-event-groups')).not.toContainText('Подтягивания')
})

test('комментарий тренера к упражнению: план → live → история', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

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
  await page.getByLabel('Клиент').selectOption(commentClientId)
  await expect(page.locator('.workout-notes summary')).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('90')
  await page.getByLabel('Повторы, подход 1').fill('8')
  // Комментарий тренера к упражнению в форме плана.
  await page.getByText('Заметка тренера', { exact: true }).click()
  await page.getByLabel('Комментарий к упражнению').fill('Держи спину прямо')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // В live заметка компактна и раскрывается по нажатию.
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
  await expect(page.getByLabel(/Комментарий: Присед/)).toBeHidden()
  await page.getByText('Заметка тренера', { exact: true }).click()
  await expect(page.getByLabel(/Комментарий: Присед/)).toBeVisible()
  await page.getByLabel('Фактический вес').first().fill('92.5')
  await page.getByLabel('Фактические повторы').first().fill('8')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  // Ждём, пока подход реально подтвердится (RPC), иначе «Завершить» словит
  // подтверждение частичного завершения (window.confirm) и не сработает.
  await expect(page.getByRole('button', { name: 'Подтверждено' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Комментарий виден в истории упражнения.
  await page.locator('.exercise-name-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await page.getByRole('tab', { name: 'История' }).click()
  await expect(page.getByText('💬 Держи спину прямо', { exact: true }).first()).toBeVisible()

  // Комментарий виден и в карточке истории тренировок клиента (список упр.).
  // В параллельных прогонах уже могут существовать одноимённые клиенты, поэтому
  // возвращаемся в только что созданную карточку по её точному URL, а не по
  // первому совпавшему тексту из списка.
  await page.goto(commentClientUrl)
  await expect(page.getByRole('heading', { name: 'Коммент Клиент' })).toBeVisible()
  await page.getByRole('link', { name: 'История', exact: true }).click()
  // Дожидаемся, что история клиента открылась и список подгрузился (не «Загрузка…»),
  // потом ищем карточку/коммент. Явный timeout переживает холодный кэш запроса
  // list_workouts под нагрузкой (иначе .card ловил таймаут до ответа RPC).
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+\/workouts$/)
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.workout-exercise-comment').first()).toContainText('Держи спину прямо')
})

test('live: удаление подхода и наследование факта при добавлении', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Сет Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Сет Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Сет Клиент' })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.locator('.picker-item').first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('90')
  await page.getByLabel('Повторы, подход 1').fill('8')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()

  // Подтверждаем факт 92.5×8.
  await page.getByLabel('Фактический вес').first().fill('92.5')
  await page.getByLabel('Фактические повторы').first().fill('8')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' }).first()).toBeVisible()

  // Правка подтверждённого подхода: 100×10 — значение должно сохраниться на экране.
  await page.getByRole('button', { name: 'Редактировать подход' }).first().click()
  await page.getByLabel('Фактический вес').first().fill('100')
  await page.getByLabel('Фактические повторы').first().fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).first().click()
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('100')

  // Добавляем подход — наследует факт (100), а не план (90).
  await page.getByRole('button', { name: '＋ Подход' }).first().click()
  await expect(page.getByLabel('Фактический вес').nth(1)).toHaveAttribute('placeholder', '100 кг')

  // Удаляем добавленный подход — остаётся один. Подтверждаем через in-app
  // confirm (useConfirm), а не нативный window.confirm.
  await page.getByRole('button', { name: 'Удалить подход' }).nth(1).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.exercise')).toHaveCount(1)
})

test('live: «Готово» без ввода факта — подход считается выполненным по плану', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Готово Клиент')
  await fillNewClientProfile(page)
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Готово Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Готово Клиент' })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.locator('.picker-item').first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('100')
  await page.getByLabel('Повторы, подход 1').fill('5')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
  // Не вводим факт — сразу «Готово»: план должен стать фактом.
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // В завершённой тренировке подход выполнен по плану, без пометки «не выполнено».
  await expect(page.getByText('не выполнено')).toHaveCount(0)
  await expect(page.locator('main')).toContainText('100 кг')
})
