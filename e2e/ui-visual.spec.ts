import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const demoClientId = '11111111-1111-4111-8111-111111111111'

async function signIn(page: import('@playwright/test').Page, email: string, destination: RegExp) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(destination)
}

async function openClientProgress(page: import('@playwright/test').Page, options: { scheme?: boolean, dark?: boolean } = {}) {
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  if (options.scheme || options.dark) {
    await page.goto('/me/profile')
    if (options.scheme) {
      const schemeOption = page.getByRole('radio', { name: 'Схема' })
      await schemeOption.click()
      await expect(schemeOption).toHaveAttribute('aria-checked', 'true')
    }
    if (options.dark) {
      const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
      await darkTheme.check()
      await expect(darkTheme).toBeChecked()
    }
  }
  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/progress-identity/)
  await expect(page.locator('.client-progress-card')).toBeVisible()
}

async function expectVisualBaseline(
  page: import('@playwright/test').Page,
  name: string,
  mask: import('@playwright/test').Locator[] = [],
  fullPage = false,
  maskColor = '#f8f5ef',
) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    mask,
    maskColor,
    maxDiffPixelRatio: 0.03,
  })
}

async function createStandaloneClient(
  page: import('@playwright/test').Page,
  projectName: string,
  name = 'Визуальный клиент',
  emailPrefix = 'visual-client',
) {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill(name)
  await page.getByLabel('Email').fill(`${emailPrefix}-${projectName}-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть' }).click()
}

async function openPreviewLiveWorkout(page: import('@playwright/test').Page) {
  await signIn(page, 'client@fit.local', /\/me$/)

  await page.goto('/me/workouts')
  const activeWorkout = page.getByRole('link', { name: /Идёт/ }).first()
  const addAction = page.getByRole('link', { name: /^(?:Добавить|Добавить тренировку)$/ })
  await expect(addAction).toBeVisible()
  if (await activeWorkout.isVisible()) {
    await activeWorkout.click()
    await page.getByRole('link', { name: 'Продолжить тренировку' }).click()
    await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
    return
  }
  await expect(addAction).toHaveCount(1)
  await addAction.click()
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
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

test('current role home keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await signIn(page, trainer ? 'trainer@fit.local' : 'client@fit.local', trainer ? /\/today$/ : /\/me$/)
  // Фиксируем время только после auth: приветствие и недельный период не
  // должны менять committed screenshot в зависимости от часа запуска CI.
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto(trainer ? '/today' : '/me')

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  if (!trainer) {
    await expect(page.getByText('Загружаем прогресс недели…')).toHaveCount(0)
    await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)
  } else {
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/client-home-identity/)
    await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
    await expect(page.locator('.trainer-attention')).toBeVisible()
  }
  await expect(page.locator('.phone-frame')).toBeVisible()
  await expectVisualBaseline(page, trainer ? `trainer-today-${process.platform}.png` : 'role-home.png', [], true)

  if (!trainer) {
    await page.goto('/me/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await page.goto('/me')
    await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)
    await expectVisualBaseline(page, 'role-home-dark.png', [], true)
  } else {
    await page.getByRole('button', { name: 'Ввести текстом' }).click()
    await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
    await expectVisualBaseline(page, `trainer-today-composer-${process.platform}.png`, [], true)
    await page.goto('/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await page.goto('/today')
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
    await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
    await expectVisualBaseline(page, `trainer-today-dark-${process.platform}.png`, [], true, '#1d1e21')
  }
})

test('trainer Today keeps its mobile visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Trainer desktop is covered by the role-home baseline')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/today')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
  await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
  await expect(page.locator('.trainer-attention')).toBeVisible()
  await expectVisualBaseline(page, `trainer-today-mobile-${process.platform}.png`, [], true)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await expectVisualBaseline(page, `trainer-today-mobile-composer-${process.platform}.png`, [], true)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/today')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
  await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
  await expectVisualBaseline(page, `trainer-today-mobile-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('future standalone plan stays compact on client home', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Home uses mobile visual profiles')
  await createStandaloneClient(page, `future-${testInfo.project.name}`)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/workouts/new?date=2026-08-17')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить план' }).click()

  await page.goto('/me')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/client-home-identity/)
  await expect(page.getByRole('heading', { name: 'Следующая тренировка' })).toBeVisible()
  await expect(page.getByText('Завтра · без времени')).toBeVisible()
  await expect(page.getByRole('link', { name: /Следующая тренировка/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть план' })).toHaveCount(0)
  await expectVisualBaseline(page, 'client-home-future-plan.png', [], true)
})

test('client key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client routes use mobile visual profiles')
  await openClientProgress(page)
  await expect(page.locator('.client-progress-card .body-progress-map')).toBeVisible()
  const progressStats = page.locator('.client-progress-card .ai-progress-stats')
  await expect(progressStats.getByText(/трениров/).first()).toBeVisible()
  await expect(progressStats.getByText(/недел/).first()).toBeVisible()
  await expect(page.getByText(/\/ нед\./)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нагрузка', exact: true })).toBeVisible()
  await expect(page.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(page.getByText('Прогресс уже заметен, ты на верном пути.')).toHaveCount(0)
  await expect(page.getByText('Проверяем цель…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  const progressCoachmark = page.getByRole('button', { name: 'Понятно' })
  if (await progressCoachmark.isVisible()) await progressCoachmark.click()
  await expectVisualBaseline(page, `client-progress-${process.platform}.png`)
})

test('client Progress scheme keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await openClientProgress(page, { scheme: true })
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectVisualBaseline(page, `client-progress-scheme-${process.platform}.png`)
})

test('client Progress scheme keeps its dark visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await openClientProgress(page, { scheme: true, dark: true })
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectVisualBaseline(page, `client-progress-scheme-dark-${process.platform}.png`)
})

test('client measurements keep their visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client measurements use mobile visual profiles')
  await openClientProgress(page, { scheme: true })
  await page.locator('.client-progress-measurement').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await page.locator('.client-progress-measurement-head').click({ position: { x: 4, y: 4 } })
  await page.locator('.client-progress-measurement .recharts-tooltip-wrapper').evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = 'hidden' }))
  await expectVisualBaseline(page, `client-measurements-${process.platform}.png`)
})

