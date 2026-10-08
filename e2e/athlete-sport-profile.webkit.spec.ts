import { expect, test } from '@playwright/test'

for (const lime of [false, true]) {
  test(`athlete sport profile saves and reopens on iPhone (${lime ? 'lime' : 'mono'})`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
    const actorId = 'a90c2a50-30bc-43ad-bad9-17fb6d22c11c'
    const clientId = 'b90c2a50-30bc-43ad-bad9-17fb6d22c11c'
    let version = 1
    let saveCount = 0
    let sport = { sports: [] as string[], bio: null as string | null }

    await page.route('https://stage.example.test/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: {
      'x-fit-request-id': 'synthetic-health', 'access-control-expose-headers': 'x-fit-request-id',
    } }))
    await page.route('https://stage.example.test/v1/**', async (route) => {
      const { pathname } = new URL(route.request().url())
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
        'access-control-allow-headers': '*',
      } })
      if (pathname === '/v1/auth/yandex/session') return route.fulfill({ json: {
        accessMode: 'read_write', profile: { id: actorId, firstName: 'Анна', lastName: null,
          timezone: 'Europe/Moscow', accountRole: 'client',
          client: { id: clientId, trainerId: 'c90c2a50-30bc-43ad-bad9-17fb6d22c11c', fullName: 'Анна' },
          experiments: { clientLime: lime, fitLime: false, trainerScheduleV2: false } },
      } })
      if (pathname === '/v1/legal/acceptance') return route.fulfill({ json: {
        applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z',
      } })
      if (pathname === '/v1/clients') return route.fulfill({ json: { clients: [{ id: clientId,
        canArchive: false, hasAccount: true, fullName: 'Анна', canonicalFullName: 'Анна',
        gender: 'female', ageYears: 30, ageUpdatedAt: '2026-09-01', heightCm: 170,
        goal: null, note: null, currentWeightKg: null, archivedAt: null, version,
        membershipVersion: null }] } })
      if (pathname === `/v1/clients/${clientId}/progress`) return route.fulfill({ json: {
        entries: [], customMetrics: [], goal: null,
      } })
      if (pathname === '/v1/me/sport-profile') return route.fulfill({ json: { sport } })
      if (pathname === '/v1/me/client-profile' && route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { sport: typeof sport }
        sport = body.sport
        version += 1
        saveCount += 1
        return route.fulfill({ json: { client: { id: clientId, version } } })
      }
      if (pathname === '/v1/connections') return route.fulfill({ json: { memberships: [], invitations: [] } })
      if (pathname === '/v1/me/finance') return route.fulfill({ json: { finance: { trainers: [] } } })
      return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    })

    await page.goto('/me/edit')
    await expect(page.getByRole('heading', { name: 'Редактировать профиль' })).toBeVisible()
    await expect(page.getByLabel('Возраст')).toHaveValue('30')
    await page.getByLabel('Поиск по видам спорта').fill('йога')
    await page.getByRole('button', { name: 'Йога' }).click()
    await page.getByLabel('Поиск по видам спорта').fill('')
    for (const name of ['Бег', 'Плавание', 'Футбол', 'Бокс', 'Походы', 'Танцы']) {
      await page.getByRole('button', { name }).click()
    }
    await page.getByLabel('О себе в спорте').fill('Тренируюсь по утрам')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`athlete-sports-edit-${lime ? 'lime' : 'mono'}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(() => saveCount).toBe(1)
    await expect(page).toHaveURL(/\/me$/, { timeout: 20_000 })

    await page.goto('/me/edit')
    await expect(page.getByRole('button', { name: 'Йога' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('О себе в спорте')).toHaveValue('Тренируюсь по утрам')
    await page.goto('/me/profile')
    await expect(page.getByText('Тренируюсь по утрам')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Показать ещё 1' })).toBeVisible()
    await page.getByRole('button', { name: 'Показать ещё 1' }).click()
    await expect(page.getByText('Танцы')).toBeVisible()
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath(`athlete-sports-profile-${lime ? 'lime' : 'mono'}.png`), fullPage: true })
  })
}
