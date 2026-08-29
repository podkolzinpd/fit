import { expect, test } from '@playwright/test'

test('client profile: trainer can complete a client profile from the detail page', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients/11111111-1111-4111-8111-111111111111')

  await page.getByRole('button', { name: 'Действия с профилем спортсмена' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна Смирнова')
  await expect(page.getByLabel('Возраст')).toBeVisible()
  await expect(page.getByLabel('Цель')).toBeVisible()
})

test('client without monochrome preview keeps the current Profile identity', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Профиль без preview')
  await page.getByLabel('Email').fill(`profile-no-preview-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/profile')
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/client-profile-shell-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})
