import { nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'

test('global rollout gives a new client the workout create and review identity', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `workout-flow-no-preview-${testInfo.workerIndex}-${Date.now()}@fit.local`, firstName: 'Тренировка без preview', role: 'client' })
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/workouts/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)

  await page.goto('/me?view=review')
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})
