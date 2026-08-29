import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const demoClientId = '11111111-1111-4111-8111-111111111111'

async function signInPreviewTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('global rollout gives a new trainer the Client Goal identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Client goal flag off')
  await page.getByLabel('Email').fill(`client-goal-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto(`/clients/${demoClientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await expect(page.locator('html')).toHaveClass(/identity-monochrome-preview/)
})

test('trainer Client Goal keeps create and date validation under monochrome preview', async ({ page }) => {
  await signInPreviewTrainer(page)
  await page.goto('/clients/new')
  await page.getByLabel('Имя', { exact: true }).fill(`Цель ${randomUUID().slice(0, 8)}`)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('31')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('65')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const clientId = page.url().split('/').pop()!

  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByText('Введите цель')).toBeVisible()
  await page.getByLabel('Цель').fill('Подготовиться к старту')
  await page.getByLabel('Дата достижения').fill('2026-12-20')
  await page.getByRole('switch', { name: 'Автоматическая оценка' }).check()
  await page.getByLabel('Показатель').selectOption('weight')
  await page.getByLabel('Способ оценки').selectOption('maintain_range')
  await page.getByLabel('Минимум, кг').fill('64.5')
  await page.getByLabel('Максимум, кг').fill('65.5')
  await page.getByRole('button', { name: '＋ Добавить критерий' }).click()
  const regularity = page.locator('.goal-criterion-item').nth(1)
  await regularity.getByLabel('Показатель').selectOption('workout_regularity')
  await regularity.locator('select').nth(1).selectOption('week')
  await regularity.locator('select').nth(2).selectOption('each_period')
  await regularity.getByLabel('Способ оценки').selectOption('increase_to')
  await regularity.getByLabel('Значение, трен.').fill('3')
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
  await expect(page.getByText('Вес', { exact: true })).toBeVisible()
  await expect(page.getByText('64,5–65,5 кг')).toBeVisible()
  await expect(page.getByText('2 критерия подтверждены')).toBeVisible()

  await page.getByRole('button', { name: '＋ Добавить' }).click()
  await page.getByLabel('Название этапа').fill('Базовый объём')
  await page.getByLabel('Начало').fill('2026-09-20')
  await page.getByLabel('Конец').fill('2026-09-19')
  await page.getByRole('button', { name: 'Добавить этап' }).click()
  await expect(page.getByText('Конец раньше начала')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Архивировать цель' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Архивировать' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  await page.getByRole('button', { name: 'Архивировать клиента' }).click()
})
