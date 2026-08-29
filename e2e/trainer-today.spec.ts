import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('trainer without monochrome preview keeps current Today identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Today flag off')
  await page.getByLabel('Email').fill(`today-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/today')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-today-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
