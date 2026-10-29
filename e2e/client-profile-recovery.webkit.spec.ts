import { expect, test } from '@playwright/test'
import { clientId, mockPilot, trainerId } from './fit-lime-fixtures'

test('client profile recovers a merged card and transient empty list without a new login', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
    || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires native Yandex composition.')
  const profileId = '22222222-2222-4222-8222-222222222222'
  const oldCardId = '44444444-4444-4444-8444-444444444444'
  const writes: string[] = []
  let sessionReads = 0
  let clientReads = 0
  await mockPilot(page, { role: 'client', profileId, clientLime: true })
  page.on('request', request => {
    if (request.url().includes('/v1/') && !['GET', 'OPTIONS'].includes(request.method())) {
      writes.push(new URL(request.url()).pathname)
    }
  })
  await page.route('**/v1/auth/yandex/session', route => {
    sessionReads += 1
    return route.fulfill({ json: { accessMode: 'read_write', profile: {
      id: profileId, firstName: 'Алексей', lastName: 'Смирнов', timezone: 'Europe/Moscow', accountRole: 'client',
      client: { id: sessionReads === 1 ? oldCardId : clientId, trainerId, fullName: 'Алексей Смирнов' },
      experiments: { clientLime: true, fitLime: false, trainerScheduleV2: false },
    } } })
  })
  await page.route('**/v1/clients', route => {
    clientReads += 1
    return clientReads === 1 ? route.fulfill({ json: { clients: [] } }) : route.fallback()
  })
  await page.goto('/me/profile')
  await expect(page.locator('.client-profile-identity strong')).toHaveText('Алексей Смирнов')
  await expect(page.getByRole('link', { name: 'Изменить данные' })).toBeVisible()
  await expect(page.getByText('Пока ничего нет', { exact: true })).toHaveCount(0)
  expect(sessionReads).toBeGreaterThanOrEqual(2)
  expect(clientReads).toBeGreaterThanOrEqual(2)
  // Restoring an existing session must not register, relink, or create a card.
  expect(writes.filter(path => path.startsWith('/v1/auth/') || path === '/v1/clients')).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('recovered-client-profile.png'), fullPage: true })
})
