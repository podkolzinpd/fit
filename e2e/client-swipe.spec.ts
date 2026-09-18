import { expect, test, type CDPSession, type Page } from '@playwright/test'

async function loginAsTrainer(page: Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  const submit = page.getByRole('button', { name: 'Войти' })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tokenResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/auth/v1/token?grant_type=password')
    ))
    await submit.click()
    const response = await tokenResponse
    if (response.ok()) {
      await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 })
      return
    }
    if (![502, 503, 504].includes(response.status()) || attempt === 4) {
      await expect(page, `Sign-in returned HTTP ${response.status()}`).toHaveURL(/\/today$/, { timeout: 15_000 })
      return
    }
    await expect(submit).toBeEnabled()
    await page.waitForTimeout(500 * (2 ** attempt))
  }
}

async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('trainer reveals client archive action with a real browser touch sequence', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch input is available in Chromium')
  const clientId = 'b9400000-0000-4000-8000-000000000001'
  await page.route('**/rest/v1/rpc/list_clients', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      id: clientId, can_archive: true, has_account: false,
      full_name: 'Анна Смирнова', canonical_full_name: 'Анна Смирнова',
      gender: null, age_years: 30, age_updated_at: '2026-08-01', height_cm: 170,
      goal: null, note: null, current_weight_kg: 65,
      last_activity_at: '2026-09-18T10:00:00.000Z', archived_at: null,
      version: 1, membership_version: 1,
    }]),
  }))
  await page.route('**/rest/v1/rpc/list_chat_threads', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await loginAsTrainer(page)
  await page.goto('/clients')

  const surface = page.locator('.client-swipe-surface')
  const rail = page.locator('.client-swipe-actions')
  await expect(surface).toBeVisible()
  const box = await surface.boundingBox()
  expect(box).not.toBeNull()
  const from = { x: box!.x + box!.width * 0.75, y: box!.y + box!.height / 2 }
  const cdp = await context.newCDPSession(page)

  await touchDrag(cdp, from, { x: from.x - 3, y: from.y + 80 })
  await expect(rail).toHaveAttribute('aria-hidden', 'true')

  await touchDrag(cdp, from, { x: from.x - 104, y: from.y + 2 })
  await expect(rail).toHaveAttribute('aria-hidden', 'false')
  await expect(page.getByRole('button', { name: 'В архив' })).toBeVisible()
  await expect(surface).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -112, 0)')
  await expect(page).toHaveURL(/\/clients$/)
})
