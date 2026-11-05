import { expect, test } from '@playwright/test'
import { mockNativeAiSession, nativeAiUrl } from './native-ai-fixture'

test('private analytics shows data and limits client filtering to clients', async ({ page }, info) => {
  await page.routeWebSocket('**/*', socket => socket.close())
  await mockNativeAiSession(page, 'trainer')
  await page.route('**/v1/private-analytics', route => route.fulfill({ json: {
    trainersTotal: 1, computedAt: '2026-11-05T09:00:00Z',
    trainers: [{ trainer_id: 'trainer', registered_at: '2026-10-01T00:00:00Z', trainer_status: 'active', clients_total: 2, clients_app_linked: 1, workouts_total: 4, workouts_done: 3, workouts_planned: 1, workouts_in_progress: 0 }],
    clients: [{ client_id: 'client-1', registered_at: '2026-10-02T00:00:00Z', is_self_registered: true, client_status: 'active' }, { client_id: 'client-2', registered_at: '2026-10-03T00:00:00Z', is_self_registered: false, client_status: 'new' }],
    feedback: [{ id: 'feedback', message: 'Тестовое сообщение', account_role: 'client' }],
  } }))
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    await page.goto(nativeAiUrl('/analytics'))
    await expect(page.getByRole('heading', { name: 'Аналитика Fit' })).toBeVisible()
    await expect(page.getByText('Тестовое сообщение')).toBeVisible()
    await page.getByLabel('Регистрация').selectOption('self')
    await expect(page.getByText('client-2')).toHaveCount(0)
    await expect(page.getByText('client-1')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`analytics-${width}.png`), fullPage: true })
  }
})

test('private analytics does not expose data when the server denies access', async ({ page }) => {
  await mockNativeAiSession(page, 'client')
  await page.route('**/v1/private-analytics', route => route.fulfill({ status: 403, json: { error: 'analytics_forbidden' } }))
  await page.goto(nativeAiUrl('/analytics'))
  await expect(page.getByRole('alert')).toContainText('Нет доступа')
  await expect(page.getByText('Данные клиентов')).toHaveCount(0)
})
