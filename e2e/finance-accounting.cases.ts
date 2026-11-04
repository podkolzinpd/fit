import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TrainerFinanceClientBundle, TrainerFinanceManualSessionDraft } from '../src/data/contracts/trainer-finance'
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

async function formGeometry(form: Locator) {
  expect(await form.locator('input,select,button').evaluateAll(nodes => nodes.every(node => {
    const r = node.getBoundingClientRect(), parent = node.closest('form')!.getBoundingClientRect()
    return r.width >= 44 && r.height >= 44 && r.left >= parent.left - 1 && r.right <= parent.right + 1
  }))).toBe(true)
  const actions = form.locator('.actions')
  expect(await actions.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(await form.evaluate(node => getComputedStyle(node).fontFamily)).toContain('YS Geo')
}

export function financeAccountingCases() {
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
