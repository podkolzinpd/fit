import { expect, test } from '@playwright/test'

test('maintenance mode replaces every route without starting product requests', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_MAINTENANCE_MODE !== 'true',
    'Run with the explicit maintenance switch to verify the default-off cutover gate.',
  )

  const productRequests: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (
      url.includes('/auth/v1/')
      || url.includes('/rest/v1/')
      || url.includes('.containers.yandexcloud.net/')
    ) productRequests.push(url)
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Скоро вернёмся' })).toBeVisible()
  await expect(page.getByText('Доступ временно закрыт')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить снова' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('maintenance-390.png'), fullPage: true })

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/workouts/00000000-0000-4000-8000-000000000001/live')
  await expect(page.getByRole('heading', { name: 'Скоро вернёмся' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('maintenance-430-dark.png'), fullPage: true })

  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByRole('heading', { name: 'Скоро вернёмся' })).toBeVisible()
  expect(productRequests).toEqual([])
})
