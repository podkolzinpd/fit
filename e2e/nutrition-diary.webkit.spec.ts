import { expect, test, type Page } from '@playwright/test'
import { scaledNutrition, type NutritionDraft, type NutritionEntry, type NutritionValues } from '../src/shared/nutrition'

const actors = Array.from({ length: 5 }, (_, index) => `f00d0000-6010-4000-8000-00000000000${index + 1}`)
const clientId = 'f00d0000-6010-4000-8000-000000000011'
const food = { id: 'f00d0000-6010-4000-8000-000000000012', name: 'Курица с рисом', basis: '100g' as const,
  calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 }
async function fixture(page: Page, options: { role?: 'client' | 'trainer'; outside?: boolean; theme?: 'light' | 'dark'; lostResponse?: boolean } = {}) {
  await page.clock.install({ time: new Date('2026-10-10T09:00:00Z') })
  const role = options.role ?? 'client', actorId = options.outside ? 'f00d0000-6010-4000-8000-000000000009' : role === 'client' ? actors[0]! : actors[3]!
  const state = { entries: [] as NutritionEntry[], granted: false, searchError: false, saved: 0, writes: 0 }
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: {
    'x-fit-request-id': 'nutrition-synthetic-health', 'access-control-expose-headers': 'x-fit-request-id',
  } }))
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': '*' } })
    if (path === '/v1/auth/yandex/session') return route.fulfill({ json: { accessMode: 'read_write', profile: { id: actorId,
      firstName: role === 'client' ? 'Анна' : 'Тренер', lastName: null, timezone: 'Europe/Moscow', accountRole: role,
      client: role === 'client' ? { id: clientId, trainerId: actors[3], fullName: 'Анна' } : null,
      experiments: { clientLime: role === 'client', fitLime: role === 'trainer' && options.theme !== 'light', trainerScheduleV2: true } } } })
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
    if (path === '/v1/clients') return route.fulfill({ json: { clients: [{ id: clientId, canArchive: false, hasAccount: true,
      fullName: 'Анна', canonicalFullName: 'Анна', gender: 'female', ageYears: 30, ageUpdatedAt: '2026-09-01', heightCm: 170,
      goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null }] } })
    if (path.endsWith('/progress')) return route.fulfill({ json: { entries: [], customMetrics: [], goal: null } })
    if (path === '/v1/connections') return route.fulfill({ json: { memberships: [], invitations: [] } })
    if (path === '/v1/chat/threads') return route.fulfill({ json: { threads: [] } })
    if (path.endsWith('/nutrition/recent')) return route.fulfill({ json: { entries: state.entries.filter((entry) => !entry.deletedAt).slice().reverse() } })
    if (path === '/v1/nutrition/foods') return state.searchError ? route.fulfill({ status: 503, json: { error: 'nutrition_search_unavailable' } }) : route.fulfill({ json: { foods: url.searchParams.get('q') === 'неттакойеды' ? [] : [food], hasMore: false } })
    if (path.endsWith('/nutrition/consents')) {
      if (request.method() === 'PUT') { const body = request.postDataJSON() as { granted: boolean }; state.granted = body.granted; return route.fulfill({ json: { granted: state.granted } }) }
      return route.fulfill({ json: { connections: [{ clientId, trainerId: actors[3], name: 'Тренер Анны', connectionStartedAt: '2026-10-09T00:00:00Z', granted: state.granted }] } })
    }
    if (path.endsWith('/nutrition/entries') && request.method() === 'PUT') {
      const draft = request.postDataJSON() as NutritionDraft
      state.writes++
      const values = draft.food.kind === 'catalog' ? food : draft.food.kind === 'manual' ? draft.food : state.entries.find((entry) => entry.id === (draft.food.kind === 'recent' ? draft.food.entryId : ''))!
      const old = state.entries.find((entry) => entry.id === draft.id)
      const entry: NutritionEntry = { id: draft.id, day: draft.day, meal: draft.meal, name: values.name, basis: values.basis,
        grams: draft.grams, calories: values.calories, protein: values.protein, fat: values.fat, carbs: values.carbs,
        totals: scaledNutrition(values, values.basis, draft.grams), version: (old?.version ?? 0) + 1,
        updatedAt: '2026-10-10T09:00:00Z', deletedAt: null }
      state.entries = [...state.entries.filter((row) => row.id !== draft.id), entry]
      if (!old) state.saved++
      // The gateway loses the success response after commit. Retrying must
      // reuse the operation UUID; an error is not proof that nothing saved.
      if (options.lostResponse && state.writes === 1) return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
      return route.fulfill({ json: { entry } })
    }
    if (path.endsWith('/visibility')) {
      const id = path.split('/').at(-2), body = request.postDataJSON() as { deleted: boolean }
      const entry = state.entries.find((row) => row.id === id)!
      entry.deletedAt = body.deleted ? '2026-10-10T09:00:00Z' : null; entry.version++
      return route.fulfill({ json: { entry } })
    }
    if (path.endsWith('/nutrition')) {
      if (role === 'trainer' && !state.granted) return route.fulfill({ json: { access: 'locked', entries: [], totals: null } })
      const entries = state.entries.filter((entry) => entry.day === url.searchParams.get('day') && !entry.deletedAt)
      const sum = (key: keyof NutritionValues) => entries.some((entry) => entry.totals[key] === null) ? null : Math.round(entries.reduce((total, entry) => total + (entry.totals[key] ?? 0), 0) * 10) / 10
      const lastRecordedDay = state.entries.filter((entry) => !entry.deletedAt).map((entry) => entry.day).sort().at(-1) ?? null
      return route.fulfill({ json: { access: 'granted', entries, lastRecordedDay, totals: { calories: sum('calories') ?? 0, protein: sum('protein'), fat: sum('fat'), carbs: sum('carbs') } } })
    }
    return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
  })
  await page.addInitScript(({ actorId, theme }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'n'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    localStorage.setItem(`fit.clientLime.theme.${actorId}`, theme)
    localStorage.setItem('fit.appTheme', theme)
    localStorage.setItem(`fit.coachmarks-seen.${actorId}`, JSON.stringify(['nutrition-client-20261010', 'nutrition-trainer-20261010']))
  }, { actorId, theme: options.theme ?? 'dark' })
  return state
}
test.beforeEach(() => test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires isolated Yandex auth lane'))

async function verifiedFonts(page: Page) {
  const ready = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 16px "YS Geo"'), document.fonts.load('500 16px "YS Geo"')])
    await document.fonts.ready
    return document.fonts.check('400 16px "YS Geo"') && document.fonts.check('500 16px "YS Geo"')
  })
  expect(ready).toBe(true)
}

