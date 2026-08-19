import { expect, test } from '@playwright/test'

async function selectClient(page: import('@playwright/test').Page, name: string) {
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: name }).first().click()
}

async function fillClientProfileDetails(page: import('@playwright/test').Page) {
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
}

test('auth shell matches mobile baseline', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
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
  await expect(page.getByRole('status')).toContainText('Сохранено')
  await page.reload()
  await expect(page.getByLabel('Имя')).toHaveValue('Тест Обновлённый')
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
  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Сначала создайте личную карточку' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Создать карточку' })).toHaveAttribute('href', '/me')
  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Сначала создайте личную карточку' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Создать карточку' })).toHaveAttribute('href', '/me')
  await page.goto('/me')
  await fillClientProfileDetails(page)
  await page.getByLabel('Начальный вес, кг').fill('72.5')
  await page.getByLabel('Цель').fill('Тренироваться самостоятельно')
  await page.getByRole('button', { name: 'Создать карточку' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ввести текстом' })).toBeVisible()
  await page.getByRole('link', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Клиент Сам')
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
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await expect(page.locator('.planned-set-summary')).toHaveText(/План.*2 × 40 кг × 10 повт\./)
  await page.getByRole('link', { name: 'Копировать' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?copy=/)
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

  // Тренер не может использовать код клиента; код остаётся действующим для
  // правильного аккаунта и следующий переход по ссылке обрабатывается сам.
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
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
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент приглашения')
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Создайте личную карточку' })).toBeVisible()
  await page.goto(`/join?code=${clientCode}`)
  await expect(page).toHaveURL(/\/me$/, { timeout: 15_000 })
  await expect(page.getByText(/Клиент приглашения/)).toBeVisible()

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const trainerCode = (await page.getByText(/Код для тренера:/).textContent())?.match(/[A-F0-9]{12}/)?.[0]
  expect(trainerCode).toBeTruthy()
  await page.getByRole('button', { name: 'Отозвать' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отозвать' }).click()
  await expect(page.getByRole('heading', { name: 'Активные приглашения' })).toHaveCount(0)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
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

test('trainer invitation links a client account', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
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
  await page.getByRole('link', { name: 'Запланировать тренировку' }).click()
  await selectClient(page, 'Связанный клиент')
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
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(clientEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole('heading', { name: 'Создайте личную карточку' })).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(code!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByText(/Связанный клиент/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()

  await page.goto('/me/workouts')
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
  await page.getByLabel('Время', { exact: true }).fill('08:30')
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
  await page.getByRole('button', { name: /^Планка/ }).first().click()
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
  // В тренировке остались добавленные подход и упражнение, поэтому завершение
  // подтверждаем как частичное. Это сохраняет проверку структурных мутаций.
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await Promise.all([
    page.waitForURL(ownWorkoutUrl),
    page.getByRole('button', { name: 'Завершить', exact: true }).click(),
  ])
  await expect(page.getByText(/5,2 км × 29:40 · темп 5:42\/км/)).toBeVisible()
  // Собственную завершённую тренировку клиент может исправить: перестановка
  // не должна сталкиваться с промежуточным дубликатом позиции в БД.
  await page.getByRole('link', { name: 'Изменить результат' }).click()
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
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByLabel('Email').fill(trainerEmail)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto(`${clientDetailUrl}/workouts`)
  const clientAuthoredCard = page.locator(`a[href="${ownWorkoutPath}"]`)
  await expect(clientAuthoredCard).toContainText('Создано клиентом')
  await clientAuthoredCard.click()
  await expect(page.getByText('Создано клиентом · только просмотр')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Изменить результат' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Удалить тренировку' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toHaveCount(0)

  // Тренер создаёт новый план из клиентского результата: исходная запись
  // остаётся read-only, а факт копии становится планом тренера.
  await page.getByRole('link', { name: 'Скопировать и отправить план' }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?copy=${ownWorkoutPath.split('/').at(-1)}$`))
  // В этой тренировке два упражнения «Бег»: исходное и добавленное клиентом.
  // Копия должна сохранить оба, а не полагаться на неоднозначный текстовый
  // селектор.
  await expect(page.getByText('Бег (Кардио)', { exact: true })).toHaveCount(2)
  // Клиент поменял упражнения местами: факт остаётся у того же упражнения,
  // поэтому заполненный «Бег» теперь второй, а не теряется или не переносится.
  await expect(page.getByLabel('Время, подход 1').last()).toHaveValue('29:40')
  await expect(page.getByLabel('Расстояние, подход 1').last()).toHaveValue('5.2')
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const sentPlanUrl = page.url()
  const sentPlanPath = new URL(sentPlanUrl).pathname
  expect(sentPlanUrl).not.toBe(ownWorkoutUrl)

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
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
  await expect(page.getByRole('paragraph').filter({ hasText: '59.5 кг' })).toBeVisible()

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const trainerCodeText = await page.getByText(/Код для тренера:/).textContent()
  const trainerCode = trainerCodeText?.match(/[A-F0-9]{12}/)?.[0]
  expect(trainerCode).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Активные приглашения' })).toBeVisible()

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Второй тренер')
  await page.getByLabel('Email').fill(`member-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(trainerCode!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const leaveButton = page.getByRole('button', { name: 'Покинуть пространство клиента' })
  await expect(leaveButton).toBeVisible()
  await leaveButton.click()
  // In-app confirm (useConfirm) вместо нативного window.confirm — подтверждаем
  // кнопкой в диалоге.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Покинуть' }).click()
  await expect(page).toHaveURL(/\/clients$/)
})
