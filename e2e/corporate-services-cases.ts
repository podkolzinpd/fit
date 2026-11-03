import { expect, test, type Page } from '@playwright/test'
import { mockPilot, trainerId } from './fit-lime-fixtures'
import { formatLocalDate, localDate } from '../src/shared/local-date'
import { nativeAiUrl } from './native-ai-fixture'
import type { CorporateService, CorporateServiceKind, ServiceDraft } from '../src/data/repositories/corporate-services.repository'

const root = '/profile/yandex-services'
const officeId = '20000000-0000-4000-8000-000000000001'
const office2 = '20000000-0000-4000-8000-000000000002'
let unexpectedServiceApi: string[] = []
const names = { tour: 'Экскурсия', consultation: 'Консультация', instruction: 'Инструктаж', intro: 'Вводная тренировка' }
async function setup(page: Page, options: { allowed?: boolean; multipleOffices?: boolean; lostResponse?: boolean; denySave?: boolean; seedCount?: number; admin?: boolean; legacy?: boolean } = {}) {
  const origin = new URL(nativeAiUrl('/')).origin
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) return route.fallback()
    unexpectedServiceApi.push(`${request.method()} ${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  await mockPilot(page, { role: 'trainer', fitLime: !options.legacy, pilot: !options.legacy, workouts: [] })
  let allowed = options.allowed !== false, lose = options.lostResponse ?? false
  const offices = [{ id: officeId, city: 'Москва', name: 'Тестовый офис' }, ...(options.multipleOffices ? [{ id: office2, city: 'Санкт-Петербург', name: 'Второй офис' }] : [])]
  const now = new Date(Date.now() - 60000).toISOString()
  const records: CorporateService[] = Array.from({ length: options.seedCount ?? 0 }, (_, index) => ({ id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, kind: 'consultation', officeId, city: 'Москва', officeName: 'Тестовый офис', occurredAt: now, createdAt: now, updatedAt: now, version: 1, voidedAt: null }))
  const commands = new Map<string, { saved: true; id: string; version: number }>(), writes: ServiceDraft[] = []
  const audit = new Map<string, Array<{ action: 'create' | 'update' | 'void'; at: string; version: number; before: CorporateService | null; after: CorporateService }>>()
  let dataRequests = 0, lastRange: URLSearchParams | undefined
  await page.routeWebSocket('**/*', socket => socket.close())
  await page.route('**/v1/admin/access', route => route.fulfill({ json: { allowed: options.admin === true } }))
  await page.route('**/v1/admin/bundle', route => route.fulfill({ json: { offices: [], trainers: [] } }))
  await page.route(/\/v1\/(?:admin\/)?corporate-services(?:\/|\?|$)/, async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^.*\/v1/, '/v1')
    if (path === '/v1/corporate-services/access') return route.fulfill({ json: { allowed } })
    dataRequests++
    if (!allowed && !options.admin) return route.fulfill({ status: 403, json: { error: 'corporate_forbidden' } })
    const selected = () => records.filter(row => Date.parse(row.occurredAt) >= Date.parse(`${url.searchParams.get('from')}T00:00:00+03:00`) && Date.parse(row.occurredAt) < Date.parse(`${url.searchParams.get('until')}T00:00:00+03:00`))
    if (path === '/v1/admin/corporate-services') {
      lastRange = url.searchParams
      const counts = { tour: 0, consultation: 0, instruction: 0, intro: 0 }
      for (const row of selected()) if (!row.voidedAt && (!url.searchParams.get('officeId') || row.officeId === url.searchParams.get('officeId'))) counts[row.kind]++
      return route.fulfill({ json: { counts, timeZone: 'Europe/Moscow', offices: offices.map(office => ({ ...office, archived: false })), trainers: [{ id: trainerId, name: 'Тестовый тренер', active: true }] } })
    }
    if (path === '/v1/corporate-services' && route.request().method() === 'GET') {
      lastRange = url.searchParams
      const start = url.searchParams.has('cursorId') ? 50 : 0, rows = selected().slice(start, start + 50)
      return route.fulfill({ json: { records: rows, offices, timeZone: 'Europe/Moscow', nextCursor: selected().length > start + 50 ? { at: rows[49]!.occurredAt, id: rows[49]!.id } : null } })
    }
    const id = path.split('/')[3]
    if (path.endsWith('/audit')) return route.fulfill({ json: { events: [...(audit.get(id!) ?? [])].reverse(), nextBeforeVersion: null } })
    if (route.request().method() === 'GET') {
      const row = records.find(value => value.id === id)
      return route.fulfill({ status: row ? 200 : 404, json: row ?? { error: 'corporate_not_found' } })
    }
    if (options.denySave) { allowed = false; return route.fulfill({ status: 403, json: { error: 'corporate_forbidden' } }) }
    const draft = route.request().postDataJSON() as ServiceDraft
    if (commands.has(draft.commandId)) return route.fulfill({ json: commands.get(draft.commandId) })
    const serviceId = path.endsWith('/void') ? id! : draft.id
    const before = records.find(row => row.id === serviceId)
    if ((before?.version ?? 0) !== draft.version) return route.fulfill({ status: 409, json: { error: 'corporate_conflict' } })
    const office = offices.find(office => office.id === draft.officeId)
    const at = new Date().toISOString()
    const after: CorporateService = path.endsWith('/void') ? { ...before!, voidedAt: at, updatedAt: at, version: draft.version + 1 } : { id: serviceId, kind: draft.kind, officeId: draft.officeId, city: office!.city, officeName: office!.name, occurredAt: draft.occurredAt, version: draft.version + 1, voidedAt: null, createdAt: before?.createdAt ?? at, updatedAt: at }
    if (before) records.splice(records.indexOf(before), 1, after); else records.push(after)
    const action = path.endsWith('/void') ? 'void' : before ? 'update' : 'create'
    audit.set(serviceId, [...(audit.get(serviceId) ?? []), { action, at, version: after.version, before: before ?? null, after }])
    const receipt = { saved: true as const, id: serviceId, version: after.version }; commands.set(draft.commandId, receipt); writes.push(draft)
    if (lose) { lose = false; return route.abort('connectionreset') }
    return route.fulfill({ json: receipt })
  })
  return { records, writes, get dataRequests() { return dataRequests }, get lastRange() { return lastRange }, revoke() { allowed = false } }
}
export function registerCorporateServiceCases() {
  test.beforeEach(() => { unexpectedServiceApi = [] })
  test.afterEach(() => { expect(unexpectedServiceApi, 'All application APIs must be mocked; real APIs are blocked').toEqual([]) })
  test('services create, correct, audit, void and admin totals without fake workouts', async ({ page }, info) => {
    const fixture = await setup(page, { admin: true })
    await page.goto(nativeAiUrl('/profile'))
    await page.getByRole('link', { name: 'Работа в Яндексе', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Работа в Яндексе', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('services-workspace.png'), fullPage: true })
    await page.getByRole('link', { name: 'Консультация', exact: true }).click()
    await expect(page.getByLabel('Офис', { exact: true })).toHaveValue(officeId)
    await page.getByRole('button', { name: 'Сохранить услугу', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Мои услуги', exact: true })).toBeVisible()
    expect(fixture.records).toHaveLength(1)
    await page.getByRole('link', { name: 'Исправить', exact: true }).click()
    await page.getByLabel('Услуга', { exact: true }).selectOption('tour')
    await page.getByRole('button', { name: 'Сохранить исправление', exact: true }).click()
    await expect(page.locator('.corporate-service-list')).toContainText('Экскурсия')
    expect(fixture.records).toHaveLength(1); expect(fixture.records[0]?.version).toBe(2)
    await page.goto(nativeAiUrl('/admin?tab=statistics'))
    await expect(page.getByRole('heading', { name: 'Статистика услуг' })).toBeVisible()
    await expect(page.locator('.corporate-service-counts > div').filter({ hasText: 'Экскурсии' }).locator('dd')).toHaveText('1')
    await page.goto(nativeAiUrl(`${root}/${fixture.records[0]!.id}`))
    await page.getByRole('button', { name: 'История изменений', exact: true }).click()
    await expect(page.locator('.corporate-service-audit li')).toHaveCount(2)
    await expect(page.locator('.corporate-service-audit')).toContainText('До изменения: Консультация')
    await page.getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await expect(page.locator('.corporate-service-list')).toContainText('Отменена')
    await page.goto(nativeAiUrl('/admin?tab=statistics'))
    await expect(page.locator('.corporate-service-counts dd')).toHaveText(['0', '0', '0', '0'])
    expect(fixture.records).toHaveLength(1)
    expect(fixture.writes.every(value => !('trainerId' in value) && !('accountRole' in value))).toBe(true)
  })
  test('services recover a void conflict explicitly before retrying the current version', async ({ page }) => {
    const fixture = await setup(page, { seedCount: 1 })
    const record = fixture.records[0]!
    await page.goto(nativeAiUrl(`${root}/${record.id}`))
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('consultation')
    fixture.records[0] = { ...record, version: 2, kind: 'intro' }
    await page.getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await expect(page.locator('.save-status-error')).toContainText('Запись уже изменилась')
    expect(fixture.writes).toHaveLength(0)
    await page.getByRole('button', { name: 'Загрузить сохранённую запись', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Загрузить запись', exact: true }).click()
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('intro')
    await page.getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await expect(page.locator('.corporate-service-list')).toContainText('Отменена')
    expect(fixture.records[0]?.version).toBe(3); expect(fixture.writes).toHaveLength(1)
  })
  test('services close a retained form when permission is revoked before explicit recovery', async ({ page }) => {
    const fixture = await setup(page, { seedCount: 1 })
    const record = fixture.records[0]!
    await page.goto(nativeAiUrl(`${root}/${record.id}`))
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('consultation')
    fixture.records[0] = { ...record, version: 2 }
    await page.getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отменить услугу', exact: true }).click()
    await expect(page.locator('.save-status-error')).toBeVisible()
    fixture.revoke()
    await page.getByRole('button', { name: 'Загрузить сохранённую запись', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Загрузить запись', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Нет доступа', exact: true })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Данные услуги', exact: true })).toHaveCount(0)
    expect(fixture.writes).toHaveLength(0); expect(fixture.records[0]!.voidedAt).toBeNull()
  })
  test('services retain the historical range and return position, and reveal an old direct save', async ({ page }) => {
    const fixture = await setup(page, { seedCount: 35 })
    for (const row of fixture.records) row.occurredAt = '2026-10-25T09:00:00Z'
    await page.goto(nativeAiUrl(`${root}?from=2026-10-01&until=2026-11-01`))
    const edit = page.getByRole('link', { name: 'Исправить', exact: true }).last()
    await edit.scrollIntoViewIfNeeded()
    const before = await page.locator('[data-viewport-route]').evaluate(node => node.scrollTop)
    expect(before).toBeGreaterThan(1000)
    await edit.click()
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('consultation')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(edit).toBeInViewport()
    const after = await page.locator('[data-viewport-route]').evaluate(node => node.scrollTop)
    expect(Math.abs(after - before)).toBeLessThan(8)
    await expect.poll(() => fixture.lastRange?.get('from')).toBe('2026-10-01')
    await edit.click()
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('consultation')
    await page.goBack()
    await expect(edit).toBeInViewport()
    await expect.poll(() => page.locator('[data-viewport-route]').evaluate(node => node.scrollTop)).toBeGreaterThan(1000)
    await page.goto(nativeAiUrl(`${root}/${fixture.records[0]!.id}`))
    await page.getByLabel('Услуга', { exact: true }).selectOption('instruction')
    await page.getByRole('button', { name: 'Сохранить исправление', exact: true }).click()
    await expect(page.locator('.corporate-service-list')).toContainText('Инструктаж')
    expect(fixture.lastRange?.get('from')).toBe('2026-10-25')
    expect(fixture.lastRange?.get('until')).toBe('2026-10-26')
    expect(fixture.records).toHaveLength(35)
  })
  test('services confirm leaving a pending save and ignore its late navigation', async ({ page }) => {
    const fixture = await setup(page)
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    await page.route(/\/v1\/corporate-services$/, async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      await delayed
      return route.fallback()
    })
    await page.goto(nativeAiUrl(`${root}/new?kind=tour`))
    await page.getByRole('button', { name: 'Сохранить услугу', exact: true }).click()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Остаться', exact: true }).click()
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('tour')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Уйти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Мои услуги', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    const ack = page.waitForResponse(response => /\/v1\/corporate-services$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST')
    release(); await ack
    await expect.poll(() => fixture.records.length).toBe(1)
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/profile')
    expect(fixture.writes).toHaveLength(1)
  })
  test('services preserve input and one operation under a committed but lost response', async ({ page }) => {
    const fixture = await setup(page, { lostResponse: true, multipleOffices: true })
    await page.goto(nativeAiUrl(`${root}/new?kind=instruction`))
    await page.getByRole('button', { name: 'Сохранить услугу' }).click()
    await expect(page.getByText('Выберите офис', { exact: true }).last()).toBeVisible()
    expect(fixture.records).toHaveLength(0)
    await page.getByLabel('Офис', { exact: true }).selectOption(office2)
    await page.getByRole('button', { name: 'Сохранить услугу' }).click()
    await expect(page.locator('.save-status-error')).toBeVisible()
    await expect(page.getByLabel('Офис', { exact: true })).toHaveValue(office2)
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('instruction')
    await page.getByRole('button', { name: 'Сохранить услугу' }).click()
    await expect(page.getByRole('heading', { name: 'Мои услуги' })).toBeVisible()
    expect(fixture.records).toHaveLength(1); expect(fixture.writes).toHaveLength(1)
  })
  for (const outsider of ['обычный тренер', 'тренер Яндекса без тестового допуска']) test(`services deny ${outsider} before loading any data`, async ({ page }) => {
    const fixture = await setup(page, { allowed: false })
    await page.goto(nativeAiUrl('/profile'))
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Работа в Яндексе' })).toHaveCount(0)
    await page.goto(nativeAiUrl(root))
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    await page.goto(nativeAiUrl(`${root}/new?kind=tour`))
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    expect(fixture.dataRequests).toBe(0)
  })
  test('services recover an actual conflicting version only after explicit confirmation', async ({ page }) => {
    const fixture = await setup(page, { seedCount: 1 })
    const id = fixture.records[0]!.id
    await page.goto(nativeAiUrl(`${root}/${id}`))
    await page.getByLabel('Услуга', { exact: true }).selectOption('tour')
    fixture.records[0] = { ...fixture.records[0]!, version: 2, kind: 'intro' }
    await page.getByRole('button', { name: 'Сохранить исправление' }).click()
    await expect(page.locator('.save-status-error')).toContainText('Запись уже изменилась')
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('tour')
    await page.getByRole('button', { name: 'Загрузить сохранённую запись' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Загрузить запись', exact: true }).click()
    await expect(page.getByLabel('Услуга', { exact: true })).toHaveValue('intro')
    await page.getByLabel('Услуга', { exact: true }).selectOption('instruction')
    await page.getByRole('button', { name: 'Сохранить исправление' }).click()
    await expect(page.getByRole('heading', { name: 'Мои услуги' })).toBeVisible()
    expect(fixture.records).toHaveLength(1); expect(fixture.records[0]?.version).toBe(3)
  })
  test('services close on server-side revocation without creating a record', async ({ page }) => {
    const fixture = await setup(page, { denySave: true })
    await page.goto(nativeAiUrl(`${root}/new?kind=tour`))
    await page.getByRole('button', { name: 'Сохранить услугу' }).click()
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    expect(fixture.records).toHaveLength(0)
  })
  for (const allowed of [true, false]) test(`profile retries an access failure without disclosing or enabling unconfirmed services: ${allowed}`, async ({ page }) => {
    const fixture = await setup(page, { allowed })
    let reads = 0
    await page.route('**/v1/corporate-services/access', route => ++reads === 1 ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fulfill({ json: { allowed } }))
    await page.goto(nativeAiUrl('/profile'))
    await expect(page.getByText('Не удалось обновить доступные разделы.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Работа в Яндексе', exact: true })).toHaveCount(0)
    expect(fixture.dataRequests).toBe(0)
    expect((await page.getByRole('button', { name: 'Повторить проверку', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.getByRole('button', { name: 'Повторить проверку', exact: true }).click()
    await expect(page.getByText('Не удалось обновить доступные разделы.', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Работа в Яндексе', exact: true })).toHaveCount(allowed ? 1 : 0)
    expect(reads).toBe(2); expect(fixture.dataRequests).toBe(0)
  })
  test('statistics distinguish a draft period from the applied totals and keep quick selection explicit', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T10:00:00Z'))
    const fixture = await setup(page, { admin: true, seedCount: 1, legacy: true })
    fixture.records[0]!.occurredAt = '2026-11-04T09:00:00Z'
    await page.goto(nativeAiUrl('/admin?tab=statistics'))
    const count = page.locator('.corporate-service-counts > div').filter({ hasText: 'Консультации' }).locator('dd')
    await expect(count).toHaveText('1')
    await expect(page.getByRole('button', { name: 'Месяц', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Учтённый период')).toContainText('04.11.2026')
    await expect(page.getByLabel('Тренер', { exact: true })).not.toBeVisible()
    await page.getByText('Период и фильтры', { exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Тренер', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Конец периода', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: formatLocalDate(localDate('2026-11-02')), exact: true }).click()
    await page.getByRole('button', { name: 'Применить дату', exact: true }).click()
    await expect(page.getByText(/Период изменён/)).toBeVisible()
    await expect(count).toHaveText('1')
    await expect(page.getByLabel('Учтённый период')).toContainText('04.11.2026')
    expect(fixture.lastRange?.get('until')).toBe('2026-11-05')
    await page.getByRole('button', { name: 'Применить период', exact: true }).click()
    await expect(count).toHaveText('0')
    await expect(page.getByLabel('Учтённый период')).toContainText('02.11.2026')
    await expect(page.getByText(/Период изменён/)).toHaveCount(0)
    expect(fixture.lastRange?.get('until')).toBe('2026-11-03')
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Сегодня', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(count).toHaveText('1')
  })
  test('services paginate own records and keep explicit period/admin filters', async ({ page }) => {
    const fixture = await setup(page, { seedCount: 51, admin: true })
    await page.goto(nativeAiUrl(root))
    await expect(page.locator('.corporate-service-list li')).toHaveCount(50)
    await page.getByRole('button', { name: 'Показать ещё' }).click()
    await expect(page.locator('.corporate-service-list li')).toHaveCount(51)
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
    await expect(page.locator('.corporate-service-list li')).toHaveCount(50)
    expect(fixture.lastRange?.get('from')).not.toBeNull()
    await page.goto(nativeAiUrl('/admin?tab=statistics'))
    await page.getByText('Период и фильтры', { exact: true }).click()
    await page.getByLabel('Тренер', { exact: true }).selectOption(trainerId)
    await page.getByLabel('Офис', { exact: true }).selectOption(officeId)
    await expect.poll(() => fixture.lastRange?.get('trainerId')).toBe(trainerId)
    await expect.poll(() => fixture.lastRange?.get('officeId')).toBe(officeId)
    await expect(page.locator('.corporate-service-counts > div').filter({ hasText: 'Консультации' }).locator('dd')).toHaveText('51')
  })
  for (const theme of ['dark', 'light']) test(`services ${theme} geometry, date choice and every action at 320/390/430/1440`, async ({ page }, info) => {
    await setup(page, { admin: true, multipleOffices: true, legacy: true })
    await page.addInitScript(value => localStorage.setItem('fit.appTheme', value), theme)
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width > 700 ? 1000 : 736 })
      await page.goto(nativeAiUrl(root))
      await expect(page.getByRole('heading', { name: 'Мои услуги' })).toBeVisible()
      for (const kind of ['tour', 'consultation', 'instruction', 'intro'] as CorporateServiceKind[]) {
        const link = page.getByRole('link', { name: names[kind], exact: true })
        const box = await link.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('link', { name: 'Вводная тренировка', exact: true }).click()
      const dateButton = page.getByRole('button', { name: 'Выбрать дату и время' })
      expect((await dateButton.locator('svg').boundingBox())!.width).toBeLessThanOrEqual(24)
      expect((await dateButton.boundingBox())!.height).toBeLessThanOrEqual(96)
      await dateButton.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Применить дату', exact: true }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible()
      await page.getByLabel('Офис', { exact: true }).selectOption(officeId)
      for (const control of await page.getByRole('combobox').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.getByRole('button', { name: 'Сохранить услугу' }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: 'Сохранить услугу' })).toBeInViewport()
      expect(await page.getByRole('button', { name: 'Сохранить услугу' }).evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`services-form-${theme}-${width}.png`), fullPage: true })
      await page.goto(nativeAiUrl('/admin?tab=statistics'))
      await expect(page.getByRole('heading', { name: 'Статистика услуг' })).toBeVisible()
      await expect(page.locator('.corporate-service-counts dd').first()).toBeInViewport()
      expect((await page.locator('.corporate-service-filters summary').boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`services-statistics-${theme}-${width}.png`), fullPage: true })
    }
  })
  test('services retain the existing trainer Lime palette and reachable controls', async ({ page }, info) => {
    await setup(page)
    await page.setViewportSize({ width: 390, height: 736 })
    await page.goto(nativeAiUrl(`${root}/new?kind=tour`))
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    const date = page.getByRole('button', { name: 'Выбрать дату и время' })
    expect((await date.locator('svg').boundingBox())!.width).toBeLessThanOrEqual(24)
    const save = page.getByRole('button', { name: 'Сохранить услугу' })
    await save.scrollIntoViewIfNeeded()
    expect(await save.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
    await page.screenshot({ path: info.outputPath('services-lime-390.png'), fullPage: true })
    await save.click()
    await expect(page.getByRole('heading', { name: 'Мои услуги' })).toBeVisible()
  })

}
