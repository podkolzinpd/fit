import { expect, test } from '@playwright/test'

async function logoutFromProfile(page: import('@playwright/test').Page) {
  const logout = page.getByRole('button', { name: 'Выйти' })
  await logout.scrollIntoViewIfNeeded()
  // First-visit tips must not intercept account-switching scenarios.
  await page.keyboard.press('Escape')
  await logout.click()
}

async function fillClientProfileDetails(page: import('@playwright/test').Page) {
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  const introduction = page.getByRole('button', { name: 'Понятно', exact: true })
  if (await introduction.isVisible()) await introduction.click()
}

test('auth shell matches mobile baseline', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expect(page.getByRole('button', { name: 'Продолжить с Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить Yandex ID' })).toHaveCount(0)
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

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/me/profile')
  await expect(page).toHaveURL(/\/today$/)
  await page.goto('/profile')
  await expect(page.getByLabel('Имя')).toHaveValue('Тест')
  await page.getByLabel('Имя').fill('Тест Обновлённый')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Имя')).toHaveValue('Тест Обновлённый')
  const introduction = page.getByRole('button', { name: 'Понятно', exact: true })
  if (await introduction.isVisible()) await introduction.click()
  await logoutFromProfile(page)
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

test('trainer adds the first client, plans a workout and gets an invitation code', async ({ page }, testInfo) => {
  const email = `first-run-trainer-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Первый тренер')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('heading', { name: 'Планы и результаты спортсменов — в одном месте' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await page.getByLabel('Имя клиента').fill('Антон')
  await page.getByRole('button', { name: 'Добавить первого клиента' }).click()
  await expect(page.getByRole('heading', { name: 'Первая тренировка: Антон' })).toBeVisible()

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения вручную' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByText('Добавить значения', { exact: true }).click()
  await page.getByLabel(/вес, подход 1/i).fill('40')
  await page.getByLabel(/повторы, подход 1/i).fill('10')
  await page.getByRole('button', { name: 'Далее' }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Тренировка запланирована' })).toBeVisible()
  await page.getByRole('button', { name: 'Пригласить спортсмена' }).click()
  await expect(page.getByText(/Код приглашения/)).toBeVisible()
  const invitationCode = (await page.locator('.invitation-code-card strong').textContent())?.match(/[A-F0-9]{12}/)?.[0]
  expect(invitationCode).toBeTruthy()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать код приглашения' }).click()
  await expect(page.getByRole('button', { name: 'Код приглашения скопирован' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(invitationCode)
})

test('client registers, starts without a profile questionnaire and creates an own workout', async ({ page }, testInfo) => {
  const email = `client-signup-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Заполните профиль спортсмена' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Заполнить профиль' })).toHaveAttribute('href', '/me/edit')
  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Заполните профиль спортсмена' })).toBeVisible()
  await page.getByRole('link', { name: 'Заполнить профиль' }).click()
  await expect(page).toHaveURL(/\/me\/edit$/)
  await expect(page.getByRole('heading', { name: 'Профиль спортсмена' })).toBeVisible()
  await expect(page.getByLabel('Имя')).toHaveValue('Клиент')
  await fillClientProfileDetails(page)
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me')
  await page.getByRole('button', { name: 'Ввести текстом' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть' }).click()
  await page.getByRole('link', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Клиент Сам')
  await fillClientProfileDetails(page)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/Клиент Сам/)).toBeVisible()
  await page.goto('/me/profile')
  await expect(page.getByText('Клиент Сам', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Клиент Сам', { exact: true })).toBeVisible()
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/profile')
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Тренировки' }).click()
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await expect(page.locator('.planned-set-summary')).toHaveText(/2 × 40 кг × 10/)
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?copy=/)
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByText(/Скопировано ·/)).toBeVisible()
  const copiedExercise = page.locator('.planned-exercise').first()
  const copiedExerciseToggle = copiedExercise.locator('.compact-editor-exercise-toggle')
  await expect(copiedExerciseToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(copiedExercise).toContainText('2 × 40 кг × 10')
  await expect(copiedExercise.getByLabel('Вес, подход 1')).toHaveCount(0)
  await expect(page.getByText('Дополнительно', { exact: true })).toHaveCount(0)
  await copiedExerciseToggle.click()
  await expect(copiedExercise.getByLabel('Вес, подход 1')).toHaveValue('40')
  await page.locator('.phone-frame').evaluate((element) => element.classList.add('keyboard-open'))
  await expect(page.locator('.workout-action-row')).toBeHidden()
  await page.locator('.phone-frame').evaluate((element) => element.classList.remove('keyboard-open'))
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/me$/)
})

