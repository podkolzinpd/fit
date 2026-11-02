import { nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Today identity', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `today-flag-off-${randomUUID()}@fit.local`, firstName: 'Today flag off', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/today')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})
