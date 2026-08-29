import { expect, test } from '@playwright/test'

test('exercise catalog search and technique detail work in the iOS shell', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await page.getByLabel('Поиск упражнения').fill('face pull')
  const result = page.locator('.catalog-media-card').first()
  await expect(result.locator('.exercise-image')).toBeVisible()
  await result.click()
  await expect(page.getByRole('dialog').locator('.exercise-image-technique')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
