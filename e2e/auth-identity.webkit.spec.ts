import { expect, test } from '@playwright/test'

test('auth identity remains usable in WebKit light and dark themes', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Пароль')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Войти(?: по email)?$/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByLabel('Тип аккаунта')).toBeVisible()
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0)

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await page.goto('/auth/forgot')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('native Yandex registration is the primary mobile action at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true',
    'Run with the native Yandex registration switch to verify the default-off flow.',
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByLabel('Тип аккаунта')).toHaveValue('trainer')
  await expect(page.getByLabel('Имя')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await expect(page.getByLabel('Пароль')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать по email' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Условия использования' }).first()).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('yandex-native-registration-390.png'), fullPage: true })

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await page.setViewportSize({ width: 430, height: 932 })
  await page.reload()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID', exact: true })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('yandex-native-registration-430-dark.png'), fullPage: true })
})

test('invitation opens a Yandex-first auth path at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex auth switches to verify the invitation handoff.',
  )

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/join?code=AB12CD34EF56')

    await expect(page).toHaveURL(/\/auth$/)
    await expect(page.getByText('Войдите или создайте аккаунт, чтобы продолжить по приглашению.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass(/primary/)
    await expect(page.getByRole('button', { name: 'Войти по email' })).toHaveClass(/secondary/)

    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByLabel('Тип аккаунта')).toHaveValue('client')
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeVisible()
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`yandex-invitation-auth-${viewport.width}.png`),
      fullPage: true,
    })
  }
})

test('protected invitation link previews and survives Yandex registration at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex auth switches to verify the protected invitation handoff.',
  )
  const token = `AB12CD34EF56.${'a'.repeat(64)}`
  await page.route('**/v1/invitation-links/preview', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ invitation: {
        targetRole: 'client',
        inviterName: 'Анастасия',
        expiresAt: '2099-09-25T12:00:00.000Z',
        status: 'active',
      } }),
    })
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(`/invite?token=${token}`)

    await expect(page.getByRole('heading', { name: 'Тренироваться вместе' })).toBeVisible()
    await expect(page.getByText('Анастасия приглашает вас тренироваться вместе в Fit.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Войти и подключиться' })).toHaveClass(/primary/)
    await expect(page.getByRole('link', { name: 'Зарегистрироваться' })).toHaveClass(/secondary/)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`protected-invitation-${viewport.width}.png`),
      fullPage: true,
    })

    await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
    await expect(page).toHaveURL(/\/auth$/)
    await expect(page.getByLabel('Тип аккаунта')).toHaveValue('client')
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeVisible()
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`protected-invitation-auth-${viewport.width}.png`),
      fullPage: true,
    })
  }
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
  await page.getByRole('button', { name: /^Войти(?: по email)?$/ }).click()

  await expect(page.getByRole('alert')).toHaveText('Не удалось войти. Проверьте интернет и попробуйте ещё раз.')
  await expect(page.getByRole('button', { name: /^Войти(?: по email)?$/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /^Войти(?: по email)?$/ })).toHaveAttribute('aria-busy', 'false')
  expect(requests).toBe(2)
})

test('Yandex ID app session restores and logs out in mobile WebKit', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true',
    'Run with the Yandex app-session switch to verify the default-off route.',
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

test('Yandex ID restore failure leaves loading and allows a local reset in mobile WebKit', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true',
    'Run with the Yandex app-session switch to verify the default-off route.',
  )
  await page.route('https://stage.example.test/v1/auth/yandex/session', (route) => route.abort('failed'))
  await page.addInitScript(() => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: 'a'.repeat(43),
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
    window.localStorage.setItem('fit.appTheme', 'dark')
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth/yandex/session')

  await expect(page.getByRole('alert')).toContainText('Не удалось подключиться к Yandex Cloud stage.')
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сбросить сессию Yandex ID' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.getByRole('button', { name: 'Сбросить сессию Yandex ID' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.evaluate(() => window.localStorage.getItem('fit.yandexAppSession.v1'))).resolves.toBeNull()
  await expect(page.evaluate(() => window.localStorage.getItem('fit.appTheme'))).resolves.toBe('dark')
})

for (const account of [
  { role: 'тренера', email: 'trainer@fit.local', home: /\/today$/, profile: '/profile/settings' },
  { role: 'клиента', email: 'client@fit.local', home: /\/me$/, profile: '/me/settings' },
]) {
  test(`выход ${account.role} не падает при обрыве серверного revoke`, async ({ page }) => {
    await page.goto('/auth')
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Пароль').fill('FitLocal123!')
    await page.getByRole('button', { name: /^Войти(?: по email)?$/ }).click()
    await expect(page).toHaveURL(account.home)
    await page.route('**/auth/v1/logout*', (route) => route.abort('failed'))

    await page.goto(account.profile)
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()

    await expect(page).toHaveURL(/\/auth$/)
    await page.waitForTimeout(250)
    expect(pageErrors.filter((message) => /RepositoryError|Не удалось выйти/i.test(message))).toEqual([])
  })
}
