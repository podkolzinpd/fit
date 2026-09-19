import { expect, test } from '@playwright/test'

test('Yandex-only entry has one primary action at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete default-off Yandex-only auth switches.',
  )

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/auth')

    await expect(page.getByRole('heading', { name: 'Вход в FIT' })).toBeVisible()
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

    await page.goto('/auth/forgot')
    await expect(page).toHaveURL(/\/auth$/)
  }
})
