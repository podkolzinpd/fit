import { expect, test } from '@playwright/test'

test('legal pages remain readable in the iPhone WebKit viewport', async ({ page }) => {
  await page.goto('/legal/terms')
  await expect(page.getByRole('heading', { level: 1, name: 'Условия использования' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '4. Ассистент' })).toBeVisible()
  await expect(page.locator('.legal-screen')).toHaveCSS('width', '390px')
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
})
