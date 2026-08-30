import { expect, test } from '@playwright/test'

const rolloutOff = process.env.VITE_MONOCHROME_ROLLOUT_MODE === 'off'

async function signIn(page: import('@playwright/test').Page, email: string, destination: RegExp) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(destination)
}

function expectIdentity(locator: import('@playwright/test').Locator, className: RegExp) {
  return rolloutOff
    ? expect(locator).not.toHaveClass(className)
    : expect(locator).toHaveClass(className)
}

test('rollout switch controls public auth and Client Home', async ({ page }) => {
  await page.goto('/auth')
  await expectIdentity(page.locator('.auth-screen'), /auth-flow-identity/)
  await expectIdentity(page.locator('html'), /identity-monochrome-preview/)

  await signIn(page, 'client@fit.local', /\/me$/)
  await expectIdentity(page.locator('.phone-frame'), /client-home-identity/)
  await expectIdentity(page.locator('html'), /identity-monochrome-preview/)
})

test('rollout switch controls Trainer Today', async ({ page }) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await expectIdentity(page.locator('.phone-frame'), /trainer-today-identity/)
  await expectIdentity(page.locator('html'), /identity-monochrome-preview/)
})
