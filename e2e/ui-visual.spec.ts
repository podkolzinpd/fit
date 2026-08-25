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

async function expectVisualBaseline(
  page: import('@playwright/test').Page,
  name: string,
  mask: import('@playwright/test').Locator[] = [],
  fullPage = false,
) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    mask,
    maskColor: '#f8f5ef',
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

async function createStandaloneLiveWorkout(page: import('@playwright/test').Page, projectName: string) {
  await createStandaloneClient(page, projectName, 'Live клиент', 'visual-live')

  await page.goto('/me/workouts')
  const emptyAction = page.getByRole('link', { name: 'Добавить тренировку' })
  await expect(emptyAction).toHaveCount(1)
  await expect(page.getByText('БЛИЖАЙШЕЕ')).toHaveCount(0)
  await expect(page.getByText('РЕЗУЛЬТАТЫ')).toHaveCount(0)
  await expect(page.locator('.empty')).toHaveCount(0)
  await emptyAction.click()
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
  if (!trainer) await expect(page.getByText('Загружаем прогресс недели…')).toHaveCount(0)
  await expect(page.locator('.phone-frame')).toBeVisible()
  await expectVisualBaseline(page, 'role-home.png', [], true)
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
  await expect(page.getByRole('heading', { name: 'Следующая тренировка' })).toBeVisible()
  await expect(page.getByText('Завтра · без времени')).toBeVisible()
  await expect(page.getByRole('link', { name: /Следующая тренировка/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть план' })).toHaveCount(0)
  await expectVisualBaseline(page, 'client-home-future-plan.png', [], true)
})

test('client key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client routes use mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })

  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.locator('.client-progress-card')).toBeVisible()
  await expect(page.locator('.client-progress-card .body-progress-map')).toBeVisible()
  const progressStats = page.locator('.client-progress-card .ai-progress-stats')
  await expect(progressStats.getByText('тренировки', { exact: true })).toBeVisible()
  await expect(progressStats.getByText('недели с тренировками', { exact: true })).toBeVisible()
  await expect(page.getByText(/\/ нед\./)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нагрузка', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Для твоей цели' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toBeVisible()
  await expect(page.getByText('Проверяем цель…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  const progressCoachmark = page.getByRole('button', { name: 'Понятно' })
  if (await progressCoachmark.isVisible()) await progressCoachmark.click()
  await expectVisualBaseline(page, `client-progress-${process.platform}.png`)
  await page.locator('.client-progress-measurement').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await page.locator('.client-progress-measurement-head').click({ position: { x: 4, y: 4 } })
  await page.locator('.client-progress-measurement .recharts-tooltip-wrapper').evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = 'hidden' }))
  await expectVisualBaseline(page, `client-measurements-${process.platform}.png`)

  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Добавить тренировку' })).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-${process.platform}.png`)
})

test('client live workout keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Live uses mobile visual profiles')
  await createStandaloneLiveWorkout(page, testInfo.project.name)
  await expect(page.locator('.live-exercise.current')).toBeVisible()
  await expectVisualBaseline(page, 'client-live.png', [page.locator('.live-timer')])
})

test('trainer key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer routes use the desktop visual profile')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })

  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expectVisualBaseline(page, 'trainer-clients.png')

  await page.goto(`/clients/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Сводка по спортсмену' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Запланировать тренировку' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы спортсмена' })).toBeVisible()
  await expect(page.getByText('БЛИЖАЙШЕЕ')).toHaveCount(0)
  await expectVisualBaseline(page, 'trainer-client-detail.png')

  await page.goto('/schedule')
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
  await expectVisualBaseline(page, 'trainer-schedule.png')

  await page.goto(`/progress/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByText('Анна Смирнова', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
  await expect(page.getByLabel('ИИ-анализ тренировок')).toBeVisible()
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
  await expect(analysis.getByText('Анализ прогресса')).toBeVisible()
  await expect(analysis.getByText('Динамика упражнений')).toBeVisible()
})
