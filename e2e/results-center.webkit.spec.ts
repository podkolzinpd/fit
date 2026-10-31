import { mockTrainingSummaries } from './native-summary-fixture'
import { nativeSignIn } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { mockResultsHistory, verifyResultsSources } from './progress-results-fixture'

test('iPhone results keep filters after source navigation while AI is unavailable', async ({ page }) => {
  await mockResultsHistory(page)
  await mockTrainingSummaries(page, 'client', [])
  for (const url of ['**/v1/clients/*/training-summaries/generate']) {
    await page.route(url, (route) => route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }))
  }
  await page.goto('/auth')
  await nativeSignIn(page, 'client@fit.local')
  await expect(page).toHaveURL(/\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/me/progress')
  await verifyResultsSources(page)
  const center = page.locator('#results-center')
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('volume')
  const volume = center.locator('.center-result-row').first()
  await volume.getByText('Подходы, вес и повторы', { exact: true }).click()
  await expect(volume).toContainText('50 кг × 12 повт.')
  await expect(volume).toContainText('Итого: 1 100 кг')
  const weekly = page.locator('.weekly-training-load')
  await weekly.getByText('Нагрузка по неделям', { exact: true }).click()
  await expect(weekly.locator('.weekly-load-list > li').first()).toContainText('Кардио: 2 · Без группы: 1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
