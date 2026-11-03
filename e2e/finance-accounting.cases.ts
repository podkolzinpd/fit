import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TrainerFinanceClientBundle, TrainerFinanceManualSessionDraft } from '../src/data/contracts/trainer-finance'
import { clientId, conversationId, newWorkoutId, workoutId, mockPilot } from './fit-lime-fixtures'

const coach = 'c0ac0000-6010-4000-8000-000000000001'
const stamp = '2026-10-01T10:00:00Z'
async function accountingFixture(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'))
  await mockPilot(page, { profileId: coach, fitLime: true })
  const old = { id: conversationId, clientId, trainerId: coach, kind: 'session_pack' as const,
    title: 'Октябрь — персональные тренировки с длинным названием', sessionsTotal: 2, sessionsUsed: 2,
    sessionsRemaining: 0, priceCents: 1000000, paidCents: 1000000, dueCents: 0,
    startsOn: '2026-10-01', endsOn: '2026-10-31', paymentDueOn: null, comment: null,
    packageStatus: 'completed' as const, paymentStatus: 'paid' as const, closedAt: null, version: 1, createdAt: stamp, updatedAt: stamp }
  const ledger: TrainerFinanceClientBundle = { clientId, packages: [old,
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
