import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Client Form identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Client form flag off')
  await page.getByLabel('Email').fill(`client-form-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expect(page.locator('html')).toHaveClass(/identity-monochrome-preview/)
})

test('trainer Client Create keeps existing validation under monochrome preview', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await expect(page).toHaveURL(/\/clients\/new$/)
})
