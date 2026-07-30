import { expect, test } from '@playwright/test'

test('auth shell matches mobile baseline', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить с Google' })).toBeVisible()
  await expect(page).toHaveScreenshot('auth-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03 })
})

test('trainer registers without surname or email confirmation', async ({ page }, testInfo) => {
  const email = `mvp-signup-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByLabel('Имя')).toBeVisible()
  await expect(page.getByLabel('Фамилия')).toHaveCount(0)
  await page.getByLabel('Имя').fill('Тест')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('heading', { name: 'Мои клиенты' })).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByLabel('Имя')).toHaveValue('Тест')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Тест')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось создать аккаунт. Попробуйте войти или используйте другой email.',
  )
})

test('client registers, creates a standalone card and own workout without trainer access', async ({ page }, testInfo) => {
  const email = `client-signup-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole('heading', { name: 'Создайте личную карточку' })).toBeVisible()
  await expect(page.getByLabel('Имя')).toHaveValue('Клиент')
  await page.getByLabel('Начальный вес, кг').fill('72.5')
  await page.getByLabel('Цель').fill('Тренироваться самостоятельно')
  await page.getByRole('button', { name: 'Создать карточку' }).click()

  await expect(page.getByRole('heading', { name: 'Клиент' })).toBeVisible()
  await expect(page.getByText('72.5 кг')).toBeVisible()
  await expect(page.getByText('Подключённых тренеров нет')).toBeVisible()
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Клиент Сам')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Клиент Сам' })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.getByRole('button', { name: /^Бег / }).first().click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/me$/)
})

test('trainer invitation links a client account', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Тренер')
  await page.getByLabel('Email').fill(`invite-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Связанный клиент')
  await page.getByLabel('Начальный вес, кг').fill('60')
  await Promise.all([
    page.waitForURL(/\/clients\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const clientDetailUrl = page.url()
  await page.getByRole('link', { name: '＋ Запланировать' }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Связанный клиент' })
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByRole('button', { name: 'Бег (Кардио) Кардио' }).first().click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const workoutUrl = page.url()
  expect(workoutUrl).toMatch(/\/workouts\/[0-9a-f-]+$/)
  await page.goto(clientDetailUrl)
  await page.getByRole('button', { name: 'Пригласить клиента' }).click()
  const codeText = await page.getByText(/Код клиента:/).textContent()
  const code = codeText?.match(/[A-F0-9]{12}/)?.[0]
  expect(code).toBeTruthy()

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(`invite-client-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(code!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole('heading', { name: 'Связанный клиент' })).toBeVisible()

  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByLabel('Клиент')).toHaveValue('Связанный клиент')
  await page.getByRole('button', { name: '＋ Упражнение' }).click()
  await page.getByRole('button', { name: 'Бег (Кардио) Кардио' }).first().click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const ownWorkoutUrl = page.url()
  await page.getByRole('link', { name: 'Изменить' }).click()
  await page.getByLabel('Время', { exact: true }).fill('08:30')
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await page.getByLabel('Фактическое время').fill('25')
  await page.getByLabel('Фактическая дистанция').fill('4')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Завершить тренировку' }).click(),
  ])

  await page.goto(workoutUrl)
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page).toHaveURL(/\/live$/)
  await page.getByLabel('Фактическое время').fill('30')
  await page.getByLabel('Фактическая дистанция').fill('5')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.getByRole('button', { name: 'Подтверждено' })).toBeVisible()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Завершить тренировку' }).click(),
  ])

  // Замер записываем на СЕГОДНЯ: будущая дата — нереальный сценарий (замер
  // делают в прошлом/сегодня), а окно графика заканчивается сегодняшним днём,
  // из-за чего запись «на завтра» была не видна в отдельные календарные дни
  // (дата-зависимый флейк, YAFIT-80). По умолчанию форма и так подставляет
  // сегодня — просто не перебиваем дату.
  // Замер добавляем на ПРОШЛУЮ дату (неделю назад): аккаунт клиента уже завёл
  // замер на сегодня (начальный вес 60 кг при онбординге), поэтому «сегодня»
  // упирается в защиту от дубля даты, а «завтра» — нереальная будущая дата,
  // которую окно графика прячет в отдельные календарные дни (дата-зависимый
  // флейк YAFIT-80). Прошлая дата и реалистична, и уникальна.
  await page.goto('/me/progress')
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel('Дата').fill(weekAgo)
  await page.getByLabel('Вес, кг').fill('59.5')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  await expect(page.getByText('59.5 кг')).toBeVisible()

  await page.goto('/me')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const trainerCodeText = await page.getByText(/Код для тренера:/).textContent()
  const trainerCode = trainerCodeText?.match(/[A-F0-9]{12}/)?.[0]
  expect(trainerCode).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Активные приглашения' })).toBeVisible()

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Второй тренер')
  await page.getByLabel('Email').fill(`member-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(trainerCode!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const leaveButton = page.getByRole('button', { name: 'Покинуть пространство клиента' })
  await expect(leaveButton).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await leaveButton.click()
  await expect(page).toHaveURL(/\/clients$/)
})