test('client workouts keep their visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workouts use mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workouts-identity/)
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByText('Добавьте упражнения голосом, текстом или из каталога.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Добавить тренировку' })).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-${process.platform}.png`)

  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/me/workouts')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workouts-identity/)
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-dark-${process.platform}.png`)

  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('client Profile keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Profile uses mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.goto('/me/profile')
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-profile-shell-identity/)
  await expect(page.getByRole('link', { name: 'Изменить данные' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Вид карты тела' })).toBeVisible()
  await expectVisualBaseline(page, `client-profile-${process.platform}.png`)

  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await page.getByRole('form', { name: 'Напишите команде Fit' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('textbox', { name: 'Сообщение' })).toBeVisible()
  await expectVisualBaseline(page, `client-profile-feedback-${process.platform}.png`)
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-profile-shell-identity/)
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `client-profile-dark-${process.platform}.png`)
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('client card edit keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Card Edit uses mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.goto('/me/edit')
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-card-edit-identity/)
  await expect(page.getByLabel('Имя')).toHaveValue('Анна Смирнова')
  await expect(page.getByLabel('Цель')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
  await expectVisualBaseline(page, `client-card-edit-${process.platform}.png`, [], true)

  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/me/edit')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-card-edit-identity/)
  await expectVisualBaseline(page, `client-card-edit-dark-${process.platform}.png`, [], true, '#1d1e21')

  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

async function openWorkoutCreate(page: import('@playwright/test').Page, dark = false) {
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.goto('/me/profile')
  const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
  if (dark) await darkTheme.check()
  else await darkTheme.uncheck()
  await page.goto('/workouts/new')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
}

async function addCompletedBenchPress(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Выбрать упражнения' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('60')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.locator('.workout-form-exercises').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Записать тренировку' })).toBeEnabled()
}

