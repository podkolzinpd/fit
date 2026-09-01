import { expect, test } from '@playwright/test'

test('auth identity remains usable in WebKit light and dark themes', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Пароль')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByLabel('Тип аккаунта')).toBeVisible()

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await page.goto('/auth/forgot')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('password sign-in retries a network failure and unlocks the WebKit form', async ({ page }) => {
  let requests = 0
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    requests += 1
    await route.abort('failed')
  })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@example.test')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()

  await expect(page.getByRole('alert')).toHaveText('Не удалось войти. Проверьте интернет и попробуйте ещё раз.')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toHaveAttribute('aria-busy', 'false')
  expect(requests).toBe(2)
})

test('Yandex ID app session restores and logs out in mobile WebKit', async ({ page }) => {
  const allowlist = (process.env.VITE_YANDEX_APP_SESSION_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
  test.skip(
    process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || !allowlist.includes('d2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'),
    'Run with Yandex app-session env to verify the default-off route.',
  )
  const token = 'a'.repeat(43)
  let revokeCount = 0
  await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
    if (route.request().method() === 'DELETE') {
      revokeCount += 1
      await route.fulfill({ status: 204 })
      return
    }
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
  await page.addInitScript(([sessionToken]) => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: sessionToken,
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  }, [token])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth/yandex/session')
  await expect(page.getByRole('heading', { name: 'Сессия работает' })).toBeVisible()
  await expect(page.getByText('Ирина')).toBeVisible()
  await expect(page.getByText('Основной интерфейс пока не переключён')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(token)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.setViewportSize({ width: 430, height: 932 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Сессия работает' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.getByRole('button', { name: 'Выйти из Yandex ID' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await expect.poll(() => revokeCount).toBe(1)
  await expect(page.evaluate(() => window.localStorage.getItem('fit.yandexAppSession.v1'))).resolves.toBeNull()
})
