import { expect, test } from '@playwright/test'

test('Today shows the support code for failed Yandex training-data requests', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with Yandex app-session and sticky main routing enabled.',
  )

  const token = 'a'.repeat(43)
  const requestId = '18940d82-9075-48d2-a847-8feee301b4d7'
  await page.route('https://stage.example.test/v1/auth/yandex/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      accessMode: 'read_write',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
    }),
  }))
  await page.route('https://stage.example.test/v1/legal/acceptance', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ applicable: true, accepted: true, acceptedAt: '2026-09-20T10:00:00.000Z' }),
  }))
  await page.route('https://stage.example.test/v1/clients*', (route) => route.fulfill({
    status: 500,
    headers: { 'x-fit-request-id': '3f918916-f84c-46c4-a4bb-30b28a6fd9b1' },
  }))
  await page.route('https://stage.example.test/v1/training-data*', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    headers: {
      'access-control-expose-headers': 'x-fit-request-id',
      'x-fit-request-id': requestId,
    },
    body: JSON.stringify({ error: 'internal_error' }),
  }))
  await page.addInitScript(([sessionToken]) => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: sessionToken,
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  }, [token])

  await page.goto('/today')

  const errors = page.locator('.request-error-inline')
  await expect(errors).toHaveCount(2)
  await expect(errors.first()).toContainText('Не удалось загрузить задачи по клиентам.')
  await expect(errors.last()).toContainText('Не удалось загрузить данные тренировок из stage.')
  await expect(errors).toContainText(['FIT-8FEE-E301-B4D7', 'FIT-8FEE-E301-B4D7'])
  await expect(page.getByRole('button', { name: 'Скопировать диагностику' })).toHaveCount(2)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