async function openWorkoutReview(page: import('@playwright/test').Page, trainer: boolean, dark = false) {
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Жим лёжа 3×10 — 60 кг',
          exerciseRef: 'bench-press',
          confidence: 1,
          sets: [{ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }],
        }],
        unmatched: [],
      }),
    })
  })
  await signIn(page, trainer ? 'trainer@fit.local' : 'client@fit.local', trainer ? /\/today$/ : /\/me$/)
  await page.goto(trainer ? '/profile' : '/me/profile')
  const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
  if (dark) await darkTheme.check()
  else await darkTheme.uncheck()
  await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('fit.today-draft.'))
    .forEach((key) => localStorage.removeItem(key)))
  await page.goto(trainer ? '/today' : '/me')
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа 3×10 — 60 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
}

test('workout create keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page)
  await expect(page.getByRole('button', { name: 'Сохранить план' })).toBeDisabled()
  await expectVisualBaseline(page, `workout-create-${process.platform}.png`)
})

test('workout completed-entry keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page)
  await addCompletedBenchPress(page)
  await expectVisualBaseline(page, `workout-create-fact-${process.platform}.png`)
})

test('workout create dark keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page, true)
  await expectVisualBaseline(page, `workout-create-dark-${process.platform}.png`, [], false, '#1d1e21')
})

test('workout review keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer)
  await expectVisualBaseline(page, `workout-review-${process.platform}.png`)
})

test('workout save keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer)
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
  await expectVisualBaseline(page, `workout-save-${process.platform}.png`)
})

test('workout review dark keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer, true)
  await expectVisualBaseline(page, `workout-review-dark-${process.platform}.png`, [], false, '#1d1e21')
})

test('workout save dark keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer, true)
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await expectVisualBaseline(page, `workout-save-dark-${process.platform}.png`, [], false, '#1d1e21')
})

