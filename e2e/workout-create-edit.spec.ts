import { expect, test } from '@playwright/test'

test('client without monochrome preview keeps current workout create and review identity', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Тренировка без preview')
  await page.getByLabel('Email').fill(`workout-flow-no-preview-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/workouts/new')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/workout-create-edit-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)

  await page.goto('/me?view=review')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/workout-create-edit-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
