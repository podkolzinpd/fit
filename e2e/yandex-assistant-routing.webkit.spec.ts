import { expect, test, type Page } from '@playwright/test'

const trainerUserId = '90000000-0000-4000-8000-000000000009'

async function signInAsTrainer(page: Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('sticky Yandex Assistant gate is explicit and contained before app-session login', async ({ page }) => {
  const allowlist = (process.env.VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
  test.skip(
    process.env.VITE_YANDEX_ASSISTANT_ROUTING_ENABLED !== 'true'
      || !allowlist.includes(trainerUserId),
    'Run with the local trainer in the sticky Assistant rollout.',
  )

  await signInAsTrainer(page)
  await page.goto('/assistant')

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('heading', { name: 'Подтвердите Yandex ID' })).toBeVisible()
    await expect(page.getByText('автоматического перехода на Supabase не будет.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Подтвердить Yandex ID' })).toBeVisible()
    await expect(page.locator('.assistant-composer')).toHaveCount(0)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .resolves.toBe(true)
  }
})
