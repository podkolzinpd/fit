import { expect, test } from '@playwright/test'

async function createClientAccount(page: import('@playwright/test').Page, email: string) {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент календаря')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
}

async function createCompletedWorkout(page: import('@playwright/test').Page) {
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  await expect(page).not.toHaveURL(/\/workouts\/new/)
  await expect(page).toHaveURL(/\/workouts\/[^/?]+$/)
  await expect(page.getByRole('heading', { name: 'Ваша тренировка' })).toBeVisible()
}

test('global rollout gives a new client the My Workouts identity', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Тренировки без preview')
  await page.getByLabel('Email').fill(`workouts-no-preview-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workouts-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})

test('client switches workout history to a month calendar and returns to the selected date', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-08-30T18:00:00+03:00') })
  await createClientAccount(page, `workout-calendar-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await createCompletedWorkout(page)
  await page.goto('/me/workouts')

  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page).toHaveURL(/\/me\/workouts\?view=calendar&month=\d{4}-\d{2}$/)
  await expect(page.getByRole('grid', { name: /История тренировок за/ })).toBeVisible()

  const workoutDate = page.locator('.client-history-calendar-day.has-workout button').first()
  await expect(workoutDate).toBeVisible()
  await workoutDate.click()
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/)

  const selectedWorkout = page.locator('.client-history-calendar-selection .workout-chronicle-card').first()
  await expect(selectedWorkout).toBeVisible()
  await selectedWorkout.click()
  await expect(page).toHaveURL(/\/workouts\/[^/?]+$/)

  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/me\/workouts\?view=calendar&month=\d{4}-\d{2}&date=\d{4}-\d{2}-\d{2}$/)
  await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible()
})