async function openWorkoutForDetailReview(page: import('@playwright/test').Page, trainer: boolean) {
  if (!trainer) {
    await openPreviewLiveWorkout(page)
    return
  }
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.goto(`/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByRole('button', { name: /^Сохранить(?: план)?$/ }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

test('workout detail, completion and exercise history keep their visual baselines', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutForDetailReview(page, trainer)
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-set-compact.confirmed')).toBeVisible()
  // Добавляем реальное незавершённое упражнение, чтобы деталь стабильно
  // покрывала partial независимо от числа подходов в исходном плане.
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  const partialFinish = page.getByRole('button', { name: 'Завершить', exact: true })
  if (await partialFinish.isVisible()) await partialFinish.click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  const detailPath = new URL(page.url()).pathname
  await expectVisualBaseline(page, `workout-detail-completion-${process.platform}.png`)

  await page.locator('.exercise-history-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  const historyPath = new URL(page.url()).pathname
  await page.goto(historyPath)
  await expectVisualBaseline(page, `workout-exercise-history-${process.platform}.png`)
  await page.getByRole('tab', { name: 'История' }).click()
  await expectVisualBaseline(page, `workout-exercise-history-list-${process.platform}.png`)

  await page.goto(trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto(detailPath)
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  await expectVisualBaseline(page, `workout-detail-dark-${process.platform}.png`, [], false, '#1d1e21')
  await page.goto(historyPath)
  await expectVisualBaseline(page, `workout-exercise-history-dark-${process.platform}.png`, [], false, '#1d1e21')

  await page.goto(trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
  await page.goto(detailPath)
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  const deleteConfirmation = page.getByRole('alertdialog', { name: 'Удалить тренировку?' })
  await deleteConfirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
})

test('client live workout keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Live uses mobile visual profiles')
  await openPreviewLiveWorkout(page)
  await expect(page.locator('.live-exercise.current')).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/live-identity/)
  await expectVisualBaseline(page, 'client-live.png', [page.locator('.live-timer')])

  const livePath = new URL(page.url()).pathname
  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto(livePath)
  await expect(page.locator('.phone-frame')).toHaveClass(/live-identity/)
  await expect(page.locator('.live-exercise.current')).toBeVisible()
  await expectVisualBaseline(page, 'client-live-dark.png', [page.locator('.live-timer')], false, '#1d1e21')

  // Visual projects share the seeded preview account. Restore both appearance
  // and product data so later projects still exercise their committed fixtures.
  await page.goto('/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
  await page.goto(livePath.replace(/\/live$/, ''))
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  const deleteConfirmation = page.getByRole('alertdialog', { name: 'Удалить тренировку?' })
  await deleteConfirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/workouts$/)
})

test('trainer key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer routes use the desktop visual profile')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })

  await page.goto('/profile')
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toBeVisible()
  await expect(page.getByText('Ваш выбор для карт прогресса спортсменов')).toBeVisible()
  await page.getByRole('radio', { name: 'Схема' }).click()

  await page.goto('/schedule')
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
  await expectVisualBaseline(page, 'trainer-schedule.png')

  await page.goto(`/progress/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByText('Анна Смирнова', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
  const trainerAnalysis = page.getByLabel('ИИ-анализ тренировок')
  await expect(trainerAnalysis).toBeVisible()
  await expect(trainerAnalysis.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(trainerAnalysis.locator('.body-progress-map')).toBeVisible()
  await expect(trainerAnalysis.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await expect(trainerAnalysis.getByRole('group', { name: 'Атлетичная женщина, вид спереди' })).toHaveCount(0)
  await expect(page.getByText(/AI-анализ/)).toHaveCount(0)
  const coachmark = page.getByRole('button', { name: 'Понятно' })
  if (await coachmark.isVisible()) await coachmark.click()
  await expectVisualBaseline(page, 'trainer-progress.png')

  await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
  await expect(page.getByRole('button', { name: 'Настроить показатели' })).toBeVisible()
  await page.locator('.trainer-measurements-workspace .measurement-actions').evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await page.locator('.content').evaluate((element) => element.scrollBy({ top: 180 }))
  await page.locator('.trainer-measurements-workspace .chart h2').click({ position: { x: 4, y: 4 } })
  await expectVisualBaseline(page, 'trainer-measurements.png')
  await page.goto(`/progress/${demoClientId}`)
  const analysis = page.getByLabel('ИИ-анализ тренировок')
  await expect(analysis.locator('.body-progress-map')).toBeVisible()
  await expect(analysis.getByText('Анализ прогресса')).toBeVisible()
  await expect(analysis.getByText('Динамика упражнений')).toHaveCount(0)
  await analysis.getByRole('button', { name: 'Подробный анализ' }).click()
  const detailedAnalysis = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(detailedAnalysis.getByText('Динамика упражнений')).toBeVisible()
  await expect(detailedAnalysis.getByText('Ритм тренировок')).toBeVisible()
  await detailedAnalysis.getByRole('button', { name: 'Закрыть' }).click()
})

test('trainer Clients list keeps its desktop visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer desktop uses the desktop visual profile')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-${process.platform}.png`, [], true)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Clients list keeps its mobile visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Trainer desktop has a dedicated visual test')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expectVisualBaseline(page, `trainer-clients-mobile-${process.platform}.png`, [], true)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-mobile-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Detail keeps its visual baselines', async ({ page }, testInfo) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto(`/clients/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Сводка по спортсмену' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Запланировать тренировку' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы спортсмена' }).getByRole('link')).toHaveCount(2)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  await expectVisualBaseline(page, `trainer-client-detail-${profile}-${process.platform}.png`, [], true)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto(`/clients/${demoClientId}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  await expectVisualBaseline(page, `trainer-client-detail-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Create and Edit keep their visual baselines', async ({ page }, testInfo) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'

  await page.goto('/clients/new')
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expect(page.getByLabel('Начальный вес, кг')).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-create-${profile}-${process.platform}.png`, [], true)

  await page.goto(`/clients/${demoClientId}/edit`)
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.getByLabel('Имя в моём списке')).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-edit-${profile}-${process.platform}.png`, [], true)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto('/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expectVisualBaseline(page, `trainer-client-create-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
  await page.goto(`/clients/${demoClientId}/edit`)
  await expectVisualBaseline(page, `trainer-client-edit-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Goal keeps its real create, stage and edit states in both themes', async ({ page }, testInfo) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  const clientName = 'Марина Орлова'

  // Отдельный спортсмен на каждый browser-project не даёт параллельным
  // visual-проверкам делить одну active goal и менять состояние друг друга.
  await page.goto('/clients/new')
  await page.getByLabel('Имя', { exact: true }).fill(clientName)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('29')
  await page.getByLabel('Рост, см').fill('168')
  await page.getByLabel('Начальный вес, кг').fill('63')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const clientId = page.url().split('/').pop()!

  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await expect(page.getByLabel('Цель')).toBeVisible()
  await page.getByLabel('Дата достижения').fill('2026-12-20')
  await expectVisualBaseline(page, `trainer-client-goal-create-${profile}-${process.platform}.png`, [], true)

  await page.getByLabel('Цель').fill('Пробежать первые 10 км уверенно')
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Этапы' })).toBeVisible()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
  await page.getByRole('button', { name: '＋ Добавить' }).click()
  await page.getByLabel('Название этапа').fill('Стабильные 5 км')
  await page.getByLabel('Начало').fill('2026-08-16')
  await page.getByLabel('Конец').fill('2026-09-20')
  await page.getByRole('button', { name: 'Добавить этап' }).click()
  await expect(page.getByText('Стабильные 5 км', { exact: true })).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-goal-detail-${profile}-${process.platform}.png`, [], true)

  // Открываем и закрываем обе реальные edit-формы: визуальный контракт форм
  // тот же, а данные и версии не меняем ради снимка.
  await page.getByRole('button', { name: 'Изменить' }).first().click()
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Изменить' }).last().click()
  await expect(page.getByLabel('Название этапа')).toHaveValue('Стабильные 5 км')
  await page.getByRole('button', { name: 'Отмена' }).click()

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await expectVisualBaseline(page, `trainer-client-goal-detail-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')

  await page.getByRole('button', { name: 'Архивировать цель' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Архивировать' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  await page.getByRole('button', { name: 'Архивировать клиента' }).click()
  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('trainer Schedule keeps its compact workspace in both themes', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  const scheduleDate = testInfo.project.name === 'visual-client-390' ? '2027-02-02'
    : testInfo.project.name === 'visual-client-430' ? '2027-02-03' : '2027-02-04'
  const clientName = 'Анна Смирнова'
  let workoutUrl: string | null = null

  try {
    await page.goto(`/workouts/new?client=${demoClientId}&date=${scheduleDate}`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Начало').fill('18:30')
    await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
    await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
    await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]+$/)
    workoutUrl = page.url()

    await page.goto(`/schedule?date=${scheduleDate}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
    await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
    await expect(page.locator('.week-day')).toHaveCount(7)
    await expect(page.locator('.day-grid-hour')).toHaveCount(24)
    await expect(page.locator('.schedule-selected-date')).toContainText('1 тренировка')
    await expect(page.locator('.day-grid-event').filter({ hasText: clientName })).toBeVisible()
    await expectVisualBaseline(page, `trainer-schedule-${profile}-${process.platform}.png`)

    await page.goto('/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await page.goto(`/schedule?date=${scheduleDate}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
    await expectVisualBaseline(page, `trainer-schedule-${profile}-dark-${process.platform}.png`, [], false, '#1d1e21')
  } finally {
    if (workoutUrl) {
      await page.goto(workoutUrl, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
      await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    }
    await page.goto('/profile', { waitUntil: 'domcontentloaded' })
    const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
    if (await darkTheme.isChecked()) await darkTheme.uncheck()
  }
})
