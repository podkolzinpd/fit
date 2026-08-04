import { expect, test } from '@playwright/test'

test('iPhone 13: ключевые экраны не выходят за ширину 390 px', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()

  for (const screen of ['/today', '/clients', '/schedule']) {
    await page.goto(screen)
    await expect(page.locator('main')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
