import { expect, test } from '@playwright/test'

test('client without monochrome preview keeps the current My Workouts identity', async ({ page }, testInfo) => {
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
  await expect(page.locator('.phone-frame')).not.toHaveClass(/client-workouts-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