test('invitation links reject the wrong role and revoked code without consuming a valid client code', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerEmail = `invite-guard-trainer-${suffix}@fit.local`
  const wrongRoleEmail = `invite-guard-wrong-${suffix}@fit.local`
  const clientEmail = `invite-guard-client-${suffix}@fit.local`

  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Тренер приглашения')
  await page.getByLabel('Email').fill(trainerEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Клиент приглашения')
  await fillClientProfileDetails(page)
  await page.getByLabel('Начальный вес, кг').fill('60')
  await Promise.all([
    page.waitForURL(/\/clients\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await page.getByRole('button', { name: 'Пригласить клиента' }).click()
  const clientCode = (await page.getByText(/Код клиента:/).textContent())?.match(/[A-F0-9]{12}/)?.[0]
  expect(clientCode).toBeTruthy()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать код клиента' }).click()
  await expect(page.getByRole('button', { name: 'Код клиента скопирован' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(clientCode)

  // Тренер не может использовать код клиента; код остаётся действующим для
  // правильного аккаунта и следующий переход по ссылке обрабатывается сам.
  await page.goto('/profile')
  await logoutFromProfile(page)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Неверная роль')
  await page.getByLabel('Email').fill(wrongRoleEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|profile)$/)
  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(clientCode!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page.getByRole('alert')).toHaveText('Этот код приглашения предназначен для другого типа аккаунта.')

  await page.goto('/profile')
  await logoutFromProfile(page)
  await page.goto(`/join?code=${clientCode}`)
  await expect(page).toHaveURL(/\/auth$/)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByLabel('Тип аккаунта')).toHaveValue('client')
  await page.getByLabel('Имя').fill('Клиент приглашения')
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер пригласил вас в Fit' })).toBeVisible()
  await page.getByRole('button', { name: 'Подключиться и открыть план' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
  await expect(page.getByText('Ваши самостоятельные тренировки сохранены. Планы тренера уже доступны в кабинете.')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть кабинет' }).click()
  await expect(page).toHaveURL(/\/me$/, { timeout: 15_000 })
  await expect(page.getByText(/Клиент приглашения/)).toBeVisible()

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const trainerCode = (await page.getByText(/Код для тренера:/).textContent())?.match(/[A-F0-9]{12}/)?.[0]
  expect(trainerCode).toBeTruthy()
  await page.getByRole('button', { name: 'Скопировать код для тренера' }).click()
  await expect(page.getByRole('button', { name: 'Код для тренера скопирован' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(trainerCode)
  await page.getByRole('button', { name: 'Отозвать' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отозвать' }).click()
  await expect(page.getByRole('heading', { name: 'Активные приглашения' })).toHaveCount(0)

  await page.goto('/me/profile')
  await logoutFromProfile(page)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await page.getByLabel('Email').fill(wrongRoleEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|profile)$/)
  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(trainerCode!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page.getByRole('alert')).toHaveText('Приглашение недействительно или срок его действия истёк. Попросите новый код.')
})

test('client safely switches trainers after an explicit disconnect', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`

  async function registerTrainer(name: string, email: string) {
    await page.goto('/auth')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await page.getByLabel('Имя').fill(name)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill('FitLocal123!')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page).toHaveURL(/\/(today|profile)$/)
  }

  async function createClientInvitation(clientName: string) {
    await page.goto('/clients')
    await page.getByRole('link', { name: 'Добавить' }).click()
    await page.getByLabel('Имя').fill(clientName)
    await fillClientProfileDetails(page)
    await page.getByLabel('Начальный вес, кг').fill('60')
    await Promise.all([
      page.waitForURL(/\/clients\/[0-9a-f-]+$/),
      page.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    await page.getByRole('button', { name: 'Пригласить клиента' }).click()
    const code = (await page.getByText(/Код клиента:/).textContent())?.match(/[A-F0-9]{12}/)?.[0]
    expect(code).toBeTruthy()
    return code!
  }

  async function logoutTrainer() {
    await page.goto('/profile')
    await logoutFromProfile(page)
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  }

  await registerTrainer('Первый тренер', `reconnect-first-${suffix}@fit.local`)
  const firstCode = await createClientInvitation('Клиент первого тренера')
  await logoutTrainer()

  await registerTrainer('Второй тренер', `reconnect-second-${suffix}@fit.local`)
  const secondCode = await createClientInvitation('Клиент второго тренера')
  await logoutTrainer()

  await page.goto(`/join?code=${firstCode}`)
  await expect(page).toHaveURL(/\/auth$/)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Самостоятельный клиент')
  await page.getByLabel('Email').fill(`reconnect-client-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер пригласил вас в Fit' })).toBeVisible()
  await page.getByRole('button', { name: 'Подключиться и открыть план' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть кабинет' }).click()
  await page.goto('/me/profile')
  await expect(page.getByText('Первый тренер', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(secondCode)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page).toHaveURL(new RegExp(`/join\\?code=${secondCode}$`))
  const conflict = page.getByRole('alert')
  await expect(conflict).toContainText('Сначала отключите текущего тренера')
  await expect(conflict).toContainText('Ваш аккаунт, тренировки, замеры и цели сохранятся.')
  await expect(page.getByRole('button', { name: 'Сначала отключите тренера' })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('reconnect-conflict-390.png'), fullPage: true })

  await conflict.getByRole('link', { name: 'Открыть профиль' }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await page.getByRole('button', { name: 'Отключить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отключить' }).click()
  await expect(page.getByRole('status')).toContainText('Ваш аккаунт, тренировки, замеры и цели сохранены.')
  await expect(page.getByText('Сейчас вы занимаетесь самостоятельно.')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/join\\?code=${secondCode}$`))
  await expect(page.getByRole('heading', { name: 'Тренер пригласил вас в Fit' })).toBeVisible()
  await page.getByRole('button', { name: 'Подключиться и открыть план' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть кабинет' }).click()

  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await expect(page.getByText('Второй тренер', { exact: true })).toBeVisible()
  await expect(page.getByText('Первый тренер', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('reconnect-success-430-dark.png'), fullPage: true })
})

test('trainer invitation links a client account', async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerEmail = `invite-trainer-${suffix}@fit.local`
  const clientEmail = `invite-client-${suffix}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Тренер')
  await page.getByLabel('Email').fill(trainerEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByLabel('Имя').fill('Связанный клиент')
  await fillClientProfileDetails(page)
  await page.getByLabel('Начальный вес, кг').fill('60')
  await Promise.all([
    page.waitForURL(/\/clients\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const clientDetailUrl = page.url()
  await page.getByRole('link', { name: 'История тренировок', exact: true }).click()
  const emptyHistoryAction = page.getByRole('link', { name: 'Запланировать тренировку' })
  await expect(page.getByRole('heading', { name: 'Тренировка для клиента' })).toBeVisible()
  await expect(page.getByText('Составьте план или сразу запишите готовый результат.')).toBeVisible()
  await expect(emptyHistoryAction).toHaveCount(1)
  await expect(emptyHistoryAction.locator('svg')).toHaveCount(0)
  await expect(page.getByText('История пока пуста')).toHaveCount(0)
  await page.goto(clientDetailUrl)
  await page.getByRole('link', { name: 'Запланировать тренировку' }).click()
  await expect(page.locator('.workout-header-meta')).toContainText('Связанный клиент')
  await expect(page.locator('.client-picker-trigger')).toHaveCount(0)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Бег/ }).click()
  await page.locator('[data-running-format="free"]').click()
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
  await logoutFromProfile(page)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()

  // Быстрый старт создаёт собственную карточку самостоятельного клиента.
  // После этого профиль дополняется обязательными данными, как в реальном
  // первом входе, и только затем записывается исходная тренировка.
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.goto('/me/profile')
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Самостоятельный клиент')
  await fillClientProfileDetails(page)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/Самостоятельный клиент/)).toBeVisible()

  // Реальный проблемный путь: до привязки к тренеру клиент уже тренировался
  // самостоятельно. Его карточка и завершённый факт должны остаться
  // каноническими после ввода кода тренера.
  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Бег/ }).click()
  await page.locator('[data-running-format="free"]').click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const preAttachWorkoutUrl = page.url()
  const preAttachWorkoutPath = new URL(preAttachWorkoutUrl).pathname
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await page.getByLabel('Фактическое время').fill('20:00')
  await page.getByLabel('Фактическая дистанция').fill('3')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  // Дожидаемся подтверждения единственного подхода. Иначе завершение может
  // прочитать старый query state и открыть partial-confirm, а после быстрого
  // refetch — сразу закончить тренировку, делая следующий селектор гонкой.
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
  await Promise.all([
    page.waitForURL(preAttachWorkoutUrl),
    page.getByRole('button', { name: 'Завершить тренировку' }).click(),
  ])
  await expect(page.getByRole('region', { name: 'Тренировка завершена' })).toBeVisible()
  // После завершения сначала видна компактная сводка. Подробный темп
  // проверяем после явного раскрытия результата, как его открывает клиент.
  const completedRun = page.locator('.completed-exercise-details').first()
  await expect(completedRun.locator('summary')).toContainText('3 км')
  await completedRun.locator('summary').click()
  await expect(completedRun.getByText(/3 км × 20:00 · темп 6:40\/км/)).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(code!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
  await expect(page.getByText('Ваши самостоятельные тренировки сохранены. Планы тренера уже доступны в кабинете.')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть кабинет' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByText(/^(?:Доброе утро|Добрый день|Добрый вечер), Самостоятельный клиент/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Тренировка по плану' })).toContainText('Свободный бег')
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()

  await page.goto('/me/workouts')
  await expect(page.locator(`a[href="${preAttachWorkoutPath}"]`)).toBeVisible()
  await expect(page.locator(`a[href="${new URL(workoutUrl).pathname}"]`)).toBeVisible()

  await page.getByRole('link', { name: 'Добавить' }).click()
  await expect(page.getByLabel('Клиент')).toHaveCount(0)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Бег/ }).click()
  await page.locator('[data-running-format="free"]').click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const ownWorkoutUrl = page.url()
  const ownWorkoutPath = new URL(ownWorkoutUrl).pathname
  await page.getByRole('link', { name: 'Изменить' }).click()
  await page.getByLabel('Начало', { exact: true }).fill('08:30')
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  // Собственную тренировку клиент ведёт так же гибко, как тренер: live-RPC
  // разрешают эти изменения подключённому клиенту, поэтому UI не должен
  // скрывать добавление подхода, упражнения, замену и перестановку.
  await expect(page.getByRole('button', { name: '＋ Подход' })).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ Ещё упражнение' })).toBeVisible()
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await expect(page.locator('.live-set-compact')).toBeVisible()
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: /^Добавить: Планка/ }).first().click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Планка')
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Заменить' }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.locator('[data-exercise-ref="running"]').click()
  await expect(page.locator('.live-exercise-head h2').first()).toContainText('Бег')
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.locator('[data-exercise-ref="running"]').click()
  await expect(page.locator('.live-exercise-head h2')).toHaveCount(2)
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Изменить порядок' }).click()
  // У первого упражнения кнопка «Вверх» отключена, у второго — активна.
  // Берём именно активную, чтобы проверка не зависела от двух одинаковых
  // aria-label в режиме перестановки.
  await expect(page.getByRole('button', { name: 'Вверх' }).last()).toBeEnabled()
  await page.getByLabel('Фактическое время').fill('29:40')
  await page.getByLabel('Фактическая дистанция').fill('5.2')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  // Для последующей перестановки результата нужны два реально выполненных
  // упражнения. Невыполненный план редактор больше не превращает в факт.
  await expect(page.locator('.live-set-compact.confirmed')).toBeVisible()
  await page.getByRole('button', { name: 'Вверх' }).last().click()
  // Дождаться серверной перестановки: у нового текущего упражнения один
  // подход; до refetch здесь ещё видны два подхода предыдущего упражнения.
  await expect(page.locator('.live-exercise .live-set-number')).toHaveCount(1)
  await expect(page.getByLabel('Фактическое время')).toHaveValue('')
  await page.getByLabel('Фактическое время').fill('10:00')
  await page.getByLabel('Фактическая дистанция').fill('1.2')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
  // В первом упражнении остался неподтверждённый добавленный подход.
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Завершить', exact: true }).click(),
  ])
  const ownCompletedRun = page.locator('.completed-exercise-details').filter({ hasText: '5,2 км' })
  await expect(ownCompletedRun.locator('summary')).toContainText('5,2 км')
  await ownCompletedRun.locator('summary').click()
  await expect(ownCompletedRun.getByText(/5,2 км × 29:40 · темп 5:42\/км/)).toBeVisible()
  // Собственную завершённую тренировку клиент может исправить: перестановка
  // не должна сталкиваться с промежуточным дубликатом позиции в БД.
  await page.getByRole('link', { name: 'Изменить результат' }).click()
  await expect(page.locator('.planned-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Изменить порядок' }).click()
  await expect(page.getByRole('button', { name: 'Вверх' }).last()).toBeEnabled()
  await page.getByRole('button', { name: 'Вверх' }).last().click()
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Сохранить изменения' }).click(),
  ])
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  // Завершённая тренировка, которую клиент записал сам, входит в общую
  // историю тренера, но остаётся недоступной для редактирования и запуска.
  await page.goto('/me/profile')
  await logoutFromProfile(page)
  await page.getByLabel('Email').fill(trainerEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients')
  // В кабинете тренера карточка сохраняет заданное им имя клиента. После
  // объединения она ведёт к канонической записи самостоятельного клиента.
  const canonicalClientHref = await page.getByRole('link', { name: /Связанный клиент/ }).getAttribute('href')
  expect(canonicalClientHref).toMatch(/^\/clients\/[0-9a-f-]+$/)
  await page.goto(`${canonicalClientHref}/workouts`)
  const clientAuthoredCard = page.locator(`a[href="${ownWorkoutPath}"]`)
  await expect(clientAuthoredCard).toContainText('Создано клиентом')
  await page.getByRole('status').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
  await clientAuthoredCard.click()
  await expect(page.getByText('Создано клиентом · только просмотр')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Изменить результат' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Удалить тренировку' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Другие действия с тренировкой' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toHaveCount(0)

  // Тренер создаёт новый план из клиентского результата: исходная запись
  // остаётся read-only, а факт копии становится планом тренера.
  await page.getByRole('link', { name: 'Скопировать и отправить план' }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?copy=${ownWorkoutPath.split('/').at(-1)}$`))
  // В этой тренировке два упражнения «Бег»: исходное и добавленное клиентом.
  // Копия должна сохранить оба, а не полагаться на неоднозначный текстовый
  // селектор.
  await expect(page.getByText('Бег', { exact: true })).toHaveCount(2)
  // После перестановки в Live и обратной перестановки результата оба факта
  // остаются у своих упражнений, а не переносятся между одинаковыми ref.
  await expect(page.getByLabel('Время, подход 1').first()).toHaveValue('29:40')
  await expect(page.getByLabel('Расстояние, подход 1').first()).toHaveValue('5.2')
  await expect(page.getByLabel('Время, подход 1').last()).toHaveValue('10:00')
  await expect(page.getByLabel('Расстояние, подход 1').last()).toHaveValue('1.2')
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const sentPlanUrl = page.url()
  const sentPlanPath = new URL(sentPlanUrl).pathname
  expect(sentPlanUrl).not.toBe(ownWorkoutUrl)

  await page.goto('/profile')
  await logoutFromProfile(page)
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/workouts')
  await expect(page.locator(`a[href="${sentPlanPath}"]`)).toBeVisible()
  await page.goto(sentPlanUrl)
  await expect(page.getByText(/Назначил Тренер|Назначена тренером/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  // В назначенном плане live-действия у клиента те же, что у тренера: клиент
  // корректирует реальную тренировку, а проверка связи с его карточкой остаётся
  // на сервере.
  await expect(page.getByRole('button', { name: '＋ Подход' })).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ Ещё упражнение' })).toBeVisible()
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await expect(page.locator('.live-set-compact')).toBeVisible()
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await expect(page.getByRole('menuitem', { name: 'Заменить' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await Promise.all([
    page.waitForURL(sentPlanUrl),
    page.getByRole('button', { name: 'Завершить', exact: true }).click(),
  ])

  await page.goto(workoutUrl)
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page).toHaveURL(/\/live$/)
  await page.getByLabel('Фактическое время').fill('30:00')
  await page.getByLabel('Фактическая дистанция').fill('5')
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.locator('.live-exercise-collapsed')).toBeVisible()
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
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel('Дата').fill(weekAgo)
  await page.getByLabel('Вес, кг').fill('59.5')
  await page.getByRole('button', { name: 'Сохранить замер' }).click()
  await page.getByRole('button', { name: 'История · 2' }).click()
  await expect(page.getByRole('paragraph').filter({ hasText: '59,5 кг' })).toBeVisible()

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const trainerCodeText = await page.getByText(/Код для тренера:/).textContent()
  const trainerCode = trainerCodeText?.match(/[A-F0-9]{12}/)?.[0]
  expect(trainerCode).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Активные приглашения' })).toBeVisible()

  await page.goto('/me/profile')
  await logoutFromProfile(page)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Второй тренер')
  await page.getByLabel('Email').fill(`member-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(trainerCode!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page.getByRole('heading', { name: 'Клиент подключён' })).toBeVisible()
  await expect(page.getByText('Карточка клиента и доступная история тренировок готовы к работе.')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть карточку' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const leaveButton = page.getByRole('button', { name: 'Покинуть пространство клиента' })
  await expect(leaveButton).toBeVisible()
  await page.keyboard.press('Escape')
  await leaveButton.click()
  // In-app confirm (useConfirm) вместо нативного window.confirm — подтверждаем
  // кнопкой в диалоге.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Покинуть' }).click()
  await expect(page).toHaveURL(/\/clients$/)

  // Клиент отключает основного тренера из профиля. На узком светлом экране
  // сначала проверяем понятное подтверждение, затем на 430 px в тёмной теме —
  // сам результат. Самостоятельная история остаётся доступна.
  await page.goto('/profile')
  await logoutFromProfile(page)
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Отключить' }).click()
  const disconnectDialog = page.getByRole('alertdialog')
  await expect(disconnectDialog).toContainText('Ваш аккаунт, история тренировок, замеры и цели сохранятся.')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await disconnectDialog.getByRole('button', { name: 'Отмена' }).click()

  await page.setViewportSize({ width: 430, height: 932 })
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.getByRole('button', { name: 'Отключить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отключить' }).click()
  await expect(page.getByRole('status')).toContainText('Ваш аккаунт, тренировки, замеры и цели сохранены.')
  await expect(page.getByText('Сейчас вы занимаетесь самостоятельно.')).toBeVisible()
  await expect(page.getByText('Основной тренер')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.goto('/me/workouts')
  await expect(page.locator(`a[href="${preAttachWorkoutPath}"]`)).toBeVisible()
  await expect(page.locator(`a[href="${sentPlanPath}"]`)).toBeVisible()
})
