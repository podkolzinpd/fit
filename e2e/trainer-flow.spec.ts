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
  // Список упражнений маскируем: миниатюры-фото волатильны и различаются по ОС.
  // Под визуальным контролем — «хром» пикера (шапка, поиск, категории).
  await expect(page).toHaveScreenshot('exercise-picker-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03, mask: [page.locator('.picker-list')] })
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
  // Завершённая тренировка показывает фактический результат (вес × повторы)
  // только по подтверждённым подходам, а не только название упражнения.
  await expect(page.getByText(/42\.5 кг × 9 повт\./)).toBeVisible()
  // Неподтверждённые подходы (план без факта) помечены «не выполнено», план
  // за факт не выдаётся.
  await expect(page.locator('.plan-note').first()).toContainText('не выполнено')
  // Сводка завершённой тренировки: время, тоннаж, группы мышц.
  // Тоннаж: факт 42.5×9 + план 35×12 (п2) + план 35×12 (п3, унаследован live «＋ Подход») ≈ 1.2 т.
  await expect(page.locator('.done-summary-3')).toContainText('Тоннаж')
  await expect(page.locator('.done-summary-3')).toContainText('1.2 т')

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
  await expect(page.getByRole('heading', { name: 'Анна Тестова' })).toBeVisible()
  await page.getByRole('link', { name: 'Замеры и аналитика' }).click()
  await page.getByLabel('Дата').fill('2026-07-20')
  await page.getByLabel('Вес, кг').fill('61')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  // История замеров свёрнута по умолчанию — разворачиваем, чтобы увидеть карточку.
  await page.getByRole('button', { name: 'Показать' }).click()
  await expect(page.getByText('61 кг')).toBeVisible()
})

test('live: планка вводится в минутах, таймер закреплён, подтверждённый подход правится карандашом', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Планка Клиент')
  await page.getByLabel('Начальный вес, кг').fill('75')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Планка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Планка Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: /^Планка/ }).click()
  // #4: планка — время (мин), а не вес (кг).
  await expect(page.getByLabel('Время, подход 1')).toBeVisible()
  await expect(page.getByLabel('Время, подход 1')).toHaveAttribute('placeholder', 'мин')
  await page.getByLabel('Время, подход 1').fill('1')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toContainText(/\d\d:\d\d/)
  // #3: таймер закреплён (sticky) — не уезжает при скролле контента.
  await expect(page.locator('.live-timer-big')).toHaveCSS('position', 'sticky')
  // #6: подтверждаем подход, затем правим карандашом.
  await page.getByLabel('Фактическое время').first().fill('2')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  await expect(page.getByLabel('Фактическое время').first()).toBeDisabled()
  await page.getByRole('button', { name: 'Редактировать подход' }).first().click()
  await expect(page.getByLabel('Фактическое время').first()).toBeEnabled()
  await page.getByLabel('Фактическое время').first().fill('3')
  await page.getByRole('button', { name: 'Сохранить' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
})

test('план: порядок упражнений меняется стрелками и сохраняется', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Порядок Клиент')
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Порядок Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Порядок Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
  }
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

