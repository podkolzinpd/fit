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

  test('Own profile retains every subgoal and criterion when editing a stage and returning', async ({ page }, info) => {
    await page.clock.setFixedTime(new Date('2026-09-24T09:00:00+03:00'))
    await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true })
    const goalId = '10000000-0000-4000-8000-000000000040'
    const stages = [
      { id: '10000000-0000-4000-8000-000000000041', goalId, title: 'База', startsOn: '2026-09-01', endsOn: '2026-10-01', position: 0, version: 7 },
      { id: '10000000-0000-4000-8000-000000000042', goalId, title: 'Развитие', startsOn: '2026-10-02', endsOn: '2026-11-01', position: 1, version: 8 },
      { id: '10000000-0000-4000-8000-000000000043', goalId, title: 'Подводка', startsOn: '2026-11-02', endsOn: '2026-12-01', position: 2, version: 9 },
    ]
    const criteria = [{ id: '10000000-0000-4000-8000-000000000044', goalId, metric: 'weight', operation: 'track_only', targetValue: null, rangeMin: null, rangeMax: null, unit: 'кг', confirmationStatus: 'confirmed', position: 0, version: 3 }]
    const goal = { id: goalId, clientId, title: 'Подготовка к старту', targetDate: '2026-12-01', status: 'active', version: 4, criteria, stages }
    await page.route(`**/v1/clients/${clientId}/progress`, route => route.fulfill({ json: { entries: [], customMetrics: [], goal } }))
    let writes = 0
    await page.route(`**/v1/goal-stages/${stages[1]!.id}`, async route => {
      expect(route.request().method()).toBe('PUT')
      const input = route.request().postDataJSON() as { draft: { title: string; startsOn: string; endsOn: string; position: number }; expectedVersion: number }
      expect(input.expectedVersion).toBe(8)
      expect(input.draft).toMatchObject({ title: 'Темповой блок', startsOn: stages[1]!.startsOn, endsOn: stages[1]!.endsOn, position: 1 })
      Object.assign(stages[1]!, input.draft, { version: 9 }); writes++
      await route.fulfill({ json: { stage: stages[1] } })
    })
    await page.goto('/me/profile')
    const section = page.getByRole('region', { name: 'Моя цель' })
    await expect(section.getByText('Этап 1 из 3')).toBeVisible()
    await section.getByText('Все подцели · 3').click()
    await expect(section.locator('li strong')).toHaveText(['База', 'Развитие', 'Подводка'])
    await expect(section.getByText('Критериев оценки: 1')).toBeVisible()
    await section.getByRole('link', { name: 'Изменить цель и подцели' }).click()
    await expect(page).toHaveURL(/\/me\/goal$/)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/me\/profile$/)
    await section.getByRole('link', { name: 'Изменить цель и подцели' }).click()
    await page.locator('.stage-row').filter({ hasText: 'Развитие' }).getByRole('button', { name: 'Изменить', exact: true }).click()
    await page.getByLabel('Название этапа', { exact: true }).fill('Темповой блок')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page).toHaveURL(/\/me\/profile$/)
    await section.getByText('Все подцели · 3').click()
    await expect(section.locator('li strong')).toHaveText(['База', 'Темповой блок', 'Подводка'])
    await expect(section.getByText('Критериев оценки: 1')).toBeVisible()
    expect(writes).toBe(1); expect(criteria).toHaveLength(1)
    await page.reload()
    await section.getByText('Все подцели · 3').click()
    await expect(section.locator('li')).toHaveCount(3)
    await expect(section).toContainText('Темповой блок')
    await page.screenshot({ path: info.outputPath('own-profile-subgoals.png'), fullPage: true })
    await section.getByRole('link', { name: 'Изменить цель и подцели' }).click()
    await page.locator('.goal-block').first().getByRole('button', { name: 'Изменить', exact: true }).click()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page).toHaveURL(/\/me\/profile$/)
    expect(writes).toBe(1)
  })
}
