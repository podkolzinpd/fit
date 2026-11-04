import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TrainerFinanceClientBundle, TrainerFinanceManualSessionDraft } from '../src/data/contracts/trainer-finance'
import { clientId, conversationId, newWorkoutId, workoutId, mockPilot } from './fit-lime-fixtures'

const coach = 'c0ac0000-6010-4000-8000-000000000001'
const stamp = '2026-10-01T10:00:00Z'
async function accountingFixture(page: Page, fitLime = true) {
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'))
  await mockPilot(page, { profileId: coach, fitLime })
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
    const { form, commands, open } = await uncertainCreateFixture(page, kind)
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
    await open()
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
