import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TrainerFinanceClientBundle, TrainerFinanceManualSessionDraft, TrainerFinancePaymentUpdate, TrainerFinanceReceipt } from '../src/data/contracts/trainer-finance'
import { clientId, conversationId, newWorkoutId, workoutId, workout, mockPilot, type MockWorkout } from './fit-lime-fixtures'

const coach = 'c0ac0000-6010-4000-8000-000000000001'
const stamp = '2026-10-01T10:00:00Z'
async function accountingFixture(page: Page, fitLime = true, workouts?: MockWorkout[]) {
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'))
  await mockPilot(page, { profileId: coach, fitLime, ...(workouts ? { workouts } : {}) })
  const old = { id: conversationId, clientId, trainerId: coach, kind: 'session_pack' as const,
    title: 'Октябрь — персональные тренировки с длинным названием', sessionsTotal: 2, sessionsUsed: 2,
    sessionsRemaining: 0, priceCents: 1000000, paidCents: 1000000, dueCents: 0,
    startsOn: '2026-10-01', endsOn: '2026-10-31', paymentDueOn: null, comment: null,
    packageStatus: 'completed' as const, paymentStatus: 'paid' as const, closedAt: null, version: 1, createdAt: stamp, updatedAt: stamp }
  const ledger: TrainerFinanceClientBundle = { clientId, clientName: 'Алексей Смирнов', packages: [old,
    { ...old, id: newWorkoutId, title: 'Ноябрь', sessionsTotal: 10, sessionsUsed: 0, sessionsRemaining: 10,
      startsOn: '2026-11-01', endsOn: '2026-11-30', packageStatus: 'active' }], payments: [],
    sessions: [{ id: workoutId, packageId: old.id, workoutId, disposition: 'charged', source: 'automatic',
      comment: null, workoutDate: '2026-10-15', voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp }] }
  await page.route(`**/v1/clients/${clientId}/finance`, route => route.fulfill({ json: { finance: ledger } }))
  return ledger
}

async function formGeometry(form: Locator, lime = true) {
  expect(await form.locator('input,select,button').evaluateAll(nodes => nodes.every(node => {
    const r = node.getBoundingClientRect(), parent = node.closest('form')!.getBoundingClientRect()
    return r.width >= 44 && r.height >= 44 && r.left >= parent.left - 1 && r.right <= parent.right + 1
  }))).toBe(true)
  const actions = form.locator('.actions')
  expect(await actions.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  if (lime) expect(await form.evaluate(node => getComputedStyle(node).fontFamily)).toContain('YS Geo')
}

async function receiptFixture(page: Page, fitLime = true, extraReceipts = 0) {
  const ledger = await accountingFixture(page, fitLime)
  const name = 'Александра Константинопольская — персональные тренировки'
  ledger.clientName = name
  const service = ledger.packages[1]!
  Object.assign(service, { paidCents: 600000, dueCents: 400000, paymentStatus: 'partial' })
  const receipts: TrainerFinanceReceipt[] = [
    { id: clientId, packageId: service.id, clientId, clientName: name, archivedAt: null,
      serviceTitle: service.title, amountCents: 600000, receivedOn: '2026-11-03', source: 'manual' as const,
      comment: 'Оплата персональных тренировок', voidedAt: null as string | null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp },
    { id: conversationId, packageId: conversationId, clientId: conversationId, clientName: 'Дарья Иванова', archivedAt: stamp,
      serviceTitle: 'Персональные тренировки', amountCents: 400000, receivedOn: '2026-11-02', source: 'opening' as const,
      comment: null, voidedAt: null as string | null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp },
  ]
  for (let index = 1; index <= extraReceipts; index++) receipts.push({ ...receipts[0]!,
    id: `10000000-0000-4000-9000-${String(index).padStart(12, '0')}`, amountCents: 10000,
    receivedOn: '2026-11-01', comment: null })
  service.paidCents += extraReceipts * 10000
  service.dueCents = Math.max(0, service.priceCents - service.paidCents)
  ledger.payments = receipts.filter(item => item.clientId === clientId)
  const monthTotal = () => receipts.filter(item => !item.voidedAt && item.receivedOn.startsWith('2026-11')).reduce((sum,item) => sum+item.amountCents,0)
  await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: { month: '2026-11',
    receivedCents: monthTotal(), dueCents: service.dueCents, attentionCount: 0, clients: [] } } }))
  await page.route(/\/v1\/finance\/payments\?/, route => {
    const params = new URL(route.request().url()).searchParams
    const month = params.get('month')!, selected = params.get('clientId'), offset = Number(params.get('offset'))
    const payments = receipts.filter(item => !item.voidedAt && item.receivedOn.startsWith(month) && (!selected || item.clientId === selected))
    return route.fulfill({ json: { history: { month, clientId: selected, offset: Number(params.get('offset')), limit: 50,
      totalCount: payments.length, totalCents: payments.reduce((sum,item) => sum+item.amountCents,0),
      clients: [...new Map(receipts.filter(item => !item.voidedAt).map(item => [item.clientId, { id: item.clientId, name: item.clientName }])).values()], payments: payments.slice(offset, offset + 50) } } })
  })
  return { name, service, receipts }
}