for (const theme of ['light', 'dark'] as const) test(`nutrition client complete diary flow ${theme}`, async ({ page }, info) => {
  const state = await fixture(page, { theme, lostResponse: true })
  await page.goto('/me/nutrition?date=2026-10-10')
  await expect(page.getByText('В этот день записей нет.', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Добавить еду', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Поиск еды' }).fill('курица')
  await page.getByRole('button', { name: /Курица с рисом/ }).click()
  await verifiedFonts(page)
  const grams = page.getByLabel('Сколько съели, г')
  await expect(grams).toHaveValue('')
  await expect(grams).toBeFocused()
  await expect(grams).toHaveAttribute('inputmode', 'decimal')
  await grams.fill('150')
  await expect(page.getByText('228,3 ккал')).toBeVisible()
  await page.getByLabel('Приём пищи').selectOption('lunch')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('link', { name: 'Добавить еду', exact: true }).click()
  await expect(grams).toHaveValue('150')
  await page.reload()
  await expect(grams).toHaveValue('150')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 932 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await page.getByLabel('Приём пищи').boundingBox())?.height).toBeGreaterThanOrEqual(48)
    await page.screenshot({ path: info.outputPath(`nutrition-quantity-${theme}-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(grams).toHaveValue('150')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  expect(state.saved).toBe(1)
  expect(state.writes).toBe(2)
  await page.getByRole('link', { name: 'Редактировать: Курица с рисом' }).click()
  await grams.fill('200')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toContainText('304,4 ккал')
  await page.getByRole('button', { name: 'Действия: Курица с рисом' }).click()
  await page.getByRole('menuitem', { name: 'Удалить запись', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toHaveCount(0)
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toHaveCount(1)
  await page.getByRole('link', { name: 'Добавить еду', exact: true }).click()
  await page.getByRole('button', { name: /Курица с рисом/ }).click()
  await expect(grams).toHaveValue('200')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toHaveCount(2)
  await page.getByText('Кто видит мой дневник', { exact: true }).click()
  const access = page.getByRole('switch', { name: 'Разрешить просмотр: Тренер Анны' })
  await expect(access).not.toBeChecked()
  await access.click()
  await expect.poll(() => state.granted).toBe(true)
  await expect(access).toBeChecked()
  await expect(access).toBeEnabled()
  await access.click()
  await expect.poll(() => state.granted).toBe(false)
  await expect(page.locator('main')).not.toContainText(/ВкусВилл|Лавка|vkusvill/i)
  await page.screenshot({ path: info.outputPath(`nutrition-diary-${theme}.png`), fullPage: true })
})

test('nutrition manual input, empty search and source failure remain separate', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/me/nutrition?date=2026-10-10&action=add')
  const search = page.getByRole('searchbox', { name: 'Поиск еды' })
  await search.fill('неттакойеды')
  await expect(page.getByText('Подходящей еды не нашлось.', { exact: false })).toBeVisible()
  state.searchError = true
  await search.fill('рис')
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить данные')
  await expect(page.getByText('Подходящей еды не нашлось.', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить свою еду' }).click()
  await page.getByLabel('Название', { exact: true }).fill('Домашний суп')
  await page.getByLabel('Калории съеденной порции').fill('220')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toContainText('Домашний суп')
  await expect(page.locator('.nutrition-day-summary')).toContainText('Б — · Ж — · У —')
  expect(state.entries[0]?.protein).toBeNull()
  await page.getByRole('link', { name: 'Редактировать: Домашний суп' }).click()
  await page.getByLabel('Калории съеденной порции').fill('250')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('.nutrition-entry')).toContainText('250 ккал')
})

for (const theme of ['light', 'dark'] as const) test(`nutrition trainer consent and read-only diary ${theme}`, async ({ page }, info) => {
  const state = await fixture(page, { role: 'trainer', theme })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('region', { name: 'Питание сегодня' })).toContainText('Клиент пока не разрешил')
  await page.getByRole('link', { name: 'Открыть дневник' }).click()
  await expect(page.getByText('Клиент пока не разрешил просмотр дневника.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Добавить еду' })).toHaveCount(0)
  state.granted = true
  state.entries.push({ ...food, id: 'f00d0000-6010-4000-8000-000000000013', day: '2026-10-10', meal: 'lunch', grams: 150,
    totals: scaledNutrition(food, '100g', 150), version: 1, updatedAt: '2026-10-10T09:00:00Z', deletedAt: null })
  await page.goto(`/clients/${clientId}/nutrition?date=2026-10-10`)
  await verifiedFonts(page)
  await expect(page.locator('.nutrition-entry')).toContainText('228,3 ккал')
  await page.getByText('Подробности записи', { exact: true }).click()
  await expect(page.getByText('Справочные КБЖУ на 100 г')).toBeVisible()
  await expect(page.getByRole('link', { name: /Редактировать/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Действия:/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Написать', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`nutrition-trainer-${theme}.png`), fullPage: true })
  state.granted = false
  await page.reload()
  await expect(page.locator('.nutrition-entry')).toHaveCount(0)
  await expect(page.getByText('Клиент пока не разрешил просмотр дневника.', { exact: false })).toBeVisible()
})

test('nutrition trainer summary keeps count, update time and explicit latest-day context', async ({ page }) => {
  const state = await fixture(page, { role: 'trainer' })
  state.granted = true
  const entry: NutritionEntry = { ...food, id: 'f00d0000-6010-4000-8000-000000000013', day: '2026-10-10', meal: 'lunch', grams: 150,
    totals: scaledNutrition(food, '100g', 150), version: 1, updatedAt: '2026-10-10T09:00:00Z', deletedAt: null }
  state.entries.push(entry)
  await page.goto(`/clients/${clientId}`)
  const summary = page.getByRole('region', { name: 'Питание сегодня' })
  await expect(summary).toContainText('Записей: 1')
  await expect(summary).toContainText('Обновлено в 12:00')
  entry.day = '2026-10-09'
  await page.reload()
  await expect(summary).toContainText('Сегодня записей нет')
  await expect(summary).not.toContainText('228,3 ккал')
  await summary.getByRole('link', { name: /Последние записи: 9 октября/ }).click()
  await expect(page).toHaveURL(/date=2026-10-09/)
  await expect(page.locator('.nutrition-entry')).toContainText('228,3 ккал')
})

test('nutrition direct route is unavailable outside the independent cohort', async ({ page }) => {
  await fixture(page, { outside: true })
  let requests = 0
  await page.route('**/v1/**/nutrition**', async (route) => { requests++; await route.fallback() })
  await page.goto('/me/nutrition?date=2026-10-10&action=add')
  await expect(page).toHaveURL(/\/me$/)
  expect(requests).toBe(0)
  await expect(page.getByRole('link', { name: 'Добавить еду' })).toHaveCount(0)
})
