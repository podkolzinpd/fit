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

async function createStandaloneLiveWorkout(page: import('@playwright/test').Page, projectName: string) {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Live клиент')
  await page.getByLabel('Email').fill(`visual-live-${projectName}-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('65')
  await page.getByLabel('Цель').fill('Тренироваться регулярно')
  await page.getByRole('button', { name: 'Создать карточку' }).click()

  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить тренировку' }).click()
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
  await expect(page.locator('.phone-frame')).toBeVisible()
  await expectVisualBaseline(page, 'role-home.png', [], true)
})

test('client key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client routes use mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })

  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.locator('.client-progress-card')).toBeVisible()
  await expect(page.locator('.client-progress-card .ai-progress-hero')).toBeVisible()
  const progressStats = page.locator('.client-progress-card .ai-progress-stats')
  await expect(progressStats.getByText('тренировки', { exact: true })).toBeVisible()
  await expect(progressStats.getByText('активные недели', { exact: true })).toBeVisible()
  await expect(page.locator('.ai-progress-regularity strong')).toHaveText(/^\d(?:,\d)? в неделю$/)
  await expect(page.getByText(/\/ нед\./)).toHaveCount(0)
  await expect(page.getByText('За последний месяц рабочий вес в жиме вырос на 4%.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Твоя цель' })).toBeVisible()
  await expect(page.getByText('Проверяем цель…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  await expectVisualBaseline(page, `client-progress-${process.platform}.png`)
  await page.locator('.client-progress-measurement').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await page.locator('.client-progress-measurement-head').click({ position: { x: 4, y: 4 } })
  await page.locator('.client-progress-measurement .recharts-tooltip-wrapper').evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = 'hidden' }))
  await expectVisualBaseline(page, `client-measurements-${process.platform}.png`)

  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeVisible()
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
  await analysis.scrollIntoViewIfNeeded()
  await expect(analysis).toHaveScreenshot('trainer-progress-analysis.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.03,
  })
})