test('live: порядок упражнений меняется стрелками во время тренировки', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Live Порядок')
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Live Порядок' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Live Порядок' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
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
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Замена Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Замена Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  // Добавляем «Присед», задаём подход.
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByLabel('Вес, подход 1').fill('50')
  await page.getByLabel('Повторы, подход 1').fill('10')

  // Заменяем на «Жим лёжа» (тот же тип) — значения подхода сохраняются.
  await page.getByRole('button', { name: 'Заменить' }).click()
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
  await page.getByRole('button', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Тяга верхнего блока')
  await page.getByRole('button', { name: /Тяга верхнего блока/ }).first().click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Тяга верхнего блока')
  // После подтверждения подхода «Заменить» пропадает (начатое заменять нельзя).
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Заменить' })).toHaveCount(0)
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
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Карточка Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Карточка Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  // Импортированное упражнение с картинкой/оборудованием/мышцами.
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('тяга штанги в наклоне (штанга)')
  await page.getByRole('button', { name: /Тяга штанги в наклоне \(Штанга\)/ }).first().click()
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
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Суперсет Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Суперсет Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  for (const q of ['Присед со штангой', 'Жим лёжа']) {
    await page.getByRole('button', { name: '＋ Упражнение' }).click()
    await page.getByLabel('Поиск упражнения').fill(q)
    await page.getByRole('button', { name: new RegExp(q) }).first().click()
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
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  // В просмотре тренировки виден бейдж «Сет · 2 кр.».
  await expect(page.locator('.block-badge').first()).toContainText('Сет · 2 кр.')

  // Live идёт по кругам: круг 1 (упр.A → упр.B), потом круг 2. Счётчик показывает
  // текущий круг; отдых — после завершения круга (последнего упражнения круга).
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
  await expect(page.locator('.circuit-counter')).toHaveText('Круг 1 из 2')
  // Первое упражнение круга 1 — отдых НЕ запускается (круг ещё не завершён).
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toHaveCount(1)
  await expect(page.getByText(/Отдых/)).toHaveCount(0)
  // Второе (последнее) упражнение круга 1 — круг завершён, отдых запускается,
  // счётчик переключается на «Круг 2 из 2».
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByText(/Отдых/)).toBeVisible()
  await expect(page.locator('.circuit-counter')).toHaveText('Круг 2 из 2')
  // Подсветка: круг 1 закрыт (зелёный, done), круг 2 в работе (серый, current).
  await expect(page.locator('.circuit-round').nth(0)).toHaveClass(/done/)
  await expect(page.locator('.circuit-round').nth(1)).toHaveClass(/current/)

  // Круг 2: упр.A → отдыха нет; упр.B — последнее упражнение последнего круга,
  // блок завершён → отдых НЕ запускается (регресс: раньше запускался лишний).
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
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

test('расписание: создание тренировки из расписания с датой выбранного дня', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByLabel('Имя').fill('Расписание Клиент')
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Расписание Клиент' })).toBeVisible()

  // Идём в расписание и создаём тренировку прямо оттуда.
  await page.getByRole('link', { name: 'Расписание', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
  await page.getByRole('link', { name: 'Новая тренировка' }).click()
  // Форма открылась; дата предзаполнена (не пустая), клиента выбираем.
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await expect(page.getByLabel('Дата')).not.toHaveValue('')
  await page.getByLabel('Клиент').selectOption({ label: 'Расписание Клиент' })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
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
  await page.getByLabel('Начальный вес, кг').fill('80')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Коммент Клиент' })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать/ }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Коммент Клиент' })
  await expect(page.getByRole('button', { name: 'Надиктовать заметку' })).toBeVisible()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: /Присед со штангой/ }).first().click()
  await page.getByLabel('Вес, подход 1').fill('90')
  await page.getByLabel('Повторы, подход 1').fill('8')
  // Комментарий тренера к упражнению в форме плана.
  await page.getByLabel('Комментарий к упражнению').fill('Держи спину прямо')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Проводим тренировку; в live поле комментария доступно.
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer-big')).toBeVisible()
  await expect(page.getByLabel(/Комментарий: Присед/)).toBeVisible()
  await page.getByLabel('Фактический вес').first().fill('92.5')
  await page.getByLabel('Фактические повторы').first().fill('8')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Комментарий виден в истории упражнения.
  await page.locator('.exercise-name-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await page.getByRole('tab', { name: 'История' }).click()
  await expect(page.locator('.exercise-comment-note')).toContainText('Держи спину прямо')

  // Комментарий виден и в карточке истории тренировок клиента (список упр.).
  await page.getByRole('link', { name: 'Клиенты', exact: true }).click()
  await page.getByText('Коммент Клиент').first().click()
  await page.getByRole('link', { name: 'История', exact: true }).click()
  await expect(page.locator('.workout-exercise-comment').first()).toContainText('Держи спину прямо')
})
