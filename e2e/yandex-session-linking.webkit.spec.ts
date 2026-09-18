import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, email: string, expectedUrl: RegExp) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(expectedUrl)
}

async function signInAsTrainer(page: Page) {
  await signIn(page, 'trainer@fit.local', /\/(today|clients)$/)
}

test('Yandex session linking entry stays hidden by default', async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_SESSION_LINKING_ENABLED === 'true', 'This check covers the default-off build.')
  await signInAsTrainer(page)

  await expect(page.getByRole('heading', { name: 'Привязать Yandex ID' })).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('Yandex session linking entry is visible on every trainer home when enabled', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true'
      || process.env.VITE_YANDEX_ACCOUNT_LINK_REQUIRED === 'true',
    'Run with the global Yandex linking env to verify the home entry.',
  )
  await page.route('**/v1/auth/yandex/link', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ linked: false }),
  }))
  await signInAsTrainer(page)

  await expect(page.getByRole('heading', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByText(/Пока вход по email и паролю остаётся доступен/)).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('Yandex session linking entry disappears from client home after linking', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true'
      || process.env.VITE_YANDEX_ACCOUNT_LINK_REQUIRED === 'true',
    'Run with the global Yandex linking env to verify the client home entry.',
  )
  await page.route('**/v1/auth/yandex/link', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ linked: true }),
  }))
  await signIn(page, 'client@fit.local', /\/me$/)

  await expect(page.getByRole('heading', { name: /Yandex ID/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Привязать Yandex ID' })).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('required Yandex linking blocks every protected route until the profile is linked', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true'
      || process.env.VITE_YANDEX_ACCOUNT_LINK_REQUIRED !== 'true',
    'Run with both Yandex linking switches to verify the required gate.',
  )
  await page.route('**/v1/auth/yandex/link', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ linked: false }),
  }))
  await signInAsTrainer(page)

  await expect(page.getByRole('heading', { name: 'Привяжите Yandex ID' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)

  await page.goto('/schedule')

  await expect(page).toHaveURL(/\/schedule$/)
  await expect(page.getByRole('heading', { name: 'Привяжите Yandex ID' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('required Yandex linking transparently keeps the app open for a linked profile', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true'
      || process.env.VITE_YANDEX_ACCOUNT_LINK_REQUIRED !== 'true',
    'Run with both Yandex linking switches to verify linked profiles.',
  )
  await page.route('**/v1/auth/yandex/link', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ linked: true }),
  }))
  await signIn(page, 'client@fit.local', /\/me$/)

  await expect(page.getByRole('heading', { name: 'Привяжите Yandex ID' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
