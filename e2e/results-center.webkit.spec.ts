import { expect, test } from '@playwright/test'
import { mockResultsHistory, verifyResultsSources } from './progress-results-fixture'

test('iPhone results keep filters after source navigation while AI is unavailable', async ({ page }) => {
  await mockResultsHistory(page)
  await page.route('**/rest/v1/client_published_training_summaries?*', (route) => route.fulfill({ json: [] }))
  for (const url of ['**/v1/legacy/summarize-client-training', '**/functions/v1/summarize-client-training']) {
    await page.route(url, (route) => route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }))
  }
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/me/progress')
  await verifyResultsSources(page)
  const center = page.locator('#results-center')
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('volume')
  const volume = center.locator('.center-result-row').first()
  await volume.getByText('Из чего сложился объём', { exact: true }).click()
  await expect(volume).toContainText('50 кг × 12 повт.')
  await expect(volume).toContainText('Итого: 1 100 кг')
  const weekly = page.locator('.weekly-training-load')
  await weekly.getByText('Подходы по неделям', { exact: true }).click()
  await expect(weekly.locator('.weekly-load-list > li').first()).toContainText('По зонам: 3. Кардио: 2. Без определённой зоны: 1.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