async function uncertainCreateFixture(page: Page, kind: 'payment' | 'package', fitLime = true) {
  const ledger = await accountingFixture(page, fitLime)
  // Keep a real balance so the service CTA remains available after FIN304.
  Object.assign(ledger.packages[1]!, { paidCents: 0, dueCents: 1000000, paymentStatus: 'unpaid' })
  const commands: Record<string, unknown>[] = []
  const endpoint = kind === 'payment' ? `**/v1/finance/packages/${newWorkoutId}/payments` : `**/v1/clients/${clientId}/finance/packages`
  await page.route(endpoint, route => {
    const draft = route.request().postDataJSON() as Record<string, unknown>
    commands.push(draft)
    if (commands.length === 1) return route.fulfill({ status: 503, json: {} })
    return route.fulfill({ json: kind === 'payment' ? { payment: { id: clientId, packageId: newWorkoutId, ...draft,
      source: 'manual', voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp } }
      : { package: { ...ledger.packages[1]!, id: clientId, ...draft } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/clients/${clientId}/finance`)
  const open = async () => page.getByRole('button', { name: kind === 'payment' ? 'Внести оплату' : 'Новая', exact: true }).click()
  await open()
  const form = page.locator('.finance-form')
  if (kind === 'package') {
    await form.getByLabel('Стоимость, ₽').fill('10000')
    await form.getByLabel('Уже оплачено, ₽').fill('2500')
    await form.getByLabel('Дата получения').fill('2026-10-20')
  } else {
    await form.getByLabel('Сумма, ₽').fill('2500')
    await form.getByLabel('Дата', { exact: true }).fill('2026-10-20')
  }
  await form.getByLabel('Комментарий').fill('Оплата переводом — сохранить исходную запись')
  await form.getByLabel('Комментарий').focus()
  await page.setViewportSize({ width: 390, height: 400 })
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click()
  // Disabled fields dismiss the real keyboard; restore its unobscured viewport.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(form.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled()
  await expect(form.getByText('Сохранение не подтверждено')).toBeVisible()
  await expect(form.getByLabel('Комментарий')).toBeDisabled()
  return { form, commands, open }
}

export function financeAccountingCases() {
  // Payment and service have separate endpoints and native date/amount layouts.
  for (const kind of ['payment', 'package'] as const) test(`Finance uncertain ${kind} creation restores the same operation`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const { form, commands } = await uncertainCreateFixture(page, kind)
    await page.reload()
    await page.getByRole('button', { name: 'Проверить сохранение', exact: true }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Оплата переводом — сохранить исходную запись')
    await expect(form.getByLabel('Комментарий')).toBeDisabled()
    if (kind === 'package') await form.locator('summary').click()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      await page.locator('.content').evaluate(node => { node.scrollTop = 0 })
      await page.screenshot({ path: info.outputPath(`${kind}-uncertain-top-${width}.png`), fullPage: true })
      await form.getByRole('button', { name: 'Повторить сохранение' }).scrollIntoViewIfNeeded()
      await expect(form.getByLabel('Комментарий')).toHaveCSS('opacity', '1')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${kind}-uncertain-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await form.getByRole('button', { name: 'Отмена' }).click()
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${kind}-pending-return.png`), fullPage: true })
    await page.getByRole('button', { name: 'Проверить сохранение', exact: true }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Оплата переводом — сохранить исходную запись')
    await expect(form.getByLabel(kind === 'payment' ? 'Дата' : 'Дата получения', { exact: true })).toHaveValue('2026-10-20')
    await form.getByRole('button', { name: 'Повторить сохранение' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${kind}-retry-restored.png`), fullPage: true })
    await form.getByRole('button', { name: 'Повторить сохранение' }).click()
    await expect(form).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
  })
  // Short visual-only Mono states cover the different light/dark text tokens;
  // business replay is exercised above, without multiplying the full chain.
  for (const theme of ['light', 'dark']) test(`Finance uncertain create forms retain Mono ${theme} readability`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('fit.appTheme', theme), theme)
    await page.setViewportSize({ width: 320, height: 640 })
    for (const kind of ['payment', 'package'] as const) {
      const { form } = await uncertainCreateFixture(page, kind, false)
      expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await expect(form.getByLabel(kind === 'payment' ? 'Дата' : 'Дата получения', { exact: true })).toHaveCSS('opacity', '1')
      await page.screenshot({ path: info.outputPath(`mono-${theme}-${kind}-uncertain.png`), fullPage: true })
    }
  })


  test('Finance receipts filter, correct and delete across clients with retained context', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const { name, service, receipts } = await receiptFixture(page)
    await page.route(`**/v1/finance/payments/${clientId}`, route => {
      const draft = route.request().postDataJSON() as TrainerFinancePaymentUpdate
      expect(draft).toMatchObject({ amountCents: 500000, receivedOn: '2026-11-03', expectedVersion: 1 })
      Object.assign(receipts[0]!, draft, { version: 2 })
      Object.assign(service, { paidCents: 500000, dueCents: 500000 })
      return route.fulfill({ json: { payment: receipts[0] } })
    })
    await page.route(`**/v1/finance/payments/${conversationId}`, route => {
      expect(route.request().method()).toBe('DELETE')
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 1 })
      receipts[1]!.voidedAt = stamp
      return route.fulfill({ status: 204 })
    })
    await page.goto('/finance?month=2026-11')
    await expect(page.locator('.finance-overview-summary')).toContainText(/10\s000/)
    await page.getByRole('group', { name: 'Раздел финансов' }).getByRole('button', { name: 'Оплаты', exact: true }).click()
    const history = page.getByRole('region', { name: 'История оплат' })
    await expect(history.locator('.finance-payment')).toHaveCount(2)
    await expect(history.locator('.finance-receipts-total')).toContainText(/10\s000/)
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const select = await page.getByLabel('Клиент оплат').boundingBox()
      expect(select!.height).toBeGreaterThanOrEqual(44)
      expect(await page.getByLabel('Клиент оплат').evaluate(node => getComputedStyle(node).fontSize)).toBe('16px')
      await page.screenshot({ path: info.outputPath(`receipts-all-${width}.png`), fullPage: true })
    }
    await page.getByLabel('Клиент оплат').selectOption(clientId)
    await expect(history.locator('.finance-payment')).toHaveCount(1)
    const returnUrl = page.url()
    await history.getByRole('link', { name }).click()
    await expect(page.locator('.page-title-group')).toContainText(name)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(returnUrl)
    await expect(page.getByLabel('Клиент оплат')).toHaveValue(clientId)
    await history.getByRole('button', { name: /Действия с оплатой/ }).click()
    await page.getByRole('menuitem', { name: 'Изменить' }).click()
    await page.getByLabel('Сумма, ₽').fill('5000')
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.locator('.finance-form').scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`receipt-edit-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.locator('.finance-form')).toHaveCount(0)
    await expect(history.locator('.finance-receipts-total')).toContainText(/5\s000/)
    await page.getByLabel('Клиент оплат').selectOption('')
    await expect(history.locator('.finance-receipts-total')).toContainText(/9\s000/)
    await history.getByRole('button', { name: /Действия с оплатой Дарья/ }).click()
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    await page.setViewportSize({ width: 320, height: 844 })
    await page.screenshot({ path: info.outputPath('receipt-delete-confirm.png'), fullPage: true })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(history.locator('.finance-payment')).toHaveCount(1)
    await expect(history.locator('.finance-receipts-total')).toContainText(/5\s000/)
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await expect(page.getByText('Оплат за этот месяц нет.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('receipts-empty-month.png'), fullPage: true })
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByRole('group', { name: 'Раздел финансов' }).getByRole('button', { name: 'Клиенты', exact: true }).click()
    await expect(page.locator('.finance-overview-summary')).toContainText(/5\s000/)
  })

  // Theme variants seed the same ledger; only rendering, native controls and
  // keyboard/scroll geometry repeat. The correction/delete chain above runs once.
  for (const [fitLime, theme] of [[false, 'light'], [false, 'dark'], [true, 'light']] as const) {
    test(`Finance receipt layout ${fitLime ? 'Lime' : 'Mono'} ${theme}`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
      await page.addInitScript(value => localStorage.setItem('fit.appTheme', value), theme)
      await receiptFixture(page, fitLime, 50)
      await page.goto('/finance?month=2026-11&view=payments')
      const history = page.getByRole('region', { name: 'История оплат' })
      await expect(history.locator('.finance-payment')).toHaveCount(50)
      for (const width of [320, 430, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect((await page.getByLabel('Клиент оплат').boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await page.screenshot({ path: info.outputPath(`receipt-ledger-${width}.png`), fullPage: true })
      }
      const pagination = page.getByLabel('Страницы оплат')
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        await pagination.scrollIntoViewIfNeeded()
        expect(await pagination.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
        for (const button of await pagination.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await expect(pagination).toBeInViewport()
        await pagination.screenshot({ path: info.outputPath(`receipt-pagination-controls-${width}.png`) })
        await page.screenshot({ path: info.outputPath(`receipt-pagination-${width}.png`) })
      }
      await pagination.getByRole('button', { name: 'Следующие', exact: true }).click()
      await expect(history.locator('.finance-payment')).toHaveCount(2)
      await expect(pagination).toContainText('51–52 из 52')
      await pagination.getByRole('button', { name: 'Предыдущие', exact: true }).click()
      await expect(history.locator('.finance-payment')).toHaveCount(50)
      await history.getByRole('button', { name: /Действия с оплатой Александра/ }).first().click()
      await page.getByRole('menuitem', { name: 'Изменить' }).click()
      const form = page.locator('.finance-form')
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        await form.scrollIntoViewIfNeeded()
        await formGeometry(form, fitLime)
        await page.screenshot({ path: info.outputPath(`receipt-editor-${width}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 320, height: 400 })
      await form.getByLabel('Комментарий').focus()
      await form.getByRole('button', { name: 'Сохранить', exact: true }).scrollIntoViewIfNeeded()
      await expect(form.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport()
    })
  }

  test('Finance receipt loading, failure and retry retain the selected period and client', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await accountingFixture(page)
    await page.addInitScript(() => document.addEventListener('click', event => {
      if ((event.target as Element).closest('button')?.textContent === 'Повторить') sessionStorage.setItem('receipt-explicit-retry', 'yes')
    }, true))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route(/\/v1\/finance\/payments\?/, async route => {
      await gate
      const retry = await page.evaluate(() => sessionStorage.getItem('receipt-explicit-retry') === 'yes')
      if (!retry) return route.fulfill({ status: 503, json: {} })
      const params = new URL(route.request().url()).searchParams
      expect(params.get('month')).toBe('2026-10')
      expect(params.get('clientId')).toBe(clientId)
      return route.fulfill({ json: { history: { month: '2026-10', clientId, offset: 0, limit: 50, totalCount: 0,
        totalCents: 0, clients: [{ id: clientId, name: 'Алексей Смирнов' }], payments: [] } } })
    })
    await page.goto(`/finance?view=payments&month=2026-10&client=${clientId}`)
    await expect(page.getByRole('status', { name: 'Загрузка' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('receipts-loading.png'), fullPage: true })
    release()
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.screenshot({ path: info.outputPath(`receipts-error-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.getByText('Оплат за этот месяц нет.')).toBeVisible()
    await expect(page.getByLabel('Клиент оплат')).toHaveValue(clientId)
    await expect(page.getByText('Октябрь 2026')).toBeVisible()
  })

  test('Finance overview search and archive preserve return context without a duplicate clients entry', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const ledger = await accountingFixture(page)
    const active = { clientId, fullName: ledger.clientName!, archivedAt: null, activeClient: true,
      receivedCents: 1000000, dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0,
      activePackageCount: 2, upcomingPackageCount: 0, sessionsRemaining: 10, overdue: false,
      lowSessions: false, unassignedSessions: 0, needsAttention: false }
    const archived = { ...active, clientId: conversationId, fullName: 'Дарья Иванова',
      archivedAt: stamp, activeClient: false, receivedCents: 500000, dueCents: 200000,
      nearestPaymentDueOn: '2026-10-31', unpaidPackageCount: 1, overdue: true, needsAttention: true }
    await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: {
      month: '2026-11', receivedCents: 1500000, dueCents: 200000, attentionCount: 1,
      clients: [active, archived],
    } } }))
    await page.goto('/clients')
    await expect(page.locator('.clients-finance-entry')).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Поиск клиента' })).toBeVisible()
    await page.getByRole('button', { name: 'Понятно', exact: true }).click()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`clients-single-finance-entry-${width}.png`), fullPage: true })
    }
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Финансы' }).click()
    const rows = page.locator('.finance-overview-client')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Алексей')
    const search = page.getByRole('searchbox', { name: 'Поиск клиента' })
    await search.fill('никого')
    await expect(page.getByText('Ничего не найдено.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('finance-empty-search.png'), fullPage: true })
    await page.getByRole('button', { name: 'Очистить поиск' }).click()
    await page.getByRole('button', { name: 'Архив', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Дарья Иванова')
    await expect(rows).toContainText('В архиве')
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`finance-archive-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Все', exact: true }).click()
    await expect(rows).toContainText('Алексей')
    await search.fill('алексей')
    await expect(page).toHaveURL(/q=/)
    await expect(rows).toContainText('Алексей')
    const returnUrl = page.url()
    await rows.click()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(returnUrl)
    await expect(search).toHaveValue('алексей')
  })

  test('Finance overview failure and explicit retry remain readable', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await accountingFixture(page)
    await page.addInitScript(() => document.addEventListener('click', event => {
      if ((event.target as Element).closest('button')?.textContent === 'Повторить') sessionStorage.setItem('finance-explicit-retry', 'yes')
    }, true))
    await page.route('**/v1/finance/overview*', async route => {
      const retry = await page.evaluate(() => sessionStorage.getItem('finance-explicit-retry') === 'yes')
      if (!retry) return route.fulfill({ status: 503, json: {} })
      return route.fulfill({ json: { overview: { month: '2026-11', receivedCents: 0, dueCents: 0, attentionCount: 0, clients: [] } } })
    })
    await page.goto('/finance')
    const retry = page.getByRole('button', { name: 'Повторить', exact: true })
    await expect(retry).toBeVisible()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.screenshot({ path: info.outputPath(`finance-read-error-${width}.png`), fullPage: true })
    }
    await retry.click()
    await expect(page.getByText('В этом разделе клиентов нет.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('finance-empty-ledger.png'), fullPage: true })
  })

  test('Finance workout deletion clears fresh attendance and overview caches', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const attendance = { ...workout, trainerId: coach, createdBy: coach, status: 'done' as const,
      workoutDate: '2026-11-03', completedAt: '2026-11-03T09:00:00Z' }
    const ledger = await accountingFixture(page, true, [attendance])
    const service = ledger.packages[1]!
    Object.assign(service, { sessionsTotal: 3, sessionsUsed: 1, sessionsRemaining: 2,
      priceCents: 300000, paidCents: 300000, dueCents: 0 })
    ledger.packages = [service]
    ledger.payments.push({ id: clientId, packageId: service.id, amountCents: 300000, receivedOn: '2026-11-01',
      source: 'manual', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp })
    Object.assign(ledger.sessions[0]!, { packageId: service.id, workoutDate: '2026-11-03' })
    let financeReads = 0, overviewReads = 0, deletes = 0
    await page.route(`**/v1/clients/${clientId}/finance`, route => {
      financeReads++
      return route.fulfill({ json: { finance: ledger } })
    })
    await page.route('**/v1/finance/overview*', route => {
      overviewReads++
      return route.fulfill({ json: { overview: { month: '2026-11', receivedCents: 300000, dueCents: 0,
        attentionCount: service.sessionsRemaining === 2 ? 1 : 0,
        clients: [{ clientId, fullName: ledger.clientName, archivedAt: null, receivedCents: 300000,
          dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 1,
          upcomingPackageCount: 0, sessionsRemaining: service.sessionsRemaining, overdue: false,
          lowSessions: service.sessionsRemaining === 2, unassignedSessions: 0,
          needsAttention: service.sessionsRemaining === 2 }],
      } } })
    })
    await page.route(`**/v1/workouts/${workoutId}`, route => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: attendance.version })
      deletes++
      ledger.sessions[0]!.voidedAt = '2026-11-03T09:01:00Z'
      service.sessionsUsed = 0; service.sessionsRemaining = 3
      return route.fulfill({ json: { workout: { version: attendance.version + 1 } } })
    })
    await page.goto('/finance')
    const row = page.locator('.finance-overview-client')
    await expect(row).toContainText(/Осталось 2 /)
    await expect(page.locator('.finance-overview-summary').getByText('1', { exact: true })).toBeVisible()
    await row.click()
    await page.getByRole('tab', { name: /^Занятия:/ }).click()
    await expect(page.locator('.finance-session')).toHaveCount(1)
    const beforeDelete = financeReads
    await page.locator('.finance-session').getByRole('link').click()
    await expect(page.getByText('Проведена', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить дату и время тренировки', exact: true })).toContainText('3 ноября 2026')
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Удалить тренировку', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: info.outputPath('workout-delete-confirm.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/finance$`))
    // Date.now is fixed by accountingFixture: the 20s cache cannot expire on its own.
    await expect.poll(() => financeReads).toBeGreaterThan(beforeDelete)
    await expect(page.getByRole('tab', { name: 'Оплаты: 1', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Занятия: 0', exact: true }).click()
    await expect(page.locator('.finance-session')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('finance-after-workout-delete.png'), fullPage: true })
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/finance$/)
    await expect(row).toContainText(/Осталось 3 /)
    await expect(page.locator('.finance-overview-summary').getByText('0', { exact: true })).toBeVisible()
    expect(overviewReads).toBeGreaterThan(1)
    expect(deletes).toBe(1)
    await page.screenshot({ path: info.outputPath('overview-after-workout-delete.png'), fullPage: true })
  })

  test('Finance former-client history and refreshed overview keep debt visible with unassigned sessions', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    ledger.clientName = 'Александра Константинопольская — история занятий'
    ledger.canCreate = false
    const service = ledger.packages[0]!
    Object.assign(service, { priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, paymentStatus: 'overdue' })
    Object.assign(ledger.packages[1]!, { priceCents: 0, paidCents: 0 })
    ledger.payments.push({ id: conversationId, packageId: service.id, amountCents: 1000000,
      receivedOn: '2026-10-01', source: 'opening', comment: null, voidedAt: null, voidReason: null,
      version: 1, createdAt: stamp, updatedAt: stamp })
    Object.assign(ledger.sessions[0]!, { disposition: 'unassigned', packageId: null })
    await page.route('**/v1/clients?*', route => route.fulfill({ status: 403, json: {} }))
    await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: {
      month: '2026-11', receivedCents: service.paidCents - 1000000, dueCents: service.dueCents, attentionCount: 1,
      clients: [{ clientId, fullName: ledger.clientName, archivedAt: null, receivedCents: 0,
        dueCents: service.dueCents, nearestPaymentDueOn: '2026-10-31', unpaidPackageCount: 1,
        activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 10, overdue: true,
        lowSessions: false, unassignedSessions: 1, needsAttention: true }],
    } } }))
    await page.route(`**/v1/finance/packages/${service.id}/payments`, route => {
      expect(route.request().postDataJSON()).toMatchObject({ amountCents: 500000 })
      service.paidCents += 500000; service.dueCents -= 500000
      const payment = { id: clientId, packageId: service.id, amountCents: 500000, receivedOn: '2026-11-03',
        source: 'manual' as const, comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp }
      ledger.payments.push(payment)
      return route.fulfill({ json: { payment } })
    })
    await page.goto('/finance?filter=due')
    const row = page.locator('.finance-overview-client')
    await expect(row).toContainText(/Просрочено 15\s000/)
    await expect(row).toContainText('Не привязано: 1')
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`debt-and-unassigned-${width}.png`), fullPage: true })
    }
    await row.click()
    await expect(page.locator('.page-title-group')).toContainText(ledger.clientName)
    await page.locator('.finance-history > summary').click()
    const history = page.locator('.finance-history .finance-package')
    await expect(history).toContainText(service.title)
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await history.scrollIntoViewIfNeeded()
      await expect(history.getByRole('button', { name: 'Внести оплату', exact: true })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`former-client-history-${width}.png`), fullPage: true })
    }
    await history.getByRole('button', { name: 'Внести оплату', exact: true }).click()
    await page.getByLabel('Сумма, ₽').fill('5000')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.locator('.finance-form')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\?filter=due$/)
    await expect(row).toContainText(/Просрочено 10\s000/)
    await expect(row).toContainText('Не привязано: 1')
    await page.screenshot({ path: info.outputPath('overview-after-payment.png'), fullPage: true })
  })

  // One behavior chain per engine; responsive snapshots resize the same state
  // to check native date/select, long names and the retry CTA, without replays.
  test('Finance accounting dates and uncertain manual retry preserve one operation', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    const commands: TrainerFinanceManualSessionDraft[] = []
    await page.route(`**/v1/clients/${clientId}/finance/sessions`, async route => {
      const draft = route.request().postDataJSON() as TrainerFinanceManualSessionDraft
      commands.push(draft)
      if (commands.length === 1) return route.fulfill({ status: 503, json: {} })
      const session = { ...ledger.sessions[0]!, id: commands.length === 2 ? newWorkoutId : clientId, workoutId: commands.length === 2 ? newWorkoutId : clientId,
        packageId: draft.packageId, disposition: draft.disposition, workoutDate: draft.workoutDate,
        source: 'manual' as const, comment: draft.comment }
      ledger.sessions.push(session)
      return route.fulfill({ json: { session } })
    })
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('tab', { name: 'Занятия: 1' }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    const form = page.locator('.finance-manual-session')
    await form.getByLabel('Дата занятия').fill('2026-10-20')
    // A fully consumed October service is unavailable to a new session.
    await expect(form.getByRole('option', { name: /Списать:/ })).toHaveCount(0)
    await form.getByLabel('Учёт').selectOption('trial')
    await form.getByLabel('Комментарий').fill('Пробное занятие после перерыва')
    await form.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(form.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled()
    await expect(form.getByLabel('Дата занятия')).toBeDisabled()
    await expect(form.getByLabel('Дата занятия')).toHaveCSS('opacity', '1')
    await expect(form.getByRole('alert')).toBeVisible()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`manual-uncertain-${width}.png`), fullPage: true })
    }
    await form.getByRole('button', { name: 'Отмена' }).click()
    expect(commands).toHaveLength(1)
    await page.getByRole('button', { name: 'Проверить сохранение' }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Пробное занятие после перерыва')
    await form.getByRole('button', { name: 'Повторить сохранение' }).click()
    await expect(page.getByRole('tab', { name: 'Занятия: 2' })).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await form.getByLabel('Дата занятия').fill('2026-11-03')
    await expect(form.getByRole('option', { name: 'Списать: Ноябрь' })).toBeAttached()
    await form.getByLabel('Учёт').selectOption(`charged:${newWorkoutId}`)
    await form.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Занятия: 3' })).toBeVisible()
    expect(commands[2]!.requestId).not.toBe(commands[0]!.requestId)
  })

  test('Finance session date editor retains its current charge and updates eligible services', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('tab', { name: 'Занятия: 1' }).click()
    await page.getByRole('button', { name: /Действия с занятием/ }).click()
    await page.getByRole('menuitem', { name: 'Изменить учёт' }).click()
    const form = page.locator('.finance-session-editor')
    await expect(form.getByLabel('Учёт')).toHaveValue(`charged:${conversationId}`)
    await page.screenshot({ path: info.outputPath('current-charge.png'), fullPage: true })
    await form.getByLabel('Дата').fill('2026-11-03')
    await expect(form.getByLabel('Учёт')).toHaveValue('unassigned')
    await expect(form.getByRole('option', { name: /Списать: Октябрь/ })).toHaveCount(0)
    await form.getByLabel('Учёт').selectOption(`charged:${newWorkoutId}`)
    await page.route(`**/v1/finance/sessions/${workoutId}`, route => {
      expect(route.request().postDataJSON()).toMatchObject({ workoutDate: '2026-11-03', packageId: newWorkoutId, disposition: 'charged' })
      Object.assign(ledger.sessions[0]!, { workoutDate: '2026-11-03', packageId: newWorkoutId, version: 2 })
      return route.fulfill({ json: { session: ledger.sessions[0] } })
    })
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      await page.screenshot({ path: info.outputPath(`session-new-date-${width}.png`), fullPage: true })
    }
    await form.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(form).toHaveCount(0)
    await expect(page.locator('.finance-session-list')).toContainText('Ноябрь')
  })
}
