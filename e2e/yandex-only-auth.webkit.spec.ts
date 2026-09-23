import { expect, test } from '@playwright/test'

test('Yandex-only entry has one primary action at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete default-off Yandex-only auth switches.',
  )
  let legacyAuthRequests = 0
  await page.route('**/auth/v1/**', (route) => {
    legacyAuthRequests += 1
    return route.abort('failed')
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/auth')

    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Авторизация через Yandex ID' })).toBeVisible()
    await expect(page.getByText('Вход и регистрация выполняются через Yandex ID.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass(/primary/)
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByLabel('Пароль')).toHaveCount(0)
    await expect(page.getByText('Забыли пароль?')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`yandex-only-entry-${viewport.width}.png`),
      fullPage: true,
    })

    if (viewport.width === 390) {
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'dark')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
      await expect(page.locator('html')).not.toHaveClass(/theme-light/)
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
      await page.screenshot({
        path: testInfo.outputPath('yandex-only-entry-dark-390.png'),
        fullPage: true,
      })
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'light')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
    }

    await page.goto('/auth/forgot')
    await expect(page).toHaveURL(/\/auth$/)
  }
  expect(legacyAuthRequests).toBe(0)
})

test('restored Yandex session completes the legal check after reload', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex-only session switches.',
  )
  let legacyAuthRequests = 0
  await page.route('**/auth/v1/**', (route) => {
    legacyAuthRequests += 1
    return route.abort('failed')
  })
  const token = 'a'.repeat(43)
  let legalRequests = 0
  await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
    await route.fulfill({
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
    })
  })
  await page.route('https://stage.example.test/v1/legal/acceptance', async (route) => {
    legalRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applicable: true, accepted: false, acceptedAt: null }),
    })
  })
  await page.addInitScript(([sessionToken]) => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: sessionToken,
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  }, [token])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
  await expect(page.getByText('Проверяем документы…')).toHaveCount(0)
  expect(legalRequests).toBe(2)
  expect(legacyAuthRequests).toBe(0)
})
