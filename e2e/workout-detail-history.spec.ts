import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('client without monochrome preview keeps current workout detail and exercise history identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Detail flag off')
  await page.getByLabel('Email').fill(`detail-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  for (const path of ['/workouts/missing-workout', '/workouts/missing-workout/history/bench-press']) {
    await page.goto(path)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/workout-detail-history-identity/)
    await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
  }
})
