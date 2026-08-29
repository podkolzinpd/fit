import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Client Detail identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Client detail flag off')
  await page.getByLabel('Email').fill(`client-detail-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/11111111-1111-4111-8111-111111111111')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  await expect(page.locator('html')).toHaveClass(/identity-monochrome-preview/)
})
