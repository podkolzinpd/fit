import { expect, test, type Page } from '@playwright/test'
import { clientId, mockClientStreamingVoice, mockPilot, trainerId } from './fit-lime-fixtures'

async function homeFixture(page: Page, theme: string, lime = true, firstRun = false) {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'))
  await mockPilot(page, { role: 'client', profileId: clientId, clientLime: lime })
  await page.route('**/v1/auth/yandex/session', route => route.fulfill({ json: { accessMode: 'read_write', profile: {
    id: clientId, firstName: 'Анна', lastName: null, timezone: 'Europe/Moscow', accountRole: 'client',
    client: { id: clientId, trainerId, fullName: 'Анна' }, experiments: { trainerScheduleV2: true, nutrition: true, clientLime: lime },
  } } }))
  if (firstRun) await page.route('**/v1/clients', route => route.fulfill({ json: { clients: [] } }))
  const state = { mode: 'data', reads: 0 }
  await page.route(/\/v1\/me\/nutrition\?/, route => {
    state.reads++
    if (state.mode === 'error') return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    return route.fulfill({ json: { access: 'granted', entries: state.mode === 'empty' ? [] : [{
      id: 'f00d0000-6010-4000-8000-000000000013', day: '2026-10-15', meal: 'lunch', name: 'Курица с рисом',
      basis: '100g', grams: 150, calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8,
      totals: { calories: 228.3, protein: null, fat: 6.3, carbs: 28.2 }, version: 1,
      updatedAt: '2026-10-15T12:00:00Z', deletedAt: null,
    }], totals: { calories: 228.3, protein: null, fat: 6.3, carbs: 28.2 } } })
  })
  await page.addInitScript(({ id, theme }) => {
    localStorage.setItem('fit.appTheme', theme)
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify([...seen, 'nutrition-client-20261010']))
    localStorage.setItem('fit.installDismissed', 'true')
  }, { id: clientId, theme })
  return state
}

test.beforeEach(() => test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires isolated Yandex auth lane'))

for (const theme of ['light', 'dark']) test(`nutrition home uses one vertical surface and compact real states ${theme}`, async ({ page }, info) => {
  const state = await homeFixture(page, theme)
  await page.goto('/me')
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
  const card = page.getByRole('region', { name: 'Питание сегодня', exact: true })
  await expect(card.getByText('228,3 ккал', { exact: true })).toBeVisible()
  await expect(card.getByText('Записано за день', { exact: true })).toBeVisible()
  await expect(card).toContainText('итог БЖУ неполный')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 932 })
    await card.scrollIntoViewIfNeeded()
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).display)).toBe('grid')
    const bounds = (await card.boundingBox())!
    const add = card.getByRole('link', { name: 'Добавить еду' })
    const button = (await add.boundingBox())!
    const totals = (await card.locator('.nutrition-totals').boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(48)
    expect(button.y).toBeGreaterThanOrEqual(totals.y + totals.height)
    expect(button.x).toBeGreaterThanOrEqual(bounds.x)
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(await add.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
    expect(await card.locator('.nutrition-totals strong').evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`nutrition-home-${theme}-${width}.png`) })
  }
  state.mode = 'empty'
  await page.reload()
  await expect(card.getByText('Сегодня записей нет')).toBeVisible()
  await expect(card.getByText('Записано за день', { exact: true })).toHaveCount(0)
  await expect(card.getByText('228,3 ккал')).toHaveCount(0)
  state.mode = 'error'
  await page.reload()
  await expect(card.getByRole('alert')).toContainText('Не удалось загрузить питание.')
  await expect(card.getByText('Сегодня записей нет')).toHaveCount(0)
  state.mode = 'data'
  await card.getByRole('button', { name: 'Повторить' }).click()
  await expect(card.getByText('228,3 ккал')).toBeVisible()
})

for (const mode of ['lime', 'identity', 'first-run']) test(`nutrition unmounts throughout workout voice/text flow ${mode}`, async ({ page }, info) => {
  await homeFixture(page, 'dark', mode === 'lime', mode === 'first-run')
  await mockClientStreamingVoice(page)
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices
    const get = devices.getUserMedia.bind(devices)
    Object.defineProperty(devices, 'getUserMedia', { value: () => new Promise(resolve => {
      Object.assign(window, { grantNutritionTestMicrophone: () => { void get({ audio: true }).then(resolve) } })
    }) })
  })
  await page.goto('/me')
  await expect(page.locator('.phone-frame')).toHaveClass(mode === 'lime' ? /fit-client-lime/ : /client-home-identity/)
  // Count hidden DOM nodes too: workout input must unmount the summary.
  const card = page.locator('section.nutrition-summary')
  await expect(card.getByText('228,3 ккал')).toBeVisible()
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.locator('.voice-action-requesting')).toBeVisible()
  await expect(card).toHaveCount(0)
  await page.evaluate(() => { (window as unknown as { grantNutritionTestMicrophone(): void }).grantNutritionTestMicrophone() })
  await expect(page.getByRole('heading', { name: 'Слушаю…' })).toBeVisible()
  await expect(card).toHaveCount(0)
  await page.screenshot({ path: info.outputPath(`nutrition-absent-recording-${mode}.png`) })
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  if (mode === 'lime') {
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
  }
  await expect(card.getByText('228,3 ккал')).toBeVisible()
  await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
  }))
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Нет доступа к микрофону' })).toBeVisible()
  await expect(card).toHaveCount(0)
  if (mode !== 'first-run') {
    await page.getByRole('button', { name: 'Ввести текстом', exact: true }).click()
    await expect(page.locator('.today-text-fallback')).toBeVisible()
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
    await expect(card.getByText('228,3 ккал')).toBeVisible()
  }
})

test('nutrition shared trainer summary keeps consent and one-column layout at compact and desktop widths', async ({ page }, info) => {
  await mockPilot(page, { role: 'trainer', profileId: trainerId })
  await page.route('**/v1/auth/yandex/session', route => route.fulfill({ json: { accessMode: 'read_write', profile: {
    id: trainerId, firstName: 'Тренер', lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer',
    experiments: { trainerScheduleV2: true, nutrition: true },
  } } }))
  await page.route(/\/v1\/clients\/[^/]+\/nutrition\?/, route => route.fulfill({ json: { access: 'locked', entries: [], totals: null } }))
  await page.addInitScript(id => {
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify([...seen, 'nutrition-trainer-20261010']))
  }, trainerId)
  await page.goto(`/clients/${clientId}`)
  const card = page.getByRole('region', { name: 'Питание сегодня', exact: true })
  await expect(card).toContainText('Клиент пока не разрешил просмотр дневника.')
  await expect(card.getByRole('link', { name: 'Добавить еду' })).toHaveCount(0)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await card.scrollIntoViewIfNeeded()
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).display)).toBe('grid')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`nutrition-trainer-locked-${width}.png`) })
  }
})
