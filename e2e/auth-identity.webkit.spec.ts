import { expect, test } from '@playwright/test'

test('auth identity remains usable in WebKit light and dark themes', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/identity-monochrome-preview/)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Пароль')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()

  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByLabel('Тип аккаунта')).toBeVisible()

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await page.goto('/auth/forgot')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
