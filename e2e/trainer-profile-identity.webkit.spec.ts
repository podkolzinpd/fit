import { expect, test } from '@playwright/test'

test('trainer profile controls and feedback fit the iOS shell', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  await expect(page.getByRole('switch', { name: 'Показывать RPE в подходах' })).toBeVisible()
  await page.getByRole('button', { name: 'Fit на экране «Домой»' }).click()
  await expect(page.getByRole('heading', { name: 'Установите Fit на iPhone' })).toBeVisible()
  await expect(page.getByText('Откройте эту страницу в Safari.')).toBeVisible()
  await expect(page.getByText(/На экран „Домой“/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await expect(page.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
