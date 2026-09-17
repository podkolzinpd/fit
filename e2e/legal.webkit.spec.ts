import { expect, test } from '@playwright/test'

for (const legalPage of [
  { path: '/legal/terms', title: 'Условия использования сервиса Fit', lastSection: '4. Изменение Условий' },
  { path: '/legal/privacy', title: 'Политика конфиденциальности', lastSection: '10. Изменения настоящей Политики конфиденциальности' },
]) {
  test(`${legalPage.title} scrolls to the end in the iPhone WebKit viewport`, async ({ page }) => {
    await page.goto(legalPage.path)
    await expect(page.getByRole('heading', { level: 1, name: legalPage.title })).toBeVisible()

    const legalScreen = page.locator('.legal-screen')
    await expect(legalScreen).toHaveCSS('width', '390px')
    const dimensions = await legalScreen.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)

    const scrollTop = await legalScreen.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })
    expect(scrollTop).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { level: 2, name: legalPage.lastSection })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Юридические документы' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
  })
}
