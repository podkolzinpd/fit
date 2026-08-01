import { expect, test } from '@playwright/test'

test('client profile: trainer can complete a client profile from the detail page', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients/11111111-1111-4111-8111-111111111111')

  await expect(page.getByRole('link', { name: 'Редактировать профиль' })).toBeVisible()
  await page.getByRole('link', { name: 'Редактировать профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна Смирнова')
  await expect(page.getByLabel('Возраст')).toBeVisible()
  await expect(page.getByLabel('Цель')).toBeVisible()
})
