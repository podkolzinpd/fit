import { nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Client Detail identity', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `client-detail-flag-off-${randomUUID()}@fit.local`, firstName: 'Client detail flag off', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/11111111-1111-4111-8111-111111111111')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})
