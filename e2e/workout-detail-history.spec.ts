import { nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new client the workout detail and exercise history identity', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `detail-flag-off-${randomUUID()}@fit.local`, firstName: 'Detail flag off', role: 'client' })
  await expect(page).toHaveURL(/\/me$/)

  for (const path of ['/workouts/missing-workout', '/workouts/missing-workout/history/bench-press']) {
    await page.goto(path)
    await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
    await expect(page.locator('html')).toHaveClass(/ui-identity/)
  }
})
