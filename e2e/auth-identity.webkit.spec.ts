import { expect, test, nativeSignIn } from './native-local-fixture'

for (const account of [
  { role: 'trainer', profile: '/profile/settings' },
  { role: 'client', profile: '/me/settings' },
] as const) {
  test(`native ${account.role} clears its local session and exposes an unconfirmed server logout`, async ({ page }) => {
    await nativeSignIn(page, account.role, account.role)
    await page.goto(account.profile)
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
    await page.route('**/v1/auth/yandex/session', async route => {
      if (route.request().method() === 'DELETE') await route.abort('failed')
      else await route.fallback()
    })
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('сервер не подтвердил выход')
    await expect(page.getByRole('button', { name: 'Повторить проверку' })).toBeVisible()
    await expect(page).toHaveURL(/\/auth$/)
    expect(await page.evaluate(() => localStorage.getItem('fit.yandexAppSession.v1'))).toBeNull()
    expect(pageErrors).toEqual([])
  })
}

test('retired password routes return to the native entry without a legacy request', async ({ page }) => {
  const legacyRequests: string[] = []
  page.on('request', request => {
    if (/\/(auth|rest|storage)\/v1\//.test(request.url())) legacyRequests.push(new URL(request.url()).pathname)
  })
  for (const path of ['/auth/forgot', '/auth/reset', '/auth/callback']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/auth$/)
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByLabel('Пароль')).toHaveCount(0)
  }
  expect(legacyRequests).toEqual([])
})
