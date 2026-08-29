import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('trainer without monochrome preview keeps current Clients identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Clients flag off')
  await page.getByLabel('Email').fill(`clients-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-clients-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
