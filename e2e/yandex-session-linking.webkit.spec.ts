import { expect, test, type Page } from '@playwright/test'

const trainerUserId = '90000000-0000-4000-8000-000000000009'
const clientUserId = '92000000-0000-4000-8000-000000000029'

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

  await page.goto('/profile')

  await expect(page.getByRole('heading', { name: 'Привязать Yandex ID' })).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('Yandex session linking entry is visible for an allowlisted trainer', async ({ page }) => {
  const allowlist = (process.env.VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true' || !allowlist.includes(trainerUserId),
    'Run with Yandex linking env to verify the pilot entry on a real WebKit route.',
  )
  await signInAsTrainer(page)

  await page.goto('/profile')

  await expect(page.getByRole('heading', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByText('Текущий вход по email, паролю и Google не меняется.')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('Yandex session linking entry is visible for an allowlisted client', async ({ page }) => {
  const allowlist = (process.env.VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
  test.skip(
    process.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true' || !allowlist.includes(clientUserId),
    'Run with Yandex linking env to verify the pilot entry on a real client WebKit route.',
  )
  await signIn(page, 'client@fit.local', /\/me$/)

  await page.goto('/me/profile')

  await expect(page.getByRole('heading', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Привязать Yandex ID' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
