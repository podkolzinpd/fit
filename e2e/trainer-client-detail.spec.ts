import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('trainer without monochrome preview keeps current Client Detail identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Client detail flag off')
  await page.getByLabel('Email').fill(`client-detail-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/11111111-1111-4111-8111-111111111111')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-client-detail-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
