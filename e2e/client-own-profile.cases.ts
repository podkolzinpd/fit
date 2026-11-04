import { expect, test } from '@playwright/test'
import { mockPilot, clientId } from './fit-lime-fixtures'

export function ownProfileCases() {
  test('Own profile photo uses its canonical card and survives reload and a version conflict', async ({ page }, info) => {
    await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true })
    let url: string | null = null, version = 0, attempts = 0
    await page.route(`**/v1/clients/${clientId}/photo`, async route => {
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON() as { expectedVersion: number; photo: { dataUrl: string; sizeBytes: number; width: number; height: number } }
        expect(input.expectedVersion).toBe(version)
        expect(input.photo.sizeBytes).toBeLessThanOrEqual(160000)
        expect(Math.max(input.photo.width, input.photo.height)).toBeLessThanOrEqual(480)
        attempts++
        if (attempts === 1) { version = 3; return route.fulfill({ status: 409, json: { error: 'client_conflict' } }) }
        url = input.photo.dataUrl; version++
      }
      await route.fulfill({ json: { url, version } })
    })
    await page.goto('/me/profile')
    const hero = page.getByRole('region', { name: 'Мои данные' })
    await expect(hero.getByRole('heading')).toHaveText('Алексей Смирнов')
    await expect(hero.locator('dd')).toHaveText(['—', '—', '—', '—'])
    await expect(hero.getByRole('link', { name: 'Изменить данные' })).toHaveAttribute('href', '/me/edit')
    const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 100; c.getContext('2d')!.fillRect(0, 0, 100, 100); return c.toDataURL('image/jpeg').split(',')[1]! })
    const input = hero.locator('input[type=file]')
    await expect(hero.getByRole('button', { name: 'Добавить фото профиля' })).toBeEnabled()
    await input.setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') })
    await expect(hero.getByRole('alert')).toBeVisible()
    await hero.getByRole('button', { name: 'Повторить загрузку фото' }).click()
    await expect(hero.getByRole('img')).toBeVisible()
    expect(attempts).toBe(2)
    await page.reload()
    await expect(hero.getByRole('img')).toHaveCSS('width', '121px')
    await expect(hero.getByRole('img')).toHaveCSS('height', '120px')
    await expect(hero.getByRole('button', { name: 'Изменить фото профиля' })).toBeEnabled()
    await page.screenshot({ path: info.outputPath('own-profile-photo.png'), fullPage: true })
  })

  // Geometry is a separate state fixture, not another upload/editing scenario.
  for (const [width, theme] of [[390, 'dark'], [430, 'light']] as const) {
    test(`Own profile header geometry ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 })
      await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
      await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true,
        clientRecords: [{ id: clientId, fullName: 'Алексей Александрович Смирнов-Задонский', archivedAt: null, version: 1 }] })
      await page.goto('/me/profile')
      const hero = page.getByRole('region', { name: 'Мои данные' })
      await expect(hero).toBeVisible()
      await expect(hero.locator('h2')).toContainText('Смирнов-Задонский')
      await expect(hero.locator('.client-own-photo-button')).toHaveCSS('width', '121px')
      await expect(hero.locator('.client-own-profile-edit')).toHaveCSS('min-height', '52px')
      await expect(page.getByRole('link', { name: 'Настройки профиля' })).toHaveAttribute('href', '/me/settings')
      await page.evaluate(() => document.fonts.ready)
      expect(await hero.locator('h2').evaluate(el => getComputedStyle(el).fontFamily)).toContain('YS Geo')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`own-profile-${theme}.png`), fullPage: true })
    })
  }
}
