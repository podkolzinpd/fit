import { nativeSignIn } from './native-local-fixture'
import { expect, test, type CDPSession, type Page } from './native-local-fixture'

async function loginAsTrainer(page: Page) {
  await nativeSignIn(page, 'trainer')
  await expect(page).toHaveURL(/\/today$/)
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
  await page.route("**/v1/clients", (route) => route.fulfill({ json: { clients: [{
      id: clientId, canArchive: true, hasAccount: false,
      fullName: 'Анна Смирнова', canonicalFullName: 'Анна Смирнова',
      gender: null, ageYears: 30, ageUpdatedAt: '2026-08-01', heightCm: 170,
      goal: null, note: null, currentWeightKg: 65,
      lastActivityAt: '2026-09-18T10:00:00.000Z', archivedAt: null,
      version: 1, membershipVersion: 1,
    }] } }))
  await page.route("**/v1/chat/threads", (route) => route.fulfill({ json: { threads: [] } }))
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
