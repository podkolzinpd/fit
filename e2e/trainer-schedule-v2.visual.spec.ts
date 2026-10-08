import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildFitLimeCalendarPlan } from '../services/api/src/db/fit-lime-calendar-plan'
import type { WorkoutExercise, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../src/shared/domain'
import { computeClientStats } from '../src/data/repositories/workout-rules'
import { workoutHomeSummaries } from '../src/data/repositories/workout-home'
import { localDate } from '../src/shared/local-date'
import type { TrainerFinanceClientBundle, TrainerFinancePackageDraft, TrainerFinancePaymentDraft } from '../src/data/repositories/trainer-finance.repository'

const trainerId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const workoutId = '10000000-0000-4000-8000-000000000003'
const conversationId = '10000000-0000-4000-8000-000000000004'
const messageId = '10000000-0000-4000-8000-000000000005'
const newWorkoutId = '10000000-0000-4000-8000-000000000006'
const customExerciseId = '10000000-0000-4000-8000-000000000070'
const sessionToken = 's'.repeat(43)

for (const width of [375, 390, 430, 1440]) {
  test(`Figma workout Coach reference Live geometry and rest ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
    await page.clock.install({ time: new Date('2026-10-08T08:59:00Z') })
    await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000001', fitLime: true,
      workouts: [{ ...restTimerWorkout(), startedAt: '2026-10-08T08:00:00Z' }] })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.coach-workout-reference')).toBeVisible()
    await page.clock.pauseAt(new Date('2026-10-08T09:00:00Z'))
    await expect(page.locator('.coach-live-digits')).toHaveText('1:00:00')
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('700 96px Doto'))).toBe(true)
    await page.screenshot({ path: info.outputPath('coach-reference-active.png'), fullPage: true })
    const sizes = await page.locator('.live-set-input, .live-set-check').evaluateAll((fields) => fields.map((field) => ({
      height: field.getBoundingClientRect().height, font: getComputedStyle(field).fontSize,
    })))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.every((field) => field.height === 48)).toBe(true)
    expect(await page.locator('.coach-live-digits').evaluate((field) => getComputedStyle(field).fontFamily)).toContain('Doto')
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    await expect(page.locator('.coach-live-digits')).toHaveText('00:02')
    await page.clock.fastForward(4_000)
    await expect(page.locator('.coach-live-digits')).toHaveText('−00:02')
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
    await expect(page.locator('.coach-live-status')).toHaveText('Отдых')
    await expect(page.locator('.live-rest-trigger')).toHaveCSS('background-color', 'rgba(248, 176, 33, 0.2)')
    await expect(page.locator('.live-rest-trigger')).toHaveCSS('animation-name', 'none')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('coach-reference-live.png'), fullPage: true })
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).first().click()
    await expect(page.locator('.finish-confirm')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.locator('.coach-live-digits')).toBeVisible()
  })
}
for (const [role, profileId, expected] of [
  ['trainer', 'c0ac0000-6010-4000-8000-000000000002', true],
  ['trainer', trainerId, false],
  ['client', 'c0ac0000-6010-4000-8000-000000000001', false],
] as const) {
  test(`Figma workout Coach reference direct route boundary ${role} ${profileId}`, async ({ page }) => {
    await mockPilot(page, { role, profileId, fitLime: true, workouts: [restTimerWorkout()] })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.live-rest-trigger')).toBeVisible()
    await expect(page.locator('.coach-live-digits')).toHaveCount(expected ? 1 : 0)
    await expect(page.locator('.coach-workout-reference')).toHaveCount(expected ? 1 : 0)
  })
}

for (const width of [390, 430, 1440]) for (const [fitLime, theme] of [[false, 'light'], [false, 'dark'], [true, 'dark']] as const) {
  test(`Finance due date client cards ${width} lime=${fitLime} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
    const rows = [
      { id: clientId, fullName: 'Один абонемент', amount: 250000, date: '2026-10-08', count: 1 },
      { id: newWorkoutId, fullName: 'Александра Константинопольская-Оченьдлиннаяфамилия', amount: 123456789, date: '2026-10-09', count: 2 },
      { id: customExerciseId, fullName: 'Без срока', amount: 200000, date: null, count: 1 },
      { id: conversationId, fullName: 'Оплачено', amount: 0, date: null, count: 0 },
    ]
    await mockPilot(page, { fitLime, clientRecords: rows.map((row) => ({ id: row.id, fullName: row.fullName, archivedAt: null, version: 1 })) })
    await page.addInitScript((value) => localStorage.setItem('fit.appTheme', value), theme)
    let overviewReads = 0, clientFinanceReads = 0
    page.on('request', (request) => { if (/\/clients\/[^/]+\/finance$/.test(new URL(request.url()).pathname)) clientFinanceReads++ })
    await page.route('**/v1/finance/overview*', (route) => {
      overviewReads++
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ overview: {
        month: new URL(route.request().url()).searchParams.get('month'), receivedCents: 0, dueCents: 123906789, attentionCount: 0,
        clients: rows.map((row) => ({ clientId: row.id, fullName: row.fullName, archivedAt: null, receivedCents: 0,
          dueCents: row.amount, nearestPaymentDueOn: row.date, unpaidPackageCount: row.count,
          activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 5, overdue: false,
          lowSessions: false, unassignedSessions: 0, needsAttention: false })),
      } }) })
    })
    await page.goto('/clients')
    const single = page.locator(`[data-client-swipe-id="${clientId}"] .client-finance-state`)
    await expect(single).toContainText(/К оплате 2.*500.*₽/)
    const tip = page.getByRole('status').filter({ hasText: 'В архив одним свайпом' })
    if (await tip.isVisible()) await tip.getByRole('button', { name: 'Понятно' }).click()
    await expect(single).toContainText('· до 08.10')
    await expect(page.locator(`[data-client-swipe-id="${newWorkoutId}"] .client-finance-state`)).toContainText('Ближайший срок — 09.10')
    const textLayout = await page.locator('.client-finance-state').evaluateAll((items) => items.map((item) => ({ width: item.clientWidth, scroll: item.scrollWidth, size: getComputedStyle(item).fontSize })))
    expect(textLayout.every((item) => item.scroll <= item.width && item.size === '12px')).toBe(true)
    await expect(page.locator(`[data-client-swipe-id="${customExerciseId}"] .client-finance-state`)).not.toContainText(/до|срок/)
    await expect(page.locator(`[data-client-swipe-id="${conversationId}"] .client-finance-state`)).not.toContainText(/до|срок/)
    expect(overviewReads).toBe(1)
    expect(clientFinanceReads).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: info.outputPath('client-due-date.png'), fullPage: true })
    await page.goto('/finance')
    await expect(page.locator('.finance-overview-client').first()).toBeVisible()
    await expect(page.locator('.finance-overview-client').filter({ hasText: 'Один абонемент' })).toContainText('· до 08.10')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('overview-due-date.png'), fullPage: true })
  })
}

async function expectContainedButtonText(button: Locator) {
  const geometry = await button.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return { width: bounds.width, height: bounds.height, contained: Array.from(range.getClientRects()).every((rect) =>
      rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom) }
  })
  expect(geometry.width).toBeGreaterThanOrEqual(44)
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  expect(geometry.contained).toBe(true)
}

for (const width of [390, 430, 1440]) for (const fitLime of [false, true]) {
  test(`Button geometry template empty actions ${width} lime=${fitLime}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime })
    await page.goto('/schedule/templates')
    const copy = page.getByRole('link', { name: 'Из тренировки', exact: true })
    await expect(copy).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(copy.locator('svg')).toHaveCSS('width', '20px')
    await expect(copy.locator('svg')).toHaveCSS('height', '20px')
    await expectContainedButtonText(copy)
    const create = page.getByRole('link', { name: 'Создать с нуля', exact: true })
    expect((await copy.boundingBox())!.height).toBeLessThanOrEqual(52)
    expect((await copy.boundingBox())!.height).toBe((await create.boundingBox())!.height)
    const iconTrigger = page.getByRole('button', { name: 'Создать шаблон', exact: true })
    expect((await iconTrigger.boundingBox())!.width).toBe(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('template-empty-actions.png'), fullPage: true })
    await copy.click()
    await expect(page).toHaveURL(/\/schedule\/templates\/from-workout$/)
    await page.goto('/schedule/templates')
    await create.click()
    await expect(page).toHaveURL(/\/schedule\/templates\/new\/editor$/)
    await addEditorExercise(page)
    await checkEditorAction(page, info.outputPath('template-editor-actions.png'))
  })
}

async function addEditorExercise(page: Page) {
  await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1', exact: true }).click()
}

async function checkEditorAction(page: Page, screenshotPath: string) {
  const edit = page.locator('.workout-editor-footer .overflow-trigger')
  await edit.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await expectContainedButtonText(edit)
  const add = page.locator('.workout-editor-footer').getByRole('button', { name: /Упражнение$/ })
  const editBounds = (await edit.boundingBox())!, addBounds = (await add.boundingBox())!
  expect(Math.abs(editBounds.y + editBounds.height / 2 - addBounds.y - addBounds.height / 2)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Сбросить значения', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

for (const width of [390, 430, 1440]) for (const variant of ['trainer-mono', 'trainer-lime', 'client-mono', 'client-lime-light', 'client-lime-dark']) {
  if (width === 1440 && variant.startsWith('client')) continue
  test(`Button geometry workout editor ${width} ${variant}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const role = variant.startsWith('client') ? 'client' : 'trainer'
    const lime = variant.includes('lime')
    await mockPilot(page, { role, profileId: role === 'client' ? clientId : trainerId, clientLime: lime, fitLime: lime })
    if (role === 'client' && lime) await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    }, { id: clientId, theme: variant.endsWith('light') ? 'light' : 'dark' })
    await page.goto('/workouts/new?date=2026-10-08')
    await addEditorExercise(page)
    await checkEditorAction(page, info.outputPath('workout-editor-actions.png'))
  })
}

function restTimerWorkout(prepSeconds = 0, timed = false): MockWorkout {
  const exercise: WorkoutExercise = {
    id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: timed ? 'plank' : 'squat',
    name: timed ? 'Планка' : 'Приседания', muscleGroup: 'legs', inputKind: timed ? 'duration' : 'strength', position: 0,
    blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 2,
    sets: [82, 83].map((suffix, position) => ({ id: `10000000-0000-4000-8000-0000000000${suffix}`, position,
      ...(timed ? { durationSec: 3 } : { weightKg: 20, reps: 10 }), fact: {}, confirmedAt: null, version: 1 })),
  }
  return { ...workout, status: 'in_progress', startedAt: '2026-10-08T09:00:00Z', ...(prepSeconds > 0 ? { prepSeconds } : {}), exercises: [exercise] }
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime saved plan retains default rest from first set ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'))
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
    await page.addInitScript(({ clientId, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${clientId}`, theme)
      localStorage.setItem(`fit.today-draft.${clientId}.plan.client-rest-contract`, JSON.stringify({
        screen: 'save', text: 'Жим гантелей сидя 2×10 — 30 кг', choices: {}, clientId,
        items: [{ line: 'Жим гантелей сидя 2×10 — 30 кг', exercise: { source: 'system', ref: 'dumbbell-shoulder-press', name: 'Жим гантелей сидя', muscleGroup: 'shoulders', inputKind: 'strength' },
          sets: [{ position: 0, weightKg: 30, reps: 10 }, { position: 1, weightKg: 30, reps: 10 }], hasValues: true }],
        recordMode: 'planned', workoutDate: '2026-10-08', startTime: '', prepSeconds: 0,
      }))
    }, { clientId, theme })
    await page.goto('/me?draft=rest-contract&view=save')
    const request = page.waitForRequest((request) => new URL(request.url()).pathname === '/v1/workouts' && request.method() === 'POST')
    await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
    const payload = (await request).postDataJSON() as { exercises: { restBetweenSetsSec: number }[] }
    expect(payload.exercises[0]!.restBetweenSetsSec).toBe(90)
    await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}$`))
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:30')
    await page.screenshot({ path: info.outputPath('first-rest.png') })
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:31Z'))
    await expect(page.locator('.live-rest-trigger')).toContainText('−0:01')
    await page.reload()
    await expect(page.locator('.live-rest-trigger')).toContainText('−0:01')
    await page.screenshot({ path: info.outputPath('negative-rest.png') })
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
    await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime deletes the selected Live set with explicit confirmation ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    const source = restTimerWorkout()
    source.exercises[0]!.sets[1]!.fact = { weightKg: 30, reps: 10 }
    source.exercises[0]!.sets.push({ ...source.exercises[0]!.sets[1]!, id: '10000000-0000-4000-8000-000000000084', position: 2, weightKg: undefined, reps: undefined })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    let attempts = 0
    await page.route('**/v1/workout-sets/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      attempts += 1
      if (attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
      return route.fallback()
    })
    await page.goto(`/workouts/${workoutId}/live`)
    const forms = page.locator('[data-live-set-id]')
    await expect(forms).toHaveCount(3)
    await forms.nth(2).locator('input').first().focus()
    await page.locator('.live-exercise-head .overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Удалить подход 3', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Удалить подход 3 упражнения «Приседания»?')
    await page.screenshot({ path: info.outputPath('selected-set-confirmation.png') })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(attempts).toBe(0)
    await expect(forms).toHaveCount(3)
    let finishSave = () => {}
    const saveGate = new Promise<void>((resolve) => { finishSave = resolve })
    await page.route('**/v1/workout-sets/*/draft', async (route) => { await saveGate; await route.fallback() })
    await forms.nth(1).locator('input').first().fill('31')
    await page.locator('.live-exercise-head .overflow-trigger').click()
    try { await expect(page.getByRole('menuitem', { name: 'Удалить подход 2', exact: true })).toBeDisabled() }
    finally { finishSave() }
    await expect(page.getByRole('menuitem', { name: 'Удалить подход 2', exact: true })).toBeEnabled()
    await page.getByRole('menuitem', { name: 'Удалить подход 2', exact: true }).click()
    const deletion = page.waitForRequest((request) => request.method() === 'DELETE' && new URL(request.url()).pathname.startsWith('/v1/workout-sets/'))
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    expect(new URL((await deletion).url()).pathname).toContain(source.exercises[0]!.sets[1]!.id)
    await expect(page.locator('.error')).toContainText('Yandex Cloud временно недоступен')
    await expect(forms).toHaveCount(3)
    await page.locator('.live-exercise-head .overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Удалить подход 2', exact: true }).click()
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(forms).toHaveCount(2)
    await expect(page.locator(`[data-live-set-id="${source.exercises[0]!.sets[0]!.id}"]`)).toHaveCount(1)
    await expect(page.locator(`[data-live-set-id="${source.exercises[0]!.sets[2]!.id}"]`)).toHaveCount(1)
    await forms.nth(1).locator('input').first().focus()
    await page.locator('.live-exercise-head .overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Удалить подход 2', exact: true }).click()
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(forms).toHaveCount(1)
    await page.locator('.live-exercise-head .overflow-trigger').click()
    await expect(page.getByRole('menuitem', { name: /Удалить подход/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(forms).toHaveCount(1)
  })
  test(`Client Lime status pills and detail actions share approved geometry ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'))
    const source = { ...restTimerWorkout(), status: 'planned' as const, createdBy: clientId, workoutDate: '2026-10-08' }
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto(`/workouts/${workoutId}`)
    const start = page.locator('.workout-detail-primary-actions .workout-cta')
    await expect(start).toHaveCSS('border-radius', '999px')
    await expect(start).toHaveCSS('font-family', /YS Geo/)
    await expect(start).toHaveCSS('font-size', '16px'); await expect(start).toHaveCSS('font-weight', '500')
    expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    await start.focus(); await expect(start).toBeFocused()
    await page.screenshot({ path: info.outputPath('planned-action.png') })
    let finishStart = () => {}
    const startGate = new Promise<void>((resolve) => { finishStart = resolve })
    await page.route('**/v1/workouts/*/start', async (route) => { await startGate; await route.fallback() })
    await start.click()
    try {
      await expect(start).toBeDisabled(); await expect(start).toHaveCSS('border-radius', '999px')
      await page.screenshot({ path: info.outputPath('pending-action.png') })
    } finally { finishStart() }
    await expect(page).toHaveURL(/\/live$/)
    await expect(page.locator('.live-session-header .workout-status')).toHaveCSS('border-radius', '999px')
    await page.goto('/me/workouts')
    await expect(page.locator('.client-workout-card .workout-status').first()).toHaveCSS('border-radius', '999px')
    const completed = { ...source, status: 'done' as const, completedAt: '2026-10-08T10:00:00Z', sessionRpe: 6, wellbeing: 'good' as const, discomfort: false }
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [completed] })
    await page.goto(`/workouts/${workoutId}`)
    await page.locator('.workout-feedback').getByRole('button', { name: 'Изменить', exact: true }).click()
    const feedback = page.getByRole('button', { name: 'Сохранить итоги', exact: true })
    await expect(feedback).toHaveCSS('border-radius', '999px')
    await expect(feedback).toHaveCSS('font-family', /YS Geo/)
    await page.screenshot({ path: info.outputPath('review-action.png'), fullPage: true })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...source, workoutDate: '2026-10-07' }] })
    await page.goto(`/workouts/${workoutId}`)
    await page.locator('.workout-detail-primary-actions .workout-cta').click()
    const sheet = page.getByRole('dialog', { name: 'Действия с планом' })
    await expect(sheet.getByRole('button', { name: 'Записать результат', exact: true })).toHaveCSS('border-radius', '999px')
    await sheet.getByRole('button', { name: 'Перенести тренировку', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toHaveCSS('border-radius', '999px')
    await page.screenshot({ path: info.outputPath('decision-action.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
  test(`Client Lime preparation and native save fields use the field contract ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem(`fit.today-draft.${id}.plan.client-fields`, JSON.stringify({ screen: 'review', text: '', choices: {}, clientId: id,
        items: [{ line: 'Приседания', exercise: { source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'strength' },
          sets: [{ position: 0, weightKg: 20, reps: 10 }], hasValues: true }] }))
    }, { id: clientId, theme })
    await page.goto('/me?draft=fields&view=review')
    const prep = page.getByLabel('Подготовка перед стартом', { exact: true })
    await expect(prep).toHaveCSS('border-radius', '16px')
    await expect(prep).toHaveCSS('font-size', '16px')
    await expect(prep).toHaveCSS('font-family', /YS Geo/)
    expect((await prep.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    await prep.selectOption('10'); await expect(prep).toHaveValue('10')
    await prep.focus(); await expect(prep).toBeFocused()
    await prep.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('preparation-field.png') })
    await page.getByRole('button', { name: 'Далее', exact: true }).click()
    for (const mode of ['Запланировать', 'Записать выполненную']) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      const date = page.getByLabel('Дата тренировки', { exact: true })
      const time = page.getByLabel('Время тренировки', { exact: true })
      for (const field of [date, time]) {
        await expect(field).toHaveCSS('border-radius', '16px')
        expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(48)
        await expect(field).toHaveCSS('font-family', /YS Geo/)
        await expect(field).toHaveCSS('font-size', '16px')
      }
      const d = (await date.boundingBox())!, t = (await time.boundingBox())!
      expect(t.x - (d.x + d.width)).toBeGreaterThanOrEqual(12)
      await time.fill('12:30'); await expect(time).toHaveValue('12:30')
      await time.fill(''); await expect(time).toHaveValue('')
      await page.screenshot({ path: info.outputPath(`save-${mode}.png`) })
    }
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const request = page.waitForRequest((req) => new URL(req.url()).pathname === '/v1/workouts' && req.method() === 'POST')
    await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
    expect((await request).postDataJSON()).toMatchObject({ prepSeconds: 10 })
    await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}$`))
    await page.reload()
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    await expect(page.locator('.live-rest-trigger')).toContainText('Подготовка')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Live rest legacy negative countdown without preparation', async ({ page }) => {
  // Keep Date fixed across reload while letting loading/render timers run.
  await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых')
  await page.clock.setFixedTime(new Date('2026-10-08T09:00:04Z'))
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await page.reload()
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await page.locator('.live-rest-trigger').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('Live rest starts before the first confirmation response and is not restarted by acknowledgement', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  const source = restTimerWorkout(); source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
  let release = () => {}
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/workout-sets/*/confirm', async (route) => { await responseGate; await route.fallback() })
  try {
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:30')
    await page.clock.fastForward(5_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
    release()
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
  } finally { release() }
})

for (const [width, role] of [[390, 'client'], [430, 'client'], [1440, 'trainer']] as const) for (const clientLime of [false, true]) {
  test(`Live rest toolbar geometry and typography ${role} ${width} lime=${clientLime}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await mockPilot(page, { role, profileId: role === 'client' ? clientId : trainerId, clientLime, fitLime: clientLime, workouts: [restTimerWorkout()] })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.live-rest-trigger')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: info.outputPath('timer-toolbar.png') })
    const metrics = await page.locator('.live-timer-toolbar').evaluate((toolbar) => {
      const timer = toolbar.querySelector('.live-timer')!, rest = toolbar.querySelector('.live-rest-trigger')!
      return { timer: timer.getBoundingClientRect().height, rest: rest.getBoundingClientRect().height,
        font: getComputedStyle(rest).fontFamily, size: getComputedStyle(rest).fontSize }
    })
    await info.attach('timer-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' })
    expect(metrics.rest).toBe(metrics.timer)
    expect(metrics.rest).toBeGreaterThanOrEqual(56)
    if (clientLime) expect(metrics.font).toContain('YS Geo')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('Live rest preparation disabled keeps timed sets manual', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(0, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await page.clock.fastForward(4_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

test('Live rest preparation enabled preserves the automatic phase sequence', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(10, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подготовка 0:10')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 0:02')
  await page.clock.fastForward(2_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
})

test('Live rest failure and retry preserve the countdown and a manual adjustment', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  const source = restTimerWorkout(); source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source], failFirstSetConfirm: true })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  const retry = page.getByRole('button', { name: 'Готово, отдых', exact: true }).filter({ hasText: 'Повтор' })
  await expect(retry).toBeVisible()
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
  await page.locator('.live-rest-trigger').click()
  await page.getByRole('button', { name: 'Плюс 15 секунд', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:40')
  await retry.click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:40')
})

test('Live rest phase expiry waits for a pending confirmation without timing the same set twice', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(10, true)] })
  let release = () => {}, confirmations = 0
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/workout-sets/*/confirm', async (route) => {
    confirmations += 1
    await responseGate
    await route.fallback()
  })
  try {
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.live-rest-trigger')).toContainText('Подготовка')
    await page.clock.fastForward(10_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Подход')
    await page.clock.fastForward(3_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых')
    await expect.poll(() => confirmations).toBe(1)
    await page.clock.fastForward(5_000)
    expect(confirmations).toBe(1)
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
    release()
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
    await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
    await page.clock.fastForward(3_000)
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
    expect(confirmations).toBe(2)
  } finally { release() }
})

test('Live rest invalid empty result does not start the timer', async ({ page }) => {
  const source = restTimerWorkout()
  source.exercises[0]!.sets = source.exercises[0]!.sets.map((set) => ({ ...set, weightKg: undefined, reps: undefined }))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.getByText('Введите результат подхода', { exact: true })).toBeVisible()
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
})

for (const [fitLime, theme] of [[false, 'light'], [false, 'dark'], [true, 'dark']] as const) for (const width of [390, 430, 1440]) {
  test(`Template slow connection and diagnostic retry ${width} lime=${fitLime} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
    await mockPilot(page, { fitLime, workouts: [{ ...restTimerWorkout(), status: 'planned' }] })
    await page.addInitScript((value) => localStorage.setItem('fit.appTheme', value), theme)
    const rows = new Map<string, object>()
    const commands: Array<{ draft: WorkoutTemplateDraft; expectedVersion: number | null }> = []
    await page.route('http://127.0.0.1:4100/v1/workout-templates', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { templates: [...rows.values()] } })
      const command = route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      const row = rows.get(command.draft.id) ?? { ...command.draft, trainerId, notes: command.draft.notes ?? null, version: 1, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
      rows.set(command.draft.id, row)
      if (commands.length === 1) return route.abort('connectionreset')
      return route.fulfill({ json: { template: row } })
    })
    await page.goto(`/schedule/templates/new/editor?sourceWorkout=${workoutId}`)
    await page.getByLabel('Название шаблона').fill('Силовая тренировка с длинным названием без потери черновика')
    await page.clock.install()
    await page.clock.fastForward(46_000)
    let probes = 0
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route('http://127.0.0.1:4100/health', async (route) => {
      probes += 1
      await gate
      await route.fallback()
    })
    try {
      await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
      await expect.poll(() => probes).toBe(1)
      await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled()
      await page.clock.fastForward(2192)
      expect(probes).toBe(1)
      expect(commands).toHaveLength(0)
      release()
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Не удалось подключиться к серверу')
      await expect(alert).toContainText('Код для поддержки: FIT-')
      expect(commands).toHaveLength(1)
      const copy = alert.getByRole('button', { name: 'Скопировать диагностику' })
      await copy.scrollIntoViewIfNeeded()
      expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { localStorage.setItem('template-test-diagnostics', text); return Promise.resolve() } } }))
      await copy.click()
      await expect(alert.getByRole('status')).toHaveText('Скопировано')
      const diagnostic = await page.evaluate(() => localStorage.getItem('template-test-diagnostics'))
      expect(diagnostic).toContain('POST /v1/workout-templates')
      expect(diagnostic).toContain('Этап: network')
      expect(diagnostic).not.toContain('mutation_preflight_failed')
      expect(diagnostic).not.toContain(sessionToken)
      expect(diagnostic).not.toContain('Силовая тренировка')
      expect(commands).toHaveLength(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('template-error-diagnostics.png'), fullPage: true })
      await page.reload()
      await expect(page.getByLabel('Название шаблона')).toHaveValue('Силовая тренировка с длинным названием без потери черновика')
      await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
      await expect(page).toHaveURL(/\/schedule\/templates$/)
      await expect(page.locator('.template-card')).toHaveCount(1)
      expect(commands).toHaveLength(2)
      expect(commands[1]).toEqual(commands[0])
      expect(rows.size).toBe(1)
      expect(await page.evaluate((key) => localStorage.getItem(key), `fit.workout-template-draft.${trainerId}.source:${workoutId}`)).toBeNull()
    } finally { release() }
  })
}

for (const fitLime of [false, true]) {
  test(`Template preflight unavailable diagnostic and manual retry lime=${fitLime}`, async ({ page }, info) => {
    await mockPilot(page, { fitLime, workouts: [{ ...restTimerWorkout(), status: 'planned' }] })
    const commands: Array<{ draft: WorkoutTemplateDraft; expectedVersion: number | null }> = []
    let available = false
    await page.goto(`/schedule/templates/new/editor?sourceWorkout=${workoutId}`)
    await page.getByLabel('Название шаблона').fill('Черновик при недоступном сервере')
    await page.clock.install()
    await page.clock.fastForward(46_000)
    let probes = 0
    await page.route('http://127.0.0.1:4100/health', async (route) => {
      probes += 1
      if (available) return route.fallback()
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    })
    await page.route('http://127.0.0.1:4100/v1/workout-templates', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { templates: [] } })
      const command = route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      return route.fulfill({ json: { template: { ...command.draft, trainerId, notes: null, version: 1, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' } } })
    })
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect.poll(() => probes).toBe(1)
    for (const delayMs of [250, 750, 1500, 3000]) {
      const before = probes
      await page.clock.fastForward(delayMs)
      await expect.poll(() => probes).toBe(before + 1)
    }
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Код для поддержки: FIT-')
    expect(commands).toHaveLength(0)
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { name?: string }, `fit.workout-template-draft.${trainerId}.source:${workoutId}`)).toMatchObject({ name: 'Черновик при недоступном сервере' })
    await alert.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('preflight-error-diagnostic.png'), fullPage: true })
    available = true
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/templates$/)
    expect(commands).toHaveLength(1)
  })

  test(`Template reliability lost response and reload lime=${fitLime}`, async ({ page }, info) => {
    const source = { ...workout, exercises: [{
      id: '10000000-0000-4000-8000-000000000080', source: 'system' as const, ref: 'squat', name: 'Приседания', muscleGroup: 'legs' as const, inputKind: 'strength' as const, position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single' as const, blockRounds: 1,
      blockPreset: 'set' as const, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, weightKg: 50.5, reps: 8, fact: { weightKg: 70 }, confirmedAt: '2026-10-07T00:00:00Z', version: 1 }],
    }] }
    await mockPilot(page, { fitLime, workouts: [source] })
    const rows = new Map<string, object>()
    const commands: Array<{ draft: WorkoutTemplateDraft; expectedVersion: number | null }> = []
    await page.route('http://127.0.0.1:4100/v1/workout-templates', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { templates: [...rows.values()] } })
      const command = route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      const row = rows.get(command.draft.id) ?? { ...command.draft, trainerId, notes: command.draft.notes ?? null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
      rows.set(command.draft.id, row)
      if (commands.length === 1) return route.abort('connectionreset')
      return route.fulfill({ json: { template: row } })
    })
    await page.goto(`/schedule/templates/new/editor?sourceWorkout=${workoutId}`)
    await page.getByLabel('Название шаблона').fill('Силовая без дублей')
    await page.locator('.workout-notes summary').click()
    await page.getByRole('textbox', { name: 'Заметка', exact: true }).fill('Сохранённая инструкция')
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.screenshot({ path: info.outputPath('save-error.png'), fullPage: true })
    await page.reload()
    await expect(page.getByLabel('Название шаблона')).toHaveValue('Силовая без дублей')
    await expect(page.getByRole('textbox', { name: 'Заметка', exact: true })).toHaveValue('Сохранённая инструкция')
    await expect(page.locator('.workout-form-exercise-heading')).toContainText('1 упражнение · 1 подход')
    await page.screenshot({ path: info.outputPath('restored-draft.png'), fullPage: true })
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/templates$/)
    await expect(page.locator('.template-card')).toHaveCount(1)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(JSON.stringify(commands[0])).not.toContain('fact')
    expect(JSON.stringify(commands[0])).not.toContain('confirmedAt')
    expect(rows.size).toBe(1)
    expect(await page.evaluate((key) => localStorage.getItem(key), `fit.workout-template-draft.${trainerId}.source:${workoutId}`)).toBeNull()
    await page.screenshot({ path: info.outputPath('saved-one-template.png'), fullPage: true })
  })
  test(`Template reliability explicit discard lime=${fitLime}`, async ({ page }) => {
    await mockPilot(page, { fitLime })
    await page.goto('/schedule/templates/new/editor')
    await page.getByLabel('Название шаблона').fill('Черновик с нуля')
    await page.reload()
    await expect(page.getByLabel('Название шаблона')).toHaveValue('Черновик с нуля')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.getByLabel('Название шаблона')).toHaveValue('Черновик с нуля')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/templates$/)
    await page.goto('/schedule/templates/new/editor')
    await expect(page.getByLabel('Название шаблона')).toHaveValue('')
  })
}

for (const role of ['client', 'trainer'] as const) for (const width of (role === 'client' ? [390, 430] : [390, 1440])) {
  test(`Workout actual duration correction ${role} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 932 })
    await mockPilot(page, { role, profileId: role === 'client' ? clientId : trainerId,
      workouts: [{ ...workout, status: 'done', startedAt: '2026-09-24T23:30:00Z', completedAt: '2026-09-25T00:30:00Z' }] })
    const commands: unknown[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/duration')) commands.push(request.postDataJSON() as unknown)
    })
    await page.goto(`/workouts/${workoutId}`)
    const summary = page.getByRole('region', { name: 'Сводка тренировки' })
    await expect(summary).toHaveClass(/has-two-metrics/)
    expect(await summary.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
    const control = page.locator('.workout-actual-duration')
    await expect(control).toContainText('1 ч 00 мин')
    await page.getByRole('button', { name: 'Изменить длительность' }).click()
    const dialog = page.getByRole('dialog', { name: 'Длительность тренировки', exact: true })
    const input = dialog.getByRole('textbox', { name: 'Длительность тренировки, мин' })
    await expect(input).toHaveValue('60')
    await input.fill('0')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Укажите длительность')
    expect(commands).toHaveLength(0)
    await input.fill('50,5')
    if (width <= 430) {
      // WKWebView keeps layout height while the keyboard shrinks visualViewport.
      const original = await page.evaluate(() => {
        const style = document.documentElement.style
        const values = [style.getPropertyValue('--app-visible-height'), style.getPropertyValue('--app-viewport-offset-top')]
        style.setProperty('--app-visible-height', '460px')
        style.setProperty('--app-viewport-offset-top', '36px')
        return values
      })
      const bounds = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const save = element.querySelector<HTMLButtonElement>('button[type="submit"]')!.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, saveBottom: save.bottom }
      })
      expect(bounds.top).toBeGreaterThanOrEqual(52)
      expect(bounds.bottom).toBeLessThanOrEqual(480)
      expect(bounds.saveBottom).toBeLessThanOrEqual(480)
      await page.evaluate((values) => {
        document.documentElement.style.setProperty('--app-visible-height', values[0]!)
        document.documentElement.style.setProperty('--app-viewport-offset-top', values[1]!)
      }, original)
    }
    await page.screenshot({ path: testInfo.outputPath(`duration-dialog-${role}-${width}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(control).toContainText('51 мин')
    expect(commands).toEqual([{ actualDurationSec: 3030, expectedVersion: 1 }])
    await page.reload()
    await expect(control).toContainText('51 мин')
    await page.getByRole('button', { name: 'Изменить длительность' }).click()
    await expect(input).toHaveValue('50.5')
    await input.fill('')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(control).toContainText('1 ч 00 мин')
    await page.evaluate(({ role, clientId }) => {
      localStorage.setItem(role === 'client' ? `fit.clientLime.theme.${clientId}` : 'fit.appTheme', 'dark')
      window.dispatchEvent(new Event(role === 'client' ? 'fit-client-lime-theme-change' : 'fit-theme-change'))
    }, { role, clientId })
    await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
    await page.getByRole('button', { name: 'Изменить длительность' }).click()
    await page.screenshot({ path: testInfo.outputPath(`duration-dark-${role}-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить длительность' })).toBeFocused()
  })
}

for (const role of ['client', 'trainer'] as const) test(`Workout actual duration quick entry and draft ${role}`, async ({ page }) => {
  const profileId = role === 'client' ? '10000000-0000-4000-8000-000000000099' : trainerId
  await mockPilot(page, { role, profileId, pilot: false })
  await page.addInitScript(({ profileId, clientId }) => { if (!localStorage.getItem(`fit.today-draft.${profileId}`)) localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
    screen: 'save', text: 'Приседания 3 по 8', choices: {},
    items: [{ line: 'Приседания 3 по 8', exercise: { source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps' }, sets: [{ position: 0, reps: 8 }], hasValues: true }],
    clientId, recordMode: 'completed', workoutDate: '2026-09-24', startTime: '',
  })) }, { profileId, clientId })
  const path = role === 'client' ? '/me?view=save' : '/today?view=save'
  await page.goto(path)
  const input = page.getByRole('textbox', { name: 'Длительность тренировки, мин' })
  await expect(input).toHaveValue('')
  await input.fill('50,5')
  await expect.poll(async () => page.evaluate((id) =>
    (JSON.parse(localStorage.getItem(`fit.today-draft.${id}`) ?? '{}') as { actualDurationMinutes?: string }).actualDurationMinutes,
  profileId)).toBe('50,5')
  await page.reload()
  await expect(input).toHaveValue('50,5')
  const saved = page.waitForRequest((request) => new URL(request.url()).pathname === '/v1/workouts/completed')
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  const request = await saved
  expect((request.postDataJSON() as { actualDurationSec: number }).actualDurationSec).toBe(3030)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}$`))
  await expect(page.locator('.workout-actual-duration')).toContainText('51 мин')
})

test('Workout actual duration keeps draft through network error and conflict without blind overwrite', async ({ page }) => {
  const current: MockWorkout = { ...workout, status: 'done', completedAt: '2026-09-24T12:00:00Z', actualDurationSec: null }
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [current] })
  let attempts = 0
  await page.route(`**/v1/workouts/${workoutId}/duration`, async (route) => {
    attempts += 1
    if (attempts === 1) return route.abort('connectionrefused')
    if (attempts === 2) {
      current.actualDurationSec = 2700
      current.version = 2
      return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' })
    }
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Указать длительность' }).click()
  const dialog = page.getByRole('dialog', { name: 'Длительность тренировки', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Длительность тренировки, мин' })
  await expect(input).toHaveValue('')
  await input.fill('50')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(/повторите/i)
  await expect(input).toHaveValue('50')
  expect(attempts).toBe(1)
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('45 мин')
  await expect(input).toHaveValue('50')
  expect(attempts).toBe(2)
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.workout-actual-duration')).toContainText('50 мин')
  expect(attempts).toBe(3)
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Achievement artwork has only earned and gray states ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: Array.from({ length: 18 }, (_, index) => ({
      ...workout, id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      status: 'done', completedAt: '2026-09-24T10:00:00Z',
    })) })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me/achievements')
    const earned = page.locator('.badge-id-workouts-10 .athlete-achievement-static-art')
    const partial = page.locator('.badge-id-workouts-25 .athlete-achievement-static-art')
    const distant = page.locator('.badge-id-workouts-50 .athlete-achievement-static-art')
    await expect(earned).toHaveCSS('filter', 'none')
    await expect(partial).toHaveCSS('filter', 'grayscale(1) brightness(0.7)')
    await expect(distant).toHaveCSS('filter', 'grayscale(1) brightness(0.7)')
    const earnedCard = page.getByRole('button', { name: /^Десятка тренировок\./ })
    const partialCard = page.getByRole('button', { name: /^Четверть сотни\./ })
    const distantCard = page.getByRole('button', { name: /^Полсотни\./ })
    await expect(earnedCard.locator('.athlete-achievement-progress-track')).toHaveCount(0)
    await expect(partialCard.locator('.athlete-achievement-progress-label')).toHaveText('18 из 25')
    const fillBox = await partialCard.locator('.athlete-achievement-progress-track > span').boundingBox()
    await expect(distantCard.locator('.athlete-achievement-progress-track')).toHaveCount(0)
    const badgeBox = await partialCard.locator('.athlete-achievement-badge').boundingBox()
    const trackBox = await partialCard.locator('.athlete-achievement-progress-track').boundingBox()
    const titleBox = await partialCard.locator('.athlete-achievement-card-title').boundingBox()
    expect(fillBox && trackBox && Math.abs(fillBox.width / trackBox.width - 18 / 25) < 0.01).toBe(true)
    expect(badgeBox && trackBox && titleBox && badgeBox.y + badgeBox.height < trackBox.y && trackBox.y < titleBox.y).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('achievement-states.png') })
    if (width === 390) {
      await page.addStyleTag({ content: '.athlete-achievement-card-title { font-size: 20px !important; }' })
      await expect(partialCard.locator('.athlete-achievement-card-title')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: /^Полсотни\./ }).click()
    await expect(page.getByRole('dialog')).toContainText('Прогресс: 18 из 50')
  })
}

test('Achievement collection recovers after an error and its last row clears navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const backend = await mockPilot(page, { role: 'client', profileId: clientId, workouts: [], failTrainingData: true })
  await page.goto('/me/achievements')
  await expect(page.getByText('Не удалось загрузить историю тренировок.')).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Получено 0 из 83')).toBeVisible()
  await expect(page.locator('.athlete-achievement-progress-track')).toHaveCount(0)
  await page.locator('.content').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const last = await page.locator('.athlete-achievement-card').last().boundingBox()
  const nav = await page.locator('.client-tab-bar').boundingBox()
  expect(last && nav && last.y + last.height < nav.y).toBe(true)
  await page.reload()
  await expect(page.getByText('Получено 0 из 83')).toBeVisible()
})

test('Achievement collection restores earned badges after signing in again', async ({ page }) => {
  const history = [{ ...workout, status: 'done', completedAt: '2026-09-23T12:00:00Z' }]
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: history })
  await page.goto('/me/achievements')
  const first = page.getByRole('button', { name: /^Первый шаг\./ })
  await expect(first.locator('.athlete-achievement-badge')).toHaveClass(/is-earned/)
  await page.goto('/me/settings')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/auth/)
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: history })
  await page.goto('/me/achievements')
  await expect(first.locator('.athlete-achievement-badge')).toHaveClass(/is-earned/)
})

test('Completing the next workout earns a bright badge and moves progress to the following tier', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00+03:00'))
  const previous = Array.from({ length: 24 }, (_, index) => ({
    ...workout, id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    status: 'done', completedAt: '2026-09-23T12:00:00Z',
  }))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [...previous, {
    ...workout, createdBy: clientId, trainingFormat: 'self', exercises: [{
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, reps: 8, fact: {}, confirmedAt: null, version: 1 }],
    }],
  }] })
  await page.goto('/me/achievements')
  const twentyFive = page.getByRole('button', { name: /^Четверть сотни\./ })
  const fifty = page.getByRole('button', { name: /^Полсотни\./ })
  await expect(twentyFive.locator('.athlete-achievement-progress-label')).toHaveText('24 из 25')
  await expect(fifty.locator('.athlete-achievement-progress-track')).toHaveCount(0)
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Завершить', exact: true })
  if (await confirm.isVisible()) await confirm.click()
  await expect(page.getByRole('region', { name: 'Тренировка завершена', exact: true })).toBeVisible()
  await page.goto('/me/achievements')
  await expect(twentyFive.locator('.athlete-achievement-badge')).toHaveClass(/is-earned/)
  await expect(twentyFive.locator('.athlete-achievement-progress-track')).toHaveCount(0)
  await expect(fifty.locator('.athlete-achievement-progress-label')).toHaveText('25 из 50')
  await expect(fifty.locator('.athlete-achievement-static-art')).toHaveCSS('filter', 'grayscale(1) brightness(0.7)')
  await page.screenshot({ path: testInfo.outputPath('achievement-after-25-workouts.png') })
  await page.goto('/me')
  await expect(page.locator('.athlete-achievements-home')).toContainText('Четверть сотни')
  await expect(page.locator('.athlete-achievements-home .athlete-achievement-badge')).toHaveClass(/is-earned/)
  await page.goto('/me/progress')
  await expect(page.locator('.athlete-achievements-preview .athlete-achievement-badge.is-earned')).toHaveCount(3)
  await expect(page.locator('.athlete-achievements-preview .athlete-achievement-progress-track')).toHaveCount(0)
})

const workout = {
  id: workoutId,
  trainerId,
  clientId,
  clientName: 'Алексей Смирнов',
  createdBy: trainerId,
  trainingFormat: 'with_trainer' as const,
  startedBy: null,
  completedBy: null,
  workoutDate: '2026-09-24',
  startTime: '10:00',
  endTime: '11:00',
  status: 'planned',
  notes: null,
  clientComment: null,
  sessionRpe: null,
  wellbeing: null,
  discomfort: null,
  feedbackSubmittedAt: null,
  trainerReaction: null,
  trainerReview: null,
  trainerReviewAuthorId: null,
  trainerReviewedAt: null,
  clientQuestion: null,
  clientQuestionAskedAt: null,
  clientQuestionResolvedAt: null,
  startedAt: null,
  completedAt: null,
  version: 1,
  exercises: [] as WorkoutExercise[],
}

type MockWorkout = Omit<typeof workout, 'startTime' | 'endTime' | 'startedAt' | 'completedAt' | 'createdBy' | 'trainingFormat' | 'sessionRpe' | 'wellbeing' | 'discomfort'> & { sessionRpe?: number | null; wellbeing?: 'good' | 'normal' | 'bad' | null; discomfort?: boolean | null; createdBy: string | null; startTime: string | null; endTime: string | null; startedAt: string | null; completedAt: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer'; plannedDate?: string; plannedStartTime?: string | null; plannedEndTime?: string | null; prepSeconds?: number; actualDurationSec?: number | null; activeCaloriesKcal?: number | null; calorieEstimateBasis?: string | null; calorieEstimateNotice?: string | null }

async function mockPilot(page: Page, options: { role?: 'trainer' | 'client'; profileId?: string; clientTrainerId?: string; pilot?: boolean; fitLime?: boolean; clientLime?: boolean; scheduleDensity?: 'comfortable' | 'compact'; hasClients?: boolean; clientRecords?: Array<{ id: string; fullName: string; archivedAt: string | null; version: number }>; workouts?: MockWorkout[]; withGoal?: boolean; withMeasurements?: boolean; clientGender?: 'male' | 'female'; withCustomExercise?: boolean; failProgress?: boolean; failProfile?: boolean; failFirstProfileSave?: boolean; failFirstCustomExerciseSave?: boolean; failArchive?: boolean; failClients?: boolean; failTrainingData?: boolean; failConnections?: boolean; failWorkspace?: boolean; failThreads?: boolean; questionWorkout?: boolean; failFirstSetConfirm?: boolean; failFirstSave?: boolean; failFirstChatSend?: boolean } = {}) {
  const profileId = options.profileId ?? trainerId
  let snoozedUntil: string | null = null
  let failClients = options.failClients ?? false
  let failTrainingData = options.failTrainingData ?? false
  let failConnections = options.failConnections ?? false
  let failProgress = options.failProgress ?? false
  let failProfile = options.failProfile ?? false
  let failArchive = options.failArchive ?? false
  let failWorkspace = options.failWorkspace ?? false
  let failThreads = options.failThreads ?? false
  let questionAnswered = false
  let unreadCount = 4
  let workouts: MockWorkout[] = options.workouts ?? [{ ...workout,
    ...(options.role !== 'client' ? { trainerId: profileId, createdBy: profileId } : {}),
  }]
  let clientRecords = options.clientRecords ?? [{ id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 }]
  let goalRecord: Record<string, unknown> | null = options.withGoal ? {
    id: '10000000-0000-4000-8000-000000000040', clientId, title: 'Подготовка к старту', targetDate: '2026-12-01',
    status: 'active', version: 1, criteria: [], stages: [{ id: '10000000-0000-4000-8000-000000000041', goalId: '10000000-0000-4000-8000-000000000040', title: 'База', startsOn: '2026-09-01', endsOn: '2026-10-01', position: 0, version: 1 }],
  } : null
  let progressEntries = options.withMeasurements ? [{
    id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: profileId, recordedOn: '2026-09-24',
    weightKg: 70 as number | null, chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1,
  }] : []
  let failFirstSetConfirm = options.failFirstSetConfirm ?? false
  let saveAttempts = 0
  let chatSendAttempts = 0
  let profileSaveAttempts = 0
  let customExerciseSaveAttempts = 0
  let customExercises = options.withCustomExercise ? [{ id: customExerciseId, name: 'Мой присед', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: null, equipment: null, description: null, archivedAt: null as string | null, version: 1, createdBy: profileId }] : []
  let scheduleDensity = options.scheduleDensity ?? 'comfortable'
  let professionalProfile = {
    publicId: '10000000-0000-4000-8000-000000000060',
    draft: { displayName: 'Антон', bio: '', specialties: [] as string[], city: '', metroStationIds: [] as string[], customLocations: [] as string[], trainingModes: [] as string[], experienceStartYear: null as number | null, education: '', formats: '', price: '', acceptingClients: false, avatarDataUrl: null as string | null, photos: [], certificates: [] },
    published: null as Record<string, unknown> | null,
    listedInCatalog: false,
    publishedAt: null as string | null,
    updatedAt: '2026-09-24T09:00:00.000Z',
    version: 1,
    isBrandTrainer: false,
  }
  const sentMessages: Array<{ id: string; conversationId: string; senderId: string; body: string; createdAt: string; editedAt: null; replyTo: null; image: null }> = []
  let lastSavedStartTime: string | null = null
  let lastEditedStartTime: string | null = null
  await page.route('http://127.0.0.1:4100/health', async (route) => {
    await route.fulfill({ status: 200, headers: { 'x-fit-request-id': 'pilot-health-check', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-fit-request-id' }, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.addInitScript(({ token, profileId }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
    localStorage.setItem(`fit.coachmarks-seen.${profileId}`, JSON.stringify([
      'assistant-all-trainers-2026-09',
      'client-assistant-2026-09',
      'missed-workout-actions-2026-08',
      'live-timer-2026-09',
      'live-phase-timer-2026-10',
      'lime-quick-plan-2026-10',
      'lime-direct-client-start-2026-10',
      'lime-day-workspace-2026-10',
      'lime-schedule-history-2026-10',
      'lime-schedule-ownership-2026-10',
    ]))
  }, { token: sessionToken, profileId })
  await page.route('http://127.0.0.1:4100/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let body: unknown
    if (url.pathname === '/v1/auth/yandex/session' && route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else if (url.pathname === '/v1/auth/yandex/session') {
      body = {
        accessMode: 'read_write',
        profile: {
          id: profileId,
          firstName: 'Антон',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: options.role ?? 'trainer',
          ...(options.role === 'client' ? { client: { id: clientId, trainerId: options.clientTrainerId ?? trainerId, fullName: 'Алексей Смирнов' } } : {}),
          experiments: { trainerScheduleV2: options.pilot !== false, fitLime: options.fitLime === true, clientLime: options.role === 'client' && (options.clientLime === true || (options.profileId === clientId && options.clientLime !== false)) },
          preferences: { scheduleDensity },
        },
      }
    } else if (url.pathname === '/v1/profile' && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { scheduleDensity?: 'comfortable' | 'compact' }
      if (draft.scheduleDensity) scheduleDensity = draft.scheduleDensity
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else if (url.pathname === '/v1/trainers/catalog') {
      body = { items: [], totalCount: 0, nextOffset: null }
    } else if (url.pathname === '/v1/me/finance') {
      body = { finance: { trainers: [] } }
    } else if (url.pathname === '/v1/me/sport-profile') {
      body = { sport: { sports: [], bio: null } }
    } else if (url.pathname === '/v1/finance/overview') {
      body = { overview: { month: url.searchParams.get('month'), receivedCents: 0, dueCents: 0, attentionCount: 0, clients: [] } }
    } else if (url.pathname === `/v1/clients/${clientId}/finance`) {
      body = { finance: { clientId, packages: [], payments: [], sessions: [] } }
    } else if (url.pathname === '/v1/workout-templates') {
      body = { templates: [] }
    } else if (url.pathname === '/v1/legal/acceptance') {
      body = { applicable: true, accepted: true, acceptedAt: '2026-09-01T00:00:00.000Z' }
    } else if (url.pathname === '/v1/trainer-profile' && route.request().method() === 'GET') {
      if (failProfile) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile' && route.request().method() === 'PUT') {
      profileSaveAttempts += 1
      if (options.failFirstProfileSave && profileSaveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      professionalProfile = { ...professionalProfile, draft: route.request().postDataJSON() as typeof professionalProfile.draft, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/photos' && route.request().method() === 'POST') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"photo unavailable"}' })
      return
    } else if (url.pathname === '/v1/trainer-profile/publish' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, published: professionalProfile.draft, listedInCatalog: true, publishedAt: '2026-09-24T09:01:00.000Z', version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/unpublish' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, published: null, listedInCatalog: false, publishedAt: null, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/catalog' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, listedInCatalog: (route.request().postDataJSON() as { listed: boolean }).listed, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === `/v1/clients/${clientId}/workout-stats`) {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { stats: computeClientStats(workouts.map((item) => {
        const status = item.status
        if (status !== 'planned' && status !== 'in_progress' && status !== 'done' && status !== 'cancelled') {
          throw new Error('Invalid workout fixture status')
        }
        return { id: item.id, workoutDate: localDate(item.workoutDate), status }
      }),
      localDate(url.searchParams.get('today') ?? '2026-10-06')) }
    } else if (url.pathname === '/v1/workouts/home') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { workouts: workoutHomeSummaries(workouts.map((item) => {
        const status = item.status
        if (status !== 'planned' && status !== 'in_progress' && status !== 'done' && status !== 'cancelled') throw new Error('Invalid workout fixture status')
        return { ...item, status, workoutDate: localDate(item.workoutDate) }
      }), localDate(url.searchParams.get('today') ?? '2026-10-06')) }
    } else if (url.pathname.endsWith('/active-workout')) {
      const active = workouts.find((item) => item.clientId === url.pathname.split('/')[3] && item.status === 'in_progress')
      body = { workout: active ? { id: active.id, workoutDate: active.workoutDate, status: active.status } : null }
    } else if (url.pathname === '/v1/training-data') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const trainingData = {
        accessMode: 'read_only',
        customExercises,
        workouts: options.questionWorkout ? [{
          ...workout,
          status: 'done',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          clientQuestionResolvedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          trainerReview: questionAnswered ? 'Да, можно заменить.' : null,
          trainerReviewedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          completedAt: '2026-09-24T11:00:00.000Z',
          version: questionAnswered ? 2 : 1,
        }] : workouts.map((item) => ({ ...item, exercises: item.exercises.map((exercise) => ({ ...exercise, customExerciseId: exercise.customExerciseId ?? null, trainerComment: exercise.trainerComment ?? null,
          sets: exercise.sets.map((set) => ({ ...set,
            plan: { weightKg: set.weightKg ?? null, reps: set.reps ?? null, durationMin: set.durationMin ?? null, durationSec: set.durationSec ?? null, distanceKm: set.distanceKm ?? null, rpe: set.rpe ?? null },
            fact: { weightKg: set.fact.weightKg ?? null, reps: set.fact.reps ?? null, durationMin: set.fact.durationMin ?? null, durationSec: set.fact.durationSec ?? null, distanceKm: set.fact.distanceKm ?? null, rpe: set.fact.rpe ?? null },
          })),
        })) })),
        attention: options.questionWorkout && !questionAnswered ? [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          workoutDate: '2026-09-24',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          discomfort: false,
          clientComment: null,
          feedbackSubmittedAt: '2026-09-24T11:30:00.000Z',
          version: 1,
        }] : [],
        attentionPreferences: snoozedUntil ? [{ clientId, snoozedUntil }] : [],
        hasMoreWorkouts: false,
        totalWorkouts: workouts.length,
      }
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 100)
      const scope = url.searchParams.get('scope')
      const filtered = trainingData.workouts.filter((item) =>
        (!url.searchParams.has('clientId') || item.clientId === url.searchParams.get('clientId'))
        && (!url.searchParams.has('workoutId') || item.id === url.searchParams.get('workoutId'))
        && (!url.searchParams.has('from') || item.workoutDate >= url.searchParams.get('from')!)
        && (!url.searchParams.has('to') || item.workoutDate <= url.searchParams.get('to')!))
        .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate) || left.id.localeCompare(right.id))
      body = {
        ...trainingData,
        ...(scope === 'workouts' ? { customExercises: [], attention: [], attentionPreferences: [] } : {}),
        workouts: scope === 'metadata' ? [] : filtered.slice(offset, offset + limit),
        hasMoreWorkouts: scope !== 'metadata' && offset + limit < filtered.length,
        totalWorkouts: scope === 'metadata' ? 0 : filtered.length,
      }
    } else if (url.pathname === '/v1/custom-exercises' && route.request().method() === 'POST') {
      customExerciseSaveAttempts += 1
      if (options.failFirstCustomExerciseSave && customExerciseSaveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { name: string; muscleGroup: string; inputKind: string }
      const exercise = { id: customExerciseId, ...draft, primaryMuscleDetail: null, equipment: null, description: null, archivedAt: null, version: 1, createdBy: profileId }
      customExercises = [exercise]
      body = { exercise }
    } else if (url.pathname === `/v1/custom-exercises/${customExerciseId}` && route.request().method() === 'PUT') {
      const command = route.request().postDataJSON() as { draft: { name: string; muscleGroup: string; inputKind: string } }
      customExercises = customExercises.map((item) => ({ ...item, ...command.draft, version: item.version + 1 }))
      body = { exercise: customExercises[0] }
    } else if (url.pathname === `/v1/custom-exercises/${customExerciseId}/archive` && route.request().method() === 'PUT') {
      if (failArchive) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const command = route.request().postDataJSON() as { archived: boolean }
      customExercises = customExercises.map((item) => ({ ...item, archivedAt: command.archived ? '2026-09-24T09:00:00.000Z' : null, version: item.version + 1 }))
      body = { exercise: customExercises[0] }
    } else if (url.pathname === '/v1/clients' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as { fullName: string }
      clientRecords = [...clientRecords, { id: '10000000-0000-4000-8000-000000000030', fullName: input.fullName, archivedAt: null, version: 1 }]
      body = { client: { id: '10000000-0000-4000-8000-000000000030' } }
    } else if (url.pathname === '/v1/clients') {
      if (failClients) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { clients: options.hasClients === false ? [] : clientRecords.filter((client) => url.searchParams.get('archived') === 'true' ? client.archivedAt !== null : client.archivedAt === null).map((client) => ({
        id: client.id,
        canArchive: true,
        hasAccount: true,
        fullName: client.fullName,
        canonicalFullName: client.fullName,
        gender: options.clientGender ?? null,
        ageYears: null,
        ageUpdatedAt: null,
        heightCm: null,
        goal: null,
        note: null,
        currentWeightKg: null,
        archivedAt: client.archivedAt,
        version: client.version,
        membershipVersion: 1,
      })) }
    } else if (url.pathname === '/v1/connections') {
      if (failConnections) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { memberships: clientRecords.map((client) => ({ clientId: client.id, trainerId: profileId, firstName: 'Антон', lastName: null, joinedAt: '2026-09-01T00:00:00.000Z', isRoot: true })), invitations: [] }
    } else if (url.pathname === '/v1/progress' && route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as { draft: { recordedOn: string; weightKg: number | null } }
      progressEntries = [{ id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: profileId, recordedOn: command.draft.recordedOn,
        weightKg: command.draft.weightKg, chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1 }]
      body = { progress: { id: '10000000-0000-4000-8000-000000000050' } }
    } else if (url.pathname === '/v1/progress/10000000-0000-4000-8000-000000000050' && route.request().method() === 'DELETE') {
      progressEntries = []
      body = { progress: { version: 2 } }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress$/.test(url.pathname)) {
      if (failProgress) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { entries: progressEntries, customMetrics: [], goal: goalRecord }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/exercises\//.test(url.pathname)) {
      body = { items: [], nextCursor: null, totalCount: 0 }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/regularity$/.test(url.pathname)) {
      body = { regularity: [{ period: 'week', periodStart: '2026-09-21', periodEnd: '2026-09-27', plannedCount: 1, completedCount: 0, completedPlannedCount: 0, partialCount: 0, skippedCount: 0, completionPercent: null }] }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/running$/.test(url.pathname)) {
      body = { sessions: [] }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/training-summaries$/.test(url.pathname)) {
      body = { summaries: [] }
    } else if (url.pathname === '/v1/goals' && route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as { draft: { title: string; targetDate: string | null } }
      goalRecord = { id: '10000000-0000-4000-8000-000000000040', clientId, title: command.draft.title, targetDate: command.draft.targetDate, status: 'active', version: 1, criteria: [], stages: [] }
      body = { goal: { id: '10000000-0000-4000-8000-000000000040' } }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/archive$/.test(url.pathname) && route.request().method() === 'PUT') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { archived: boolean; expectedVersion: number }
      clientRecords = clientRecords.map((client) => client.id === id ? { ...client, archivedAt: command.archived ? '2026-09-24T12:00:00.000Z' : null, version: client.version + 1 } : client)
      body = { client: { id, version: command.expectedVersion + 1 } }
    } else if (url.pathname === `/v1/clients/${clientId}/attention/snooze` && route.request().method() === 'POST') {
      snoozedUntil = '2099-01-01T00:00:00.000Z'
      body = { client: { snoozedUntil } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/question/answer` && route.request().method() === 'PUT') {
      questionAnswered = true
      body = { workout: { version: 2 } }
    } else if (/^\/v1\/workout-sets\/[0-9a-f-]+$/.test(url.pathname) && route.request().method() === 'DELETE') {
      const id = url.pathname.split('/')[3]
      workouts = workouts.map((item) => item.exercises.some((exercise) => exercise.sets.some((set) => set.id === id))
        ? { ...item, version: item.version + 1, exercises: item.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.id !== id).map((set, position) => ({ ...set, position })) })) } : item)
      body = { set: { version: workouts.find((item) => item.id === workoutId)!.version } }
    } else if (/^\/v1\/workout-sets\/[0-9a-f-]+\/(draft|confirm)$/.test(url.pathname)) {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { expectedVersion: number; draft?: { reps?: number; weightKg?: number } }
      const confirmed = url.pathname.endsWith('/confirm')
      if (confirmed && failFirstSetConfirm) { failFirstSetConfirm = false; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }); return }
      workouts = workouts.map((item) => ({ ...item, exercises: item.exercises.map((exercise) => ({ ...exercise,
        sets: exercise.sets.map((set) => set.id === id ? { ...set, fact: command.draft ?? set.fact,
          confirmedAt: confirmed ? '2026-09-24T09:01:00Z' : set.confirmedAt, version: command.expectedVersion + 1 } : set),
      })) }))
      body = { set: { version: command.expectedVersion + 1 } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/(start|finish)$/.test(url.pathname) && route.request().method() === 'POST') {
      const id = url.pathname.split('/')[3]
      const finished = url.pathname.endsWith('/finish')
      workouts = workouts.map((item) => item.id === id ? { ...item, status: finished ? 'done' : 'in_progress', completedAt: finished ? '2026-09-24T12:00:00Z' : null, version: item.version + 1 } : item)
      body = { workout: { version: workouts.find((item) => item.id === id)!.version } }
    } else if (url.pathname === '/v1/workouts/quick-start' && route.request().method() === 'POST') {
      workouts = [{ ...workout, id: newWorkoutId, status: 'in_progress' }]
      body = { workout: { id: newWorkoutId, resumed: false } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/duration$/.test(url.pathname) && route.request().method() === 'PUT') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { actualDurationSec: number | null; expectedVersion: number }
      const current = workouts.find((item) => item.id === id)!
      if (current.version !== command.expectedVersion && current.actualDurationSec !== command.actualDurationSec) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' })
        return
      }
      workouts = workouts.map((item) => item.id === id ? { ...item, actualDurationSec: command.actualDurationSec, version: item.version + 1 } : item)
      body = { workout: { id, version: workouts.find((item) => item.id === id)!.version } }
    } else if ((url.pathname === '/v1/workouts' || url.pathname === '/v1/workouts/completed') && route.request().method() === 'POST') {
      saveAttempts += 1
      if (options.failFirstSave && saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const completed = url.pathname.endsWith('/completed')
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer'; prepSeconds?: number; actualDurationSec?: number | null; exercises?: WorkoutExerciseDraft[] }
      lastSavedStartTime = draft.startTime ?? null
      const exercises: WorkoutExercise[] = (draft.exercises ?? []).map((exercise, index) => ({ ...exercise,
        id: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`, blockId: `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
        blockType: exercise.blockType ?? 'single', blockPreset: exercise.blockPreset ?? 'set', blockRounds: exercise.blockRounds ?? 1,
        restBetweenExercisesSec: exercise.restBetweenExercisesSec ?? 0, restBetweenRoundsSec: exercise.restBetweenRoundsSec ?? 0, restBetweenSetsSec: exercise.restBetweenSetsSec ?? 60,
        sets: exercise.sets.map((set, setIndex) => ({ ...set, id: `10000000-0000-4000-8000-${String(300 + index * 10 + setIndex).padStart(12, '0')}`, fact: completed ? set : {}, confirmedAt: completed ? '2026-09-24T12:00:00Z' : null, version: 1 })),
      }))
      workouts = [...workouts.filter((item) => item.id !== newWorkoutId), { ...workout, exercises, trainingFormat: draft.trainingFormat, id: newWorkoutId, title: draft.title, workoutDate: draft.workoutDate, startTime: draft.startTime ?? null, endTime: draft.endTime ?? null,
        createdBy: profileId, status: completed ? 'done' : 'planned', prepSeconds: draft.prepSeconds ?? 0, actualDurationSec: draft.actualDurationSec,
        completedAt: completed ? '2026-09-24T12:00:00Z' : null }]
      body = { workout: { id: newWorkoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}` && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null }
      lastEditedStartTime = draft.startTime ?? null
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', endTime: draft.endTime || '11:00', version: item.version + 1 }
        : item)
      body = { workout: { id: workoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/reschedule` && route.request().method() === 'POST') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null }
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', version: item.version + 1 }
        : item)
      body = { workout: { version: 2 } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/cancel` && route.request().method() === 'POST') {
      workouts = workouts.map((item) => item.id === workoutId ? { ...item, status: 'cancelled', version: item.version + 1 } : item)
      body = { workout: { version: 2 } }
    } else if (url.pathname === '/v1/assistant/conversations' && route.request().method() === 'POST') {
      body = { conversation: { id: conversationId, title: null, createdAt: '2026-09-27T12:00:00.000Z' } }
    } else if (url.pathname === '/v1/assistant/conversations') {
      body = { conversations: [] }
    } else if (url.pathname === `/v1/assistant/conversations/${conversationId}/messages`) {
      body = { messages: [] }
    } else if (url.pathname === '/v1/assistant/actions') {
      body = { actions: [] }
    } else if (url.pathname === '/v1/trainer-workspace') {
      if (failWorkspace) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = {
        summary: {
          pendingActionCount: 3,
          unresolvedQuestionCount: questionAnswered ? 0 : 1,
          unreadChatMessageCount: unreadCount,
          inboxCount: (questionAnswered ? 0 : 1) + unreadCount,
          updatedAt: '2026-09-24T12:00:00.000Z',
        },
        questions: questionAnswered ? [] : [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          question: 'Можно заменить приседания?',
          askedAt: '2026-09-24T11:30:00.000Z',
        }],
      }
    } else if (url.pathname === '/v1/chat/threads') {
      if (failThreads) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { threads: [{
        conversationId,
        clientId,
        trainerId,
        partnerUserId: clientId,
        partnerName: 'Алексей Смирнов',
        activeConnection: true,
        lastMessageBody: 'Спасибо!',
        lastMessageAt: '2026-09-24T11:45:00.000Z',
        lastMessageSenderId: clientId,
        unreadCount,
        canMessage: true,
        blockedByMe: false,
        blockedByPartner: false,
      }] }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages` && route.request().method() === 'POST') {
      chatSendAttempts += 1
      if (options.failFirstChatSend && chatSendAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { id: string; body: string }
      const message = { id: draft.id, conversationId, senderId: profileId, body: draft.body, createdAt: '2026-09-24T12:00:00.000Z', editedAt: null, replyTo: null, image: null }
      sentMessages.push(message)
      body = { message }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages`) {
      body = { messages: [{ id: messageId, conversationId, senderId: clientId, body: 'Спасибо!', createdAt: '2026-09-24T11:45:00.000Z', editedAt: null, replyTo: null, image: null }, ...sentMessages], nextCursor: null }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/unread`) {
      body = { unread: { firstMessageId: unreadCount > 0 ? messageId : null, firstCreatedAt: unreadCount > 0 ? '2026-09-24T11:45:00.000Z' : null, unreadCount } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/connection`) {
      body = { state: { activeConnection: true, invitationPending: false, invitedAt: null, canInvite: false, canAccept: false, trainerSwitchRequired: false } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/read` && route.request().method() === 'PUT') {
      unreadCount = 0
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return {
    setClientsFailure(value: boolean) { failClients = value },
    setTrainingDataFailure(value: boolean) { failTrainingData = value },
    setConnectionsFailure(value: boolean) { failConnections = value },
    setProgressFailure(value: boolean) { failProgress = value },
    setProfileFailure(value: boolean) { failProfile = value },
    getProfileSaveAttempts() { return profileSaveAttempts },
    setArchiveFailure(value: boolean) { failArchive = value },
    getCustomExerciseSaveAttempts() { return customExerciseSaveAttempts },
    setWorkspaceFailure(value: boolean) { failWorkspace = value },
    setThreadsFailure(value: boolean) { failThreads = value },
    getSaveAttempts() { return saveAttempts },
    getLastSavedStartTime() { return lastSavedStartTime },
    getLastEditedStartTime() { return lastEditedStartTime },
    getChatSendAttempts() { return chatSendAttempts },
  }
}

test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

function scheduleVisibilityRows(): MockWorkout[] {
  return [
    { ...workout, title: 'Занятие с тренером' },
    { ...workout, id: newWorkoutId, title: 'Самостоятельный план', trainingFormat: 'self' },
    { ...workout, id: '10000000-0000-4000-8000-000000000007', title: 'Самостоятельный без времени', trainingFormat: 'self', startTime: null, endTime: null },
    { ...workout, id: '10000000-0000-4000-8000-000000000008', title: 'Создано спортсменом', clientName: 'Сам клиент', createdBy: clientId, trainingFormat: 'self', status: 'done' },
    { ...workout, id: '10000000-0000-4000-8000-000000000009', title: 'Старое занятие тренера', createdBy: null, startTime: '12:00', endTime: '13:00' },
  ]
}

for (const width of [390, 430, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`Lime schedule ownership calendar list day ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await page.clock.setFixedTime(new Date('2026-09-25T09:00:00+03:00'))
      await page.addInitScript((value) => localStorage.setItem('fit.appTheme', value), theme)
      await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows() })
      await page.goto('/schedule?week=2026-09-21')
      await expect(page.locator('html')).toHaveClass(theme === 'light' ? /theme-light/ : /^(?!.*theme-light)/)
      const toggle = page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })
      await expect(toggle).not.toBeChecked()
      await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(2)
      await expect(page.locator('.schedule-v2-period-summary')).toHaveText('2 тренировки · 1 клиент')
      await expect(page.locator('.schedule-v2-card-grid')).not.toContainText('Сам клиент')
      expect((await toggle.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await toggle.focus()
      await page.keyboard.press('Space')
      await expect(toggle).toBeChecked()
      await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(4)
      await expect(page.locator('.schedule-v2-period-summary')).toHaveText('4 тренировки · 1 клиент')
      await expect(page.locator('.schedule-independent-label')).toHaveCount(2)
      await page.screenshot({ path: info.outputPath('schedule-week.png'), fullPage: true })
      await page.getByRole('button', { name: '2 недели', exact: true }).click()
      await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
      await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(4)
      await page.getByRole('button', { name: 'Список', exact: true }).click()
      await expect(page.locator('.fit-lime-history-row')).toHaveCount(4)
      await expect(page.locator('.fit-lime-history')).not.toContainText('Создано спортсменом')
      await page.getByRole('combobox', { name: 'Фильтр по клиенту' }).selectOption(clientId)
      await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('done')
      await expect(page.getByText('По этим фильтрам тренировок нет.')).toBeVisible()
      await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('all')
      await page.locator('.fit-lime-history h2 button').click()
      await expect(toggle).toBeChecked()
      await expect(page.locator('.schedule-v2-event')).toHaveCount(2)
      const independent = page.getByRole('region', { name: 'Самостоятельные тренировки' })
      await expect(independent.locator('a')).toHaveCount(2)
      await expect(independent).toContainText('10:00–11:00')
      await expect(independent).toContainText('Без времени')
      await page.screenshot({ path: info.outputPath('schedule-day.png'), fullPage: true })
      await page.reload()
      await expect(toggle).toBeChecked()
      await expect(independent.locator('a')).toHaveCount(2)
      await toggle.uncheck()
      await expect(independent).toHaveCount(0)
      await expect(page.locator('.schedule-v2-event')).toHaveCount(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.goto(`/clients/${clientId}/workouts`)
      await expect(page.locator(`a[href="/workouts/10000000-0000-4000-8000-000000000008"]`)).toBeVisible()
      await expect(page.getByText('Создано клиентом', { exact: true })).toBeVisible()
    })
  }
}

test('Lime schedule ownership empty retry preference and account isolation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00+03:00'))
  const backend = await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows().slice(1, 4), failTrainingData: true })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(0)
  await expect(page.locator('.schedule-v2-period-summary')).toHaveText('0 тренировок · 0 клиентов')
  const toggle = page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })
  await toggle.check()
  await page.reload()
  await expect(toggle).toBeChecked()
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(2)
  await mockPilot(page, { profileId: '10000000-0000-4000-8000-000000000010', fitLime: true, workouts: [] })
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows() })
  await page.reload()
  await expect(toggle).toBeChecked()
  await page.goto('/today?date=2026-09-24')
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('region', { name: 'Самостоятельные тренировки' }).locator('a')).toHaveCount(2)
})

test('Lime schedule ownership storage failure is visible and retry keeps selection', async ({ page }) => {
  await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows() })
  await page.goto('/schedule?week=2026-09-21')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem.bind(window.localStorage)
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('fit.lime-schedule-independent.')) throw new Error('storage denied')
      original(key, value)
    }
  })
  const toggle = page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })
  await toggle.check()
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('alert')).toContainText('не удалось сохранить настройку')
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(4)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Lime schedule ownership preserves non-Lime calendar and athlete history', async ({ page }) => {
  const rows = scheduleVisibilityRows()
  await mockPilot(page, { workouts: rows })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })).toHaveCount(0)
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(5)
  await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true, workouts: rows })
  await page.goto('/me/workouts')
  await expect(page.locator('a[href="/workouts/10000000-0000-4000-8000-000000000008"]')).toBeVisible()
  await page.getByRole('button', { name: 'Календарь', exact: true }).click()
  await expect(page.getByRole('button', { name: /24 сентября/ }).first()).toBeVisible()
})

for (const role of ['trainer', 'client'] as const) {
  test(`Yandex history pagination loads only requested pages for ${role}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.install({ time: new Date('2026-09-27T12:00:00Z') })
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...workout, id: `c6000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      workoutDate: `2026-08-${String(25 - index).padStart(2, '0')}`,
      status: 'done', completedAt: '2026-08-25T12:00:00Z',
    }))
    await mockPilot(page, { role, workouts: rows })
    const requests: URL[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/v1/training-data' && url.searchParams.get('limit') === '20') requests.push(url)
    })
    await page.goto(role === 'trainer' ? `/clients/${clientId}/workouts` : '/me/workouts')
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(20)
    const hint = page.getByRole('button', { name: 'Понятно', exact: true })
    if (await hint.isVisible()) await hint.click()
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0'])
    expect(requests[0]?.searchParams.get('clientId')).toBe(clientId)
    await page.screenshot({ path: testInfo.outputPath(`${role}-history-first-page.png`), fullPage: true })
    await page.setViewportSize({ width: 430, height: 932 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(25)
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '20'])
    await expect(page.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0)
    const oldWorkout = rows[24]!
    await page.locator('.workout-chronicle-card').last().getByRole('link', { name: /Открыть тренировку за/ }).click()
    await expect(page).toHaveURL(`/workouts/${oldWorkout.id}`)
    await expect(page.locator('.workout-detail-page')).toBeVisible()
  })
}

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime finance inline errors keep data and allow retry for ${profileId}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: profileId === trainerId ? 320 : 430, height: 844 })
    await mockPilot(page, { profileId, fitLime: true })
    const commands: unknown[] = []
    await page.route(`http://127.0.0.1:4100/v1/clients/${clientId}/finance/packages`, async (route) => {
      const draft = route.request().postDataJSON() as Record<string, unknown>
      commands.push(draft)
      if (commands.length === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ package: {
          ...draft, id: newWorkoutId, clientId, trainerId: profileId, sessionsUsed: 2, sessionsRemaining: 8,
          paidCents: 0, dueCents: 3000000, packageStatus: 'active', paymentStatus: 'unpaid',
          closedAt: null, version: 1, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
        } }) })
      }
    })
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('button', { name: 'Новая', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Стоимость и оплата' })).toBeVisible()
    await expect(page.getByLabel('Уже проведено, занятий', { exact: true })).not.toBeVisible()
    await page.getByLabel('Стоимость, ₽', { exact: true }).fill('30000')
    await page.getByText('Уже проведённые занятия', { exact: true }).click()
    const used = page.getByLabel('Уже проведено, занятий', { exact: true })
    await used.fill('30000')
    await page.getByText('Уже проведённые занятия', { exact: true }).click()
    const save = page.getByRole('button', { name: 'Сохранить', exact: true })
    await save.click()
    await expect(used).toBeFocused()
    await expect(used).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('Проведённых занятий не может быть больше общего количества')
    expect(commands).toHaveLength(0)
    await page.screenshot({ path: testInfo.outputPath('lime-finance-inline-error.png'), fullPage: true })
    await used.fill('2')
    await page.setViewportSize({ width: profileId === trainerId ? 320 : 430, height: 400 })
    await save.scrollIntoViewIfNeeded()
    await save.click()
    await expect.poll(() => commands.length).toBe(1)
    await expect(save).toBeEnabled()
    await expect(page.getByLabel('Стоимость, ₽', { exact: true })).toHaveValue('30000')
    await expect(used).toHaveValue('2')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('lime-finance-retry.png'), fullPage: true })
    await save.click()
    await expect(page.locator('.lime-finance-form')).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
  })
}

for (const fitLime of [false, true]) for (const theme of ['light', 'dark']) for (const width of [320, 390, 430, 1440]) {
  test(`Finance payment lifecycle compact ${fitLime ? 'Lime' : 'Mono'} ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime })
    await page.addInitScript((value) => localStorage.setItem('fit.appTheme', value), theme)
    const ledger: TrainerFinanceClientBundle = { clientId, packages: [], payments: [], sessions: [] }
    const receiptIds: string[] = []
    const updateTotals = () => {
      const service = ledger.packages[0]!
      service.paidCents = ledger.payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + payment.amountCents, 0)
      service.dueCents = Math.max(0, service.priceCents - service.paidCents)
      service.paymentStatus = service.dueCents === 0 ? 'paid' : service.paidCents ? 'partial' : 'unpaid'
    }
    await page.route(`**/v1/clients/${clientId}/finance`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ finance: ledger }) }))
    await page.route(`**/v1/clients/${clientId}/finance/packages`, async (route) => {
      const draft = route.request().postDataJSON() as TrainerFinancePackageDraft
      expect(draft.openingReceivedOn).toBe('2026-08-27')
      expect(draft.requestId).toBeTruthy()
      ledger.packages.push({ ...draft, id: newWorkoutId, clientId, trainerId, sessionsUsed: 0, sessionsRemaining: draft.sessionsTotal, paidCents: draft.openingPaidCents, dueCents: draft.priceCents - draft.openingPaidCents, packageStatus: 'active', paymentStatus: 'partial', closedAt: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' })
      ledger.payments.push({ id: messageId, packageId: newWorkoutId, amountCents: draft.openingPaidCents, receivedOn: draft.openingReceivedOn!, source: 'opening', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' })
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ package: ledger.packages[0] }) })
    })
    await page.route(`**/v1/finance/packages/${newWorkoutId}/payments`, async (route) => {
      const draft = route.request().postDataJSON() as TrainerFinancePaymentDraft
      expect(draft.requestId).toBeTruthy()
      receiptIds.push(draft.requestId!)
      const payment = { ...draft, id: `20000000-0000-4000-8000-${String(receiptIds.length).padStart(12, '0')}`, packageId: newWorkoutId, source: 'manual' as const, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
      ledger.payments.push(payment)
      updateTotals()
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ payment }) })
    })
    await page.route('**/v1/finance/payments/*', async (route) => {
      const payment = ledger.payments.find((item) => item.id === new URL(route.request().url()).pathname.split('/').pop())!
      if (route.request().method() === 'DELETE') payment.voidedAt = '2026-10-07T00:00:00Z'
      else { Object.assign(payment, route.request().postDataJSON()); payment.version += 1 }
      updateTotals()
      await route.fulfill({ status: route.request().method() === 'DELETE' ? 204 : 200, contentType: 'application/json', body: route.request().method() === 'DELETE' ? '' : JSON.stringify({ payment }) })
    })
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('button', { name: 'Новая', exact: true }).click()
    await page.getByLabel('Название', { exact: true }).fill('Персональные тренировки с длинным названием услуги')
    const cost = page.getByLabel('Стоимость, ₽', { exact: true })
    const paid = page.getByLabel('Уже оплачено, ₽', { exact: true })
    await cost.fill('30000')
    await page.getByRole('button', { name: 'Вся сумма', exact: true }).click()
    await expect(paid).toHaveValue('30000')
    await paid.fill('10000')
    await page.getByLabel('Дата получения', { exact: true }).fill('2026-08-27')
    await page.getByLabel('Начало', { exact: true }).fill('2026-09-01')
    const boxes = await Promise.all([cost.boundingBox(), paid.boundingBox()])
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1)
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x)
    await page.screenshot({ path: testInfo.outputPath('new-service.png'), fullPage: true })
    const save = page.getByRole('button', { name: 'Сохранить', exact: true })
    await page.setViewportSize({ width, height: 400 })
    await page.getByLabel('Комментарий', { exact: true }).focus()
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
    const saveBox = await save.boundingBox()
    const cancelBox = await page.getByRole('button', { name: 'Отмена', exact: true }).boundingBox()
    expect(Math.abs(saveBox!.y - cancelBox!.y)).toBeLessThanOrEqual(1)
    expect(saveBox!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await save.click()
    await page.setViewportSize({ width, height: 844 })
    const card = page.locator('.finance-package').first()
    const facts = card.locator('.finance-service-money')
    await expect(facts).toContainText(/10\s000/)
    await expect(facts).toContainText(/20\s000/)
    await page.screenshot({ path: testInfo.outputPath('service-paid-due.png'), fullPage: true })
    await card.getByRole('button', { name: 'Внести оплату', exact: true }).click()
    await expect(page.getByLabel('Сумма, ₽', { exact: true })).toHaveValue('20000')
    await page.getByLabel('Сумма, ₽', { exact: true }).fill('5000')
    await save.click()
    await expect(facts).toContainText(/15\s000/)
    await card.locator('.finance-service-payments > summary').click()
    const partial = card.locator('.finance-payment').filter({ hasText: /5\s000/ })
    await partial.getByRole('button', { name: /Действия с оплатой/ }).click()
    await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click()
    await expect(page.getByLabel('Сумма, ₽', { exact: true })).toHaveValue('5000')
    await page.getByLabel('Сумма, ₽', { exact: true }).fill('3000')
    await save.click()
    await expect(facts).toContainText(/17\s000/)
    await card.locator('.finance-service-payments > summary').click()
    const edited = card.locator('.finance-payment').filter({ hasText: /3\s000/ })
    await edited.getByRole('button', { name: /Действия с оплатой/ }).click()
    await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText(/3\s000/)
    await expect(dialog).toContainText('от ')
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(ledger.payments[1]!.voidedAt).toBeNull()
    await edited.getByRole('button', { name: /Действия с оплатой/ }).click()
    await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(facts).toContainText(/20\s000/)
    await card.getByRole('button', { name: 'Внести оплату', exact: true }).click()
    await expect(page.getByLabel('Сумма, ₽', { exact: true })).toHaveValue('20000')
    await save.click()
    await expect(card).toContainText('Оплачен')
    await expect(facts.locator('p').last()).toContainText('0')
    expect(new Set(receiptIds).size).toBe(2)
    await card.locator('.finance-service-payments > summary').click()
    await expect(card.locator('.finance-payment')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('payments-expanded.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('tab', { name: 'Оплаты: 2', exact: true }).click()
    await expect(page.locator('.finance-payment-ledger .finance-payment')).toHaveCount(2)
    await page.reload()
    await expect(page.locator('.finance-service-money')).toContainText(/30\s000/)
  })
}

for (const fitLime of [true, false]) {
  test(`calorie basis stays readable and pilot scoped: ${fitLime}`, async ({ page }) => {
    await mockPilot(page, { fitLime, workouts: [{ ...workout, status: 'done', activeCaloriesKcal: 220, calorieEstimateBasis: 'Оценка по времени и фактической нагрузке' }] })
    await page.goto(`/workouts/${workoutId}`)
    await expect(page.getByRole('region', { name: 'Сводка тренировки' })).toContainText('220 ккал')
    await expect(page.locator('.workout-calorie-explanation')).toHaveCount(fitLime ? 1 : 0)
    if (!fitLime) await expect(page.getByRole('region', { name: 'Сводка тренировки' })).toContainText('Оценка по времени и фактической нагрузке')
  })
}

for (const width of [320, 390, 430, 1440]) {
  test(`Lime filled calendar audit with the production seed recipe at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-10-03T12:00:00+03:00'))
    const profileId = width === 430 ? '10000000-0000-4000-8000-000000000010' : trainerId
    const plan = buildFitLimeCalendarPlan(profileId, '2026-09-28', '2026-10-03')
    await mockPilot(page, { profileId, fitLime: true,
      clientRecords: plan.clients.map((item) => ({ ...item, archivedAt: null, version: 1 })),
      workouts: plan.workouts.map((item) => ({ ...workout, ...item, trainerId: profileId, createdBy: profileId,
        clientName: plan.clients.find((client) => client.id === item.clientId)!.fullName,
        completedAt: item.status === 'done' ? `${item.workoutDate}T12:00:00Z` : null,
      })),
    })
    await page.goto('/schedule?week=2026-09-28')
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    for (const select of await page.locator('.fit-lime-schedule-filters select').all()) {
      const size = await select.boundingBox()
      expect(size!.height).toBeGreaterThanOrEqual(44)
      expect(await select.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    }
    const shell = await page.locator('.phone-frame').boundingBox()
    const fab = await page.locator('.schedule-v2-fab').boundingBox()
    expect(fab!.x).toBeGreaterThanOrEqual(shell!.x)
    expect(fab!.x + fab!.width).toBeLessThanOrEqual(shell!.x + shell!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('filled-week.png'), fullPage: true })
    await page.getByRole('button', { name: 'Список', exact: true }).click()
    const list = page.getByRole('region', { name: 'Список тренировок' })
    await expect(list.getByRole('link')).toHaveCount(60)
    await page.getByRole('combobox', { name: 'Фильтр по клиенту' }).selectOption(plan.clients[12]!.id)
    await expect(list.getByRole('link')).toHaveCount(4)
    await expect(list.getByRole('link').first()).toContainText('Константинопольская-Рождественская')
    await page.screenshot({ path: testInfo.outputPath('filled-history-long-name.png'), fullPage: true })
    const lastRow = list.getByRole('link').last()
    await lastRow.scrollIntoViewIfNeeded()
    await expect(lastRow).toBeInViewport()
    const lastBox = await lastRow.boundingBox()
    const navBox = await page.locator('.trainer-tab-bar').boundingBox()
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(navBox!.y)
    await page.goto('/today?date=2026-09-30&week=2026-09-28')
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await expect(page.locator('.schedule-v2-event').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('filled-dense-day.png'), fullPage: true })
    await page.locator('.schedule-v2-fab').click()
    await expect(page.getByRole('button', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('filled-calendar-entry.png') })
  })
}

for (const width of [320, 390, 430, 1440]) {
  test(`Lime compact result keeps calorie explanation outside metrics at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const notice = 'Недостаточно фактических данных для оценки. Укажите время выполнения кардио, чтобы рассчитать активные калории.'
    await mockPilot(page, { fitLime: true, workouts: [{ ...workout, status: 'done', calorieEstimateNotice: notice }] })
    await page.goto(`/workouts/${workoutId}`)
    const metrics = page.getByRole('region', { name: 'Сводка тренировки' })
    await expect(metrics).not.toContainText(notice)
    await expect(page.locator('.workout-calorie-explanation')).toContainText(notice)
    expect((await metrics.boundingBox())!.height).toBeLessThan(180)
    await expect(page.getByRole('region', { name: 'Отзыв тренера' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Изменить результат' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('lime-compact-result.png'), fullPage: true })
  })

  test(`Lime save editor supports enlarged text and reduced viewport at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true })
    await page.addInitScript(({ actor, client, plan }) => {
      localStorage.setItem(`fit.today-draft.${actor}.plan.${plan}`, JSON.stringify({
        requestId: plan, screen: 'save', text: 'Приседания 3 по 10', choices: {},
        items: [{ line: 'Приседания', exercise: { ref: 'squat', name: 'Приседания', inputKind: 'reps' }, sets: [{ position: 0, reps: 10 }], hasValues: true }],
        clientId: client, workoutDate: '2026-09-24', recordMode: 'planned', trainingFormat: 'with_trainer',
      }))
    }, { actor: trainerId, client: clientId, plan: newWorkoutId })
    await page.goto(`/today?view=save&plan=${newWorkoutId}`)
    await expect(page.getByRole('heading', { name: 'Сохраните план' })).toBeVisible()
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
    await page.setViewportSize({ width, height: 400 })
    const field = page.getByLabel('Время тренировки', { exact: true })
    await field.fill('15:30')
    await expect(field).toHaveValue('15:30')
    await expect(field).toHaveCSS('font-family', /YS Geo/)
    const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('lime-editor-enlarged.png'), fullPage: true })
  })
}

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime notification settings separate permission, device connection and retry for ${profileId}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockPilot(page, { profileId, fitLime: true })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
      Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
      Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true })
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        getRegistration: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://push.example/device', toJSON: () => ({ keys: { p256dh: 'public-test', auth: 'test-auth' } }) }) } }),
        addEventListener() {}, removeEventListener() {},
      } })
    })
    let fail = false
    let endpointChecks = 0
    await page.route('http://127.0.0.1:4100/v1/push-notifications/**', async (route) => {
      if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/subscription/status')) {
        endpointChecks += 1
        expect(route.request().postDataJSON()).toEqual({ endpoint: 'https://push.example/device' })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.endsWith('/subscription/status') ? { subscribed: true } : { status: { subscribed: true, preferences: { workout_reminder: false, workout_scheduled: true, chat_message: true } } }) })
    })
    await page.goto('/profile/settings')
    await expect(page.getByText('Fit открыт как приложение', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Как установить Fit' })).toHaveCount(0)
    await expect(page.getByText('Разрешено', { exact: true })).toBeVisible()
    await expect(page.getByText('Уведомления включены', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Включить', exact: true })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Напоминать о незавершённой тренировке' })).not.toBeChecked()
    expect(endpointChecks).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('lime-notification-settings.png'), fullPage: true })
    fail = true
    await page.getByRole('button', { name: 'Повторить проверку' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'подписку устройства' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('switch', { name: 'Новые сообщения' })).toBeDisabled()
    fail = false
    await page.getByRole('button', { name: 'Повторить проверку' }).click()
    await expect(page.getByText('Уведомления включены', { exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Новые сообщения' })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [390, 430, 1440]) {
  test(`Lime history preserves completed, untimed and filtered calendar context at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const otherClient = '10000000-0000-4000-8000-000000000099'
    const profileId = width === 430 ? '10000000-0000-4000-8000-000000000010' : trainerId
    await mockPilot(page, { fitLime: true, profileId, workouts: [
      { ...workout, status: 'done', completedAt: '2026-09-24T08:00:00.000Z', title: 'Силовая' },
      { ...workout, id: newWorkoutId, clientId: otherClient, clientName: 'Александра Константинопольская-Рождественская', status: 'done', workoutDate: '2026-08-01', startTime: null, endTime: null, completedAt: '2026-08-01T08:00:00.000Z' },
      { ...workout, id: '10000000-0000-4000-8000-000000000080', status: 'cancelled' },
      { ...workout, id: '10000000-0000-4000-8000-000000000081', workoutDate: '2026-10-10' },
    ].map((item) => ({ ...item, trainerId: profileId, createdBy: profileId })) })
    await page.goto('/schedule?week=2026-09-21')
    await page.getByRole('button', { name: 'Список', exact: true }).click()
    const list = page.getByRole('region', { name: 'Список тренировок' })
    await expect(list.getByRole('link')).toHaveCount(4)
    await expect(list.getByText('Без времени', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('done')
    await expect(list.getByRole('link')).toHaveCount(2)
    await expect(list.getByText('Проведена', { exact: true })).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('lime-history.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('combobox', { name: 'Фильтр по клиенту' }).selectOption(clientId)
    await expect(list.getByRole('link')).toHaveCount(1)
    await list.getByRole('button', { name: '24 сентября 2026 г.' }).click()
    await expect(page).toHaveURL(/date=2026-09-24/)
    await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
    await page.goBack()
    await expect(list.getByRole('link')).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Фильтр по клиенту' })).toHaveValue(clientId)
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('in_progress')
    await expect(page.getByText('По этим фильтрам тренировок нет.')).toBeVisible()
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('cancelled')
    await expect(list.getByRole('link')).toHaveCount(1)
    await expect(list.getByText('Отменена', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Календарь', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
  })
}

test('Lime direct start opens Live immediately after choosing the client', async ({ page }) => {
  await mockPilot(page, { fitLime: true, workouts: [] })
  const commands: unknown[] = []
  page.on('request', (request) => { if (request.url().endsWith('/workouts/quick-start')) commands.push(request.postDataJSON() as unknown) })
  await page.goto('/today?date=2026-12-31')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}/live$`))
  await expect(page.locator('.live-workout-page')).toBeVisible()
  expect(commands).toHaveLength(1)
  expect(commands[0]).toMatchObject({ clientId, trainingFormat: 'with_trainer' })
})

test('Lime trainer adds a template directly to a client plan', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page, { fitLime: true, workouts: [] })
  const templateName = 'Силовая тренировка на всё тело с длинным названием'
  await page.route('http://127.0.0.1:4100/v1/workout-templates', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ templates: [{
      id: '10000000-0000-4000-8000-000000000080', trainerId, name: templateName,
      notes: 'Держать спокойный темп', version: 1,
      createdAt: '2026-10-06T08:00:00.000Z', updatedAt: '2026-10-06T08:00:00.000Z',
      exercises: [{ source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration',
        position: 0, blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockRounds: 1,
        sets: [{ position: 0, durationSec: 45 }] }],
    }] }),
  }))
  const writes: Array<Record<string, unknown>> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/workouts') writes.push(request.postDataJSON() as Record<string, unknown>)
  })
  await page.goto(`/workouts/new?client=${clientId}&date=2026-10-07`)
  await expect(page.locator('.fit-lime-shell')).toBeVisible()
  await page.getByRole('button', { name: 'Добавить шаблон' }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить шаблон тренировки' })
  await expect(picker).toContainText(templateName)
  await page.screenshot({ path: testInfo.outputPath('lime-template-picker-390.png'), fullPage: true, animations: 'disabled' })
  await picker.locator('.workout-template-picker-item').click()
  await expect(page.getByText(`Добавлен шаблон «${templateName}»`)).toBeVisible()
  await expect(page.locator('.workout-notes')).toHaveAttribute('open', '')
  await expect(page.getByLabel('Заметка')).toHaveValue('Держать спокойный темп')
  await expect(page.getByLabel('Дата')).toHaveValue('2026-10-07')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ clientId, workoutDate: '2026-10-07', notes: 'Держать спокойный темп', exercises: [{ ref: 'plank' }] })
})

for (const width of [390, 430, 1440]) {
  test(`Lime window typography and client step stay bounded at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true, clientRecords: [{ id: clientId, fullName: 'Александра Константинопольская-Рождественская', archivedAt: null, version: 1 }] })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await page.evaluate(() => document.fonts.ready)
    await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveCSS('font-size', '16px')
    await expect(plan.getByRole('button', { name: 'Надиктовать тренировку' })).toHaveCSS('font-size', '14px')
    expect(await plan.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('YS Geo')
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    await expect(picker).toBeFocused()
    await expect(plan.getByRole('button', { name: 'Сохранить план' })).not.toBeVisible()
    const box = await picker.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(12)
    expect(box!.width).toBeLessThanOrEqual(375)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.keyboard.press('Shift+Tab')
    expect(await picker.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(plan.getByRole('button', { name: 'Сохранить план' })).toBeVisible()
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('button', { name: /Александра Константинопольская/ }).click()
    expect(await plan.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('lime-window-type.png') })
  })
}

test('Lime retained plan offers old date and preserves it when starting a new plan', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  const key = `fit.workout-form-draft.${trainerId}.new--2026-09-24--quick`
  await page.evaluate(({ key, clientId }) => localStorage.setItem(key, JSON.stringify({ clientId, workoutDate: '2026-10-05', title: 'Старый план', requestId: 'retained-plan', startTime: '13:30', endTime: '', notes: '', stageId: '', recordCompleted: false, exercises: [] })), { key, clientId })
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const choice = page.getByRole('dialog', { name: 'Черновик плана' })
  await expect(choice).toContainText('5 октября')
  await expect(choice).toContainText('Алексей Смирнов')
  await page.screenshot({ path: testInfo.outputPath('lime-retained-plan.png') })
  await choice.getByRole('button', { name: 'Создать новый план' }).click()
  const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
  await expect(plan.getByRole('button', { name: 'Выбрать дату и время' })).toContainText('24 сентября')
  await expect(plan).toContainText('Без времени')
  await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('')
  await plan.getByRole('button', { name: 'Самостоятельно', exact: true }).click()
  await plan.getByRole('textbox', { name: 'Название тренировки' }).fill('Новый план')
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(`${key}.saved.retained-plan`)!) as { title: string }, key)).toMatchObject({ title: 'Старый план' })
  await plan.getByRole('button', { name: 'Закрыть создание' }).click()
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await expect(choice.getByRole('button', { name: 'Продолжить черновик' })).toHaveCount(2)
  await choice.getByRole('button', { name: 'Продолжить черновик' }).first().click()
  await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Новый план')
  await expect(plan.getByRole('button', { name: 'Самостоятельно', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const method of ['text', 'voice', 'manual'] as const) {
  test(`Lime plan saves and returns to its filtered calendar via ${method}`, async ({ page }, testInfo) => {
    const backend = await mockPilot(page, { fitLime: true, withCustomExercise: true, failFirstSave: true })
    const commands: unknown[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/workouts') commands.push(request.postDataJSON() as unknown)
    })
    const calendar = `/today?date=2026-09-24&week=2026-09-21&client=${clientId}&status=planned`
    await page.goto(calendar)
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    await page.getByRole('textbox', { name: 'Название тренировки' }).fill('Сохранённый план')
    await page.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    if (method === 'manual') {
      await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
      await expect(page.getByRole('group', { name: 'Тип тренировки' })).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: method === 'voice' ? 'Надиктовать тренировку' : 'Ввести текстом', exact: true }).click()
      if (method === 'voice') await page.getByRole('button', { name: 'Ввести текстом', exact: true }).click()
      await page.getByRole('textbox', { name: 'Тренировка', exact: true }).fill('Мой присед 3 по 10 по 20 кг')
      await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
      await page.getByRole('button', { name: 'Далее', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Сохраните план' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Записать выполненную' })).toHaveCount(0)
      await expect(page.locator('.today-plan-summary')).toContainText('Алексей Смирнов')
      await expect(page.locator('.today-plan-summary')).toContainText('Без времени')
    }
    const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
    await page.screenshot({ path: testInfo.outputPath(`lime-plan-${method}-before-save.png`), fullPage: true })
    await save.click()
    await expect.poll(() => backend.getSaveAttempts()).toBe(1)
    await expect(save).toBeEnabled()
    await page.reload()
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page).toHaveURL(new RegExp(calendar.replaceAll('?', '\\?')))
    await expect(page.getByRole('status').filter({ hasText: 'План сохранён' })).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await page.screenshot({ path: testInfo.outputPath(`lime-plan-${method}-saved.png`), fullPage: true })
    await page.getByRole('link', { name: 'Открыть', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}$`))
  })
}

test('Lime keeps unparsed plan text when returning before choosing a client', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByRole('textbox', { name: 'Тренировка', exact: true }).fill('Планка три раза по минуте')
  await page.getByRole('button', { name: '← В календарь' }).click()
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик' }).click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByRole('textbox', { name: 'Тренировка', exact: true })).toHaveValue('Планка три раза по минуте')
})

test('Lime plan rejects an end time without start before any save command', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await page.getByRole('button', { name: 'Выбрать дату и время' }).click()
  await page.getByLabel('Окончание', { exact: true }).fill('15:00')
  await page.getByRole('button', { name: 'Применить дату' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('alert')).toContainText('Укажите начало тренировки')
  expect(backend.getSaveAttempts()).toBe(0)
  await page.getByRole('button', { name: 'Выбрать дату и время' }).click()
  await page.getByLabel('Начало', { exact: true }).fill('14:00')
  await page.getByRole('button', { name: 'Применить дату' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('dialog', { name: 'Быстрое создание тренировки' })).toHaveCount(0)
  expect(backend.getSaveAttempts()).toBe(1)
})

test('Lime plan keeps actions reachable with enlarged text on a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
  // Model enlarged text independently of device scale; not a physical OS setting.
  await plan.evaluate((element) => {
    const text = Array.from(element.querySelectorAll<HTMLElement>('h2, input, button, p, button span'))
      .map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }))
    for (const { node, size } of text) { node.style.fontSize = `${size * 1.3}px`; node.style.lineHeight = '1.3' }
  })
  await page.screenshot({ path: testInfo.outputPath('lime-enlarged-text-before-scroll.png') })
  expect(await plan.evaluate((element) => Array.from(element.querySelectorAll('*')).filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1).map((child) => child.className))).toEqual([])
  expect(await plan.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await plan.getByRole('button', { name: 'Сохранить план' }).scrollIntoViewIfNeeded()
  await expect(plan.getByRole('button', { name: 'Сохранить план' })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('lime-enlarged-text.png') })
  await plan.getByRole('button', { name: 'Закрыть создание' }).click()
  await expect(plan).toHaveCount(0)
})

test('Lime start now retries one command without using the selected future date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  const commands: unknown[] = []
  await page.route('**/v1/workouts/quick-start', async (route) => {
    commands.push(route.request().postDataJSON() as unknown)
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
  })
  await page.goto('/today?date=2026-12-31')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас' }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Запланировать', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Не удалось начать тренировку')
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(() => commands.length).toBe(2)
  expect(commands[1]).toEqual(commands[0])
  expect(commands[0]).toMatchObject({ clientId, trainingFormat: 'with_trainer', operationId: expect.any(String) })
  expect(commands[0]).not.toHaveProperty('workoutDate')
  await page.getByRole('button', { name: 'Закрыть выбор действия' }).click()
  await expect(page).toHaveURL(/date=2026-12-31/)
})

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime plus resumes live without writing and preserves plan input for ${profileId}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout, status: 'in_progress' }] })
    const mutations: string[] = []
    page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/workouts')) mutations.push(request.url()) })
    await page.goto('/today?date=2026-09-29')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    const choice = page.getByRole('dialog', { name: 'Новая тренировка', exact: true })
    await expect(choice.getByRole('button', { name: 'Начать сейчас' })).toBeVisible()
    await expect(choice.getByRole('button', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-entry-choice.png') })
    await choice.getByRole('button', { name: 'Начать сейчас' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
    expect(mutations).toHaveLength(0)
    await page.goto('/today?date=2026-09-29')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await plan.getByRole('textbox', { name: 'Название тренировки' }).fill('Сила и баланс')
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    const sourceKey = `fit.workout-form-draft.${profileId}.new--2026-09-29--quick`
    const source = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as { requestId: string }, sourceKey)
    const legacyKey = `fit.today-draft.${profileId}`
    const legacyDraft = { screen: 'compose', text: 'Прежняя диктовка', choices: {}, items: [], clientId: 'old-client', workoutDate: '2026-10-06', trainingFormat: 'self' }
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: legacyKey, draft: legacyDraft })
    await plan.getByRole('button', { name: 'Ввести текстом' }).click()
    await expect(page).toHaveURL(/view=compose&entry=text&date=2026-09-29/)
    const voiceKey = `${legacyKey}.plan.${source.requestId}`
    await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as unknown, voiceKey)).toMatchObject({ workoutDate: '2026-09-29', clientId, title: 'Сила и баланс', requestId: source.requestId, sourceFormDraftKey: sourceKey, trainingFormat: 'with_trainer', text: '' })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Выбрать упражнения вручную' })).toBeVisible()
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as unknown, legacyKey)).toEqual(legacyDraft)
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as unknown, voiceKey)).toMatchObject({ workoutDate: '2026-09-29', clientId, trainingFormat: 'with_trainer' })
    // A real editor step must keep the plan identity through review, save and back.
    await page.evaluate((key) => {
      const draft = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>
      draft.items = [{ line: 'Приседания', exercise: { ref: 'squat', name: 'Приседания', inputKind: 'reps' }, sets: [{ position: 0, reps: 8 }], hasValues: true }]
      draft.screen = 'review'
      localStorage.setItem(key, JSON.stringify(draft))
    }, voiceKey)
    await page.goto(`/today?view=review&plan=${source.requestId}`)
    await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
    await page.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`view=save&plan=${source.requestId}$`))
    await page.reload()
    await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as unknown, sourceKey)).toMatchObject({ workoutDate: '2026-09-29', clientId, title: 'Сила и баланс', exercises: [{ name: 'Приседания', sets: [{ reps: 8 }] }] })
    await expect(page.getByRole('button', { name: 'Для кого тренировка: Алексей Смирнов' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-isolated-plan-save.png'), fullPage: true })
    await page.getByRole('button', { name: '← К проверке' }).click()
    await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
    expect(mutations).toHaveLength(0)
  })
  test(`Lime day removes duplicate blocks but keeps live and draft access for ${profileId}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout, status: 'in_progress', workoutDate: '2026-09-26' }] })
    await page.addInitScript((id) => localStorage.setItem(`fit.today-draft.${id}`, JSON.stringify({ screen: 'compose', text: 'Приседания 3 по 10', choices: {}, items: [], clientId: '' })), profileId)
    await page.goto('/today?date=2026-09-26')
    await expect(page.getByRole('link', { name: 'День', exact: true })).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Установка и уведомления' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '2 Незавершённые действия', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '2 Незавершённые действия', exact: true }).click()
    const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
    await expect(queue.getByRole('link', { name: /Тренировка идёт/ })).toHaveAttribute('href', `/workouts/${workoutId}/live`)
    await expect(queue.getByRole('link', { name: /Черновик тренировки/ })).toHaveAttribute('href', '/today?view=compose')
    await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
    await expect(page).toHaveURL(/date=2026-09-27/)
    await expect(page.getByText('На этот день тренировок нет')).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('lime-clean-day.png'), fullPage: true })
    await page.evaluate((id) => {
      const key = `fit.coachmarks-seen.${id}`
      const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      localStorage.setItem(key, JSON.stringify(seen.filter((item) => item !== 'lime-day-workspace-2026-10')))
    }, profileId)
    await page.getByRole('link', { name: 'Расписание', exact: true }).click()
    await page.getByRole('link', { name: 'День', exact: true }).click()
    const guidance = page.getByRole('status').filter({ hasText: 'Все дела — в календаре' })
    await expect(guidance).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-day-guidance.png'), fullPage: true })
    await guidance.getByRole('button', { name: 'Понятно' }).click()
    await expect(guidance).not.toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '2 Незавершённые действия', exact: true })).toBeVisible()
  })
}

for (const width of [390, 430]) {
  test(`client Lime assistant input stays above iOS keyboard at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      Object.defineProperties(viewport, {
        height: { get: () => Number(document.documentElement.dataset.testVisibleHeight ?? window.innerHeight) },
        offsetTop: { get: () => 0 },
      })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    })
    await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true })
    await page.goto('/assistant')
    const composer = page.getByRole('textbox', { name: 'Сообщение ассистенту' })
    await expect(composer).toBeVisible()
    await composer.fill('Гири и резинка')
    await page.evaluate(() => {
      document.documentElement.dataset.testVisibleHeight = '400'
      window.visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('.phone-frame')).toHaveClass(/keyboard-open/)
    await expect(page.locator('.client-tab-bar')).toBeHidden()
    await expect.poll(async () => {
      const box = await composer.boundingBox()
      return box ? box.y + box.height : 1000
    }).toBeLessThanOrEqual(400)
    await page.screenshot({ path: testInfo.outputPath('client-assistant-keyboard.png') })
    await composer.blur()
    await page.evaluate(() => {
      delete document.documentElement.dataset.testVisibleHeight
      window.visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('.client-tab-bar')).toBeVisible()
  })

  test(`Lime keyboard visual viewport keeps composer above keyboard at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    // Model Safari's separate layout/visual viewports, not a physical OS keyboard.
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      Object.defineProperties(viewport, {
        height: { get: () => Number(document.documentElement.dataset.testVisibleHeight ?? window.innerHeight) },
        offsetTop: { get: () => Number(document.documentElement.dataset.testViewportTop ?? 0) },
      })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    const trigger = page.getByRole('button', { name: 'Новая тренировка', exact: true })
    await trigger.click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    const input = dialog.getByRole('textbox', { name: 'Название тренировки' })
    await expect(input).not.toBeFocused()
    await input.fill('Тренировка над клавиатурой')
    for (const offset of [0, 24]) {
      await page.evaluate((top) => {
        document.documentElement.dataset.testVisibleHeight = '400'
        document.documentElement.dataset.testViewportTop = String(top)
        window.visualViewport?.dispatchEvent(new Event('resize'))
      }, offset)
      await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return box ? box.y + box.height : 1000
      }).toBeLessThanOrEqual(400 + offset)
      const box = await dialog.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(offset)
      await expect(dialog).toHaveCSS('transform', 'none')
    }
    await page.screenshot({ path: testInfo.outputPath('lime-keyboard-visible-form.png') })
    await dialog.getByRole('button', { name: 'Закрыть создание' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeVisible()
    await page.evaluate(() => {
      delete document.documentElement.dataset.testVisibleHeight
      delete document.documentElement.dataset.testViewportTop
      window.visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/)
  })

  test(`Figma long client name and constrained-height picker at ${width}`, async ({ page }, testInfo) => {
    const fullName = 'Александр Константинопольский-Рождественский'
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true, clientRecords: [{ id: clientId, fullName, archivedAt: null, version: 1 }] })
    await page.goto('/workouts/new?date=2026-09-24')
    await page.locator('.client-picker-trigger').click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    const search = picker.getByRole('textbox', { name: 'Поиск клиента' })
    await search.focus()
    // Model reduced available space; this is not a claim to emulate an OS keyboard.
    await page.setViewportSize({ width, height: 400 })
    await search.fill('Константинопольский')
    await expect(search).toBeFocused()
    const option = picker.getByRole('button', { name: new RegExp(fullName) })
    await option.scrollIntoViewIfNeeded()
    await expect(option).toBeVisible()
    const bounds = await option.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400)
    await page.screenshot({ path: testInfo.outputPath('figma-picker-constrained-height.png') })
    await option.click()
    await expect(picker).not.toBeVisible()
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.client-picker-trigger')).toContainText(fullName)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
test('Figma workout second pilot keeps quick-plan guidance and separate completed entry', async ({ page }) => {
  const profileId = '10000000-0000-4000-8000-000000000010'
  await mockPilot(page, { profileId, fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.evaluate((id) => {
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify(seen.filter((item) => item !== 'lime-quick-plan-2026-10')))
  }, profileId)
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const guidance = page.getByRole('status').filter({ hasText: 'План можно сохранить сразу' })
  await expect(guidance).toBeVisible()
  await guidance.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('textbox', { name: 'Название тренировки' }).fill('Силовая')
  await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Силовая')
  await page.goto('/workouts/new?date=2026-09-24')
  await page.getByRole('button', { name: 'Завершённая', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Записать тренировку', exact: true })).toBeDisabled()
})

for (const width of [390, 430, 1440]) {
  test(`Figma quick start preserves the finance format choice at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    const fullName = 'Александр Константинопольский-Рождественский'
    await mockPilot(page, { fitLime: true, workouts: [], clientRecords: [{ id: clientId, fullName, archivedAt: null, version: 1 }] })
    await page.goto(`/clients/${clientId}`)
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    const format = page.locator('.quick-start-format')
    await expect(page.getByRole('heading', { name: fullName, exact: true })).toBeVisible()
    await expect(format).toContainText('Формат тренировки')
    await expect(format.getByRole('button', { name: 'С тренером', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await format.getByRole('button', { name: 'Самостоятельно', exact: true }).click()
    await expect(format.getByRole('button', { name: 'Самостоятельно', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const start = format.getByRole('button', { name: 'Начать', exact: true })
    await expect(start).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await start.scrollIntoViewIfNeeded()
    for (const button of await format.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('figma-quick-start-format.png') })
    await format.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(format).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeVisible()
  })

  for (const { name, route, checkLegacy } of [
    { name: 'finance', route: '/finance', checkLegacy: true },
    { name: 'client finance', route: `/clients/${clientId}/finance`, checkLegacy: true },
    { name: 'templates', route: '/schedule/templates', checkLegacy: true },
    { name: 'template editor', route: '/schedule/templates/new/editor', checkLegacy: true },
    { name: 'profile', route: '/profile', checkLegacy: false },
    { name: 'clients', route: '/clients', checkLegacy: false },
    { name: 'chat', route: '/chat', checkLegacy: false },
    { name: 'assistant', route: '/assistant', checkLegacy: false },
  ]) {
    test(`Figma trainer routes include ${name} at ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await mockPilot(page, { fitLime: true })
      await page.goto(route)
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`routes-${route.replace(/[^a-z]+/g, '-')}.png`) })
      if (checkLegacy) {
        await mockPilot(page, { fitLime: false })
        await page.goto(route)
        await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
        await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
        await expect(page.locator('[data-original-icon]')).toHaveCount(0)
      }
    })
  }
  test(`Figma workout quick empty plan at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true, workouts: [], failFirstSave: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const composer = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await expect(composer).toBeVisible()
    await composer.getByRole('textbox', { name: 'Название тренировки' }).fill('Всё тело')
    await composer.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    await composer.getByRole('button', { name: 'Выбрать дату и время' }).click()
    const dates = page.getByRole('dialog', { name: 'Дата и время' })
    await dates.getByLabel('Начало', { exact: true }).fill('12:00')
    await dates.getByRole('button', { name: 'Применить дату' }).click()
    await expect(composer.locator('.fit-lime-plan-exercises svg')).toHaveCSS('width', '24px')
    await expect(composer.locator('.fit-lime-plan-exercises svg')).toHaveCSS('height', '24px')
    const composerBox = await composer.boundingBox()
    expect(composerBox!.height).toBeLessThanOrEqual(876)
    await expect(composer.getByRole('button', { name: 'Сохранить план' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('figma-quick-plan.png') })
    const sent: Array<{ title?: string; requestId: string; exercises: unknown[] }> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/workouts') sent.push(request.postDataJSON() as typeof sent[number])
    })
    await composer.getByRole('button', { name: 'Сохранить план' }).click()
    await expect(composer.getByRole('alert')).toBeVisible()
    await expect(composer.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Всё тело')
    await composer.getByRole('button', { name: 'Сохранить план' }).click()
    await expect(composer).not.toBeVisible()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ title: 'Всё тело', exercises: [] })
    expect(sent[1]?.requestId).toBe(sent[0]?.requestId)
    await expect(page.locator('.schedule-v2-event')).toContainText('Всё тело')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })

  test(`Figma workout quick draft survives editor handoff at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    await page.getByRole('textbox', { name: 'Название тренировки' }).fill('План с очень длинным названием для проверки переноса')
    await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
    await expect(page).toHaveURL(/workouts\/new\?date=2026-09-24/)
    await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('План с очень длинным названием для проверки переноса')
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('План с очень длинным названием для проверки переноса')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/today\?date=2026-09-24/)
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    await page.getByRole('button', { name: 'Продолжить черновик' }).click()
    await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('План с очень длинным названием для проверки переноса')
  })

  test(`Figma workout editor and client picker at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/workouts/new?date=2026-09-24')
    await expect(page.locator('.workout-form-page')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.workout-header-contract h2')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.workout-header-contract h2')).toHaveCSS('font-weight', '500')
    await expect(page.locator('.workout-composer-card')).toHaveCSS('border-radius', '32px')
    await page.screenshot({ path: testInfo.outputPath('figma-workout-editor.png'), fullPage: true })
    await page.locator('.client-picker-trigger').click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    await expect(picker).toBeVisible()
    await expect(picker).toHaveCSS('border-top-left-radius', '40px')
    await expect(picker.locator('.client-picker-avatar').first()).toHaveCSS('width', '40px')
    await picker.getByRole('textbox', { name: 'Поиск клиента' }).fill('Алексей')
    await page.screenshot({ path: testInfo.outputPath('figma-workout-client-picker.png') })
    await picker.getByRole('button', { name: /Алексей Смирнов/ }).click()
    await expect(picker).not.toBeVisible()
    await expect(page.locator('.client-picker-trigger')).toContainText('Алексей Смирнов')
    await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
  test(`Figma calendar month chooser applies and cancels at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Выбрать дату', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Выбрать дату' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.fit-lime-date-selected')).toHaveCSS('font-size', '14px')
    await dialog.getByRole('button', { name: '30 сентября 2026 г.', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(/date=2026-09-24/)
    await expect(page.getByRole('button', { name: 'Выбрать дату', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Выбрать дату', exact: true }).click()
    await dialog.getByRole('button', { name: 'Следующий месяц' }).click()
    await dialog.getByRole('button', { name: '2 октября 2026 г.', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-month.png') })
    await dialog.getByRole('button', { name: 'Применить дату' }).click()
    await expect(page).toHaveURL(/date=2026-10-02/)
    await expect(dialog).not.toBeVisible()
  })
  test(`Figma calendar geometry and event states at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { fitLime: true })
    const ready = async () => page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.querySelectorAll('svg image')].map(async (node) => {
        const image = new Image()
        image.src = node.getAttribute('href')!
        await image.decode()
      }))
    })
    await page.goto('/today?date=2026-09-24')
    await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).not.toHaveClass(/is-active/)
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toHaveClass(/is-active/)
    await expect(page.locator('.schedule-v2-summary > button').first()).toHaveCSS('border-radius', '32px')
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'День', exact: true })).toBeVisible()
    await ready()
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-day.png') })
    const fab = await page.locator('.schedule-v2-fab').boundingBox()
    const nav = await page.locator('.trainer-tab-bar').boundingBox()
    expect(fab!.width).toBe(68)
    await expect(page.locator('.schedule-v2-fab svg')).toHaveCSS('filter', 'brightness(0)')
    expect(fab!.y + fab!.height).toBeLessThanOrEqual(nav!.y)
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    const grid = await page.locator('.schedule-v2-card-grid').boundingBox()
    const sunday = await page.locator('.schedule-v2-day-card').nth(6).boundingBox()
    expect(sunday!.width).toBeCloseTo(grid!.width, 0)
    await ready()
    const settings = await page.getByRole('button', { name: 'Настройки расписания' }).boundingBox()
    expect(settings!.x + settings!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-week.png') })
    await page.getByRole('button', { name: '2 недели', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  })

  test(`Figma foundation preserves native icons, fonts and pilot isolation at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await mockPilot(page, { fitLime: true, workouts: [] })
    await page.goto('/clients')
    await expect(page.locator('.fit-lime-shell')).toBeVisible()
    await expect(page.locator('.trainer-tab-bar [data-original-icon="users"]')).toBeVisible()
    await expect(page.locator('.trainer-tab-bar')).toHaveCSS('backdrop-filter', 'blur(22px)')
    await expect(page.locator('.page-header h1')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.page-header h1')).toHaveCSS('font-weight', '500')
    await expect(page.locator('.fit-lime-shell')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    if (process.env.FIT_LIME_FONTS_REQUIRED === 'true') {
      expect(await page.evaluate(async () => {
        const regular = await document.fonts.load('400 16px "YS Geo"', 'АаЁё123')
        const medium = await document.fonts.load('500 24px "YS Geo"', 'Клиенты')
        const counter = await document.fonts.load('700 32px REM', '123')
        return [...regular, ...medium, ...counter].map((font) => font.status)
      })).toEqual(['loaded', 'loaded', 'loaded'])
    }
    for (const asset of await page.locator('.trainer-tab-bar image').all()) {
      await expect(asset).toHaveAttribute('width', '24')
      await expect(asset).toHaveAttribute('height', '24')
      const source = await asset.getAttribute('href')
      expect(await page.evaluate(async (url) => {
        const img = new Image()
        img.src = url!
        await img.decode()
        return [img.naturalWidth, img.naturalHeight]
      }, source)).toEqual([24, 24])
    }
    await page.screenshot({ path: testInfo.outputPath('figma-foundation.png'), fullPage: true })
    await mockPilot(page, { fitLime: false, workouts: [] })
    await page.reload()
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
    await expect(page.locator('[data-original-icon]')).toHaveCount(0)
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} server-assigned trainer keeps calendar, actions and inbox after direct navigation`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
    await expect(page.getByRole('dialog', { name: 'Входящие' }).getByRole('heading', { name: 'Сообщения' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть входящие' }).click()
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.getByRole('button', { name: 'Четверг, 24 сентября' })).toBeVisible()
    await page.reload()
    await expect(page.locator('.schedule-v2-card-grid')).toBeVisible()
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} trainer receives Fit Lime shell on released routes only`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-shell-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-shell-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.reload()
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await page.goto('/clients')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await page.goto('/today?view=compose')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime today keeps the reference hierarchy and working entry paths`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-summary/)
    await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Новая тренировка', exact: true })).toBeVisible()
    await expect(page.locator('.schedule-v2-now')).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.goto('/today?view=compose&entry=text')
    await expect(page).toHaveURL(/\/today\?view=compose&entry=text/)
    await expect(page.locator('.fit-lime-shell')).toBeVisible()
  })
}

test('Fit Lime stage 4 keeps workout and assistant routes scoped to the pilot trainer', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  for (const [route, surface] of [
    ['/workouts/new?date=2026-09-24', '.workout-form-page'],
    ['/today?view=compose&entry=text', '.today-text-fallback'],
    [`/workouts/${workoutId}`, '.workout-detail-page'],
    [`/workouts/${workoutId}/live`, '.live-workout-page'],
    [`/workouts/${workoutId}/history/fedb-barbell-squat`, '.exercise-card-tabs'],
    ['/assistant', '.assistant-page'],
  ] as const) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await expect(page.locator(surface)).toBeVisible()
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    if (route === '/assistant') await expect(page.getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeVisible()
    const screenshotPath = testInfo.outputPath(`stage4-${surface.slice(1)}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach(`stage4-${surface.slice(1)}`, { path: screenshotPath, contentType: 'image/png' })
  }
})

test('workout and assistant routes keep the previous presentation outside Fit Lime', async ({ page }) => {
  await mockPilot(page, { fitLime: false })
  for (const route of ['/workouts/new?date=2026-09-24', '/today?view=compose&entry=text', `/workouts/${workoutId}`, `/workouts/${workoutId}/live`, '/assistant']) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
  }
})

// Each screen has its own timeout and isolated page context. A single navigation
// loop couples all 19 screens to one 30-second budget on a busy CI runner.
for (const route of [
  '/today?date=2026-09-24',
  '/schedule?week=2026-09-21',
  '/chat',
  `/chat/${conversationId}`,
  '/clients',
  `/clients/${clientId}`,
  '/clients/new',
  `/clients/${clientId}/goal`,
  `/progress/${clientId}`,
  `/clients/${clientId}/workouts`,
  '/profile',
  '/profile/settings',
  '/profile/trainer',
  '/exercises',
  '/workouts/new?date=2026-09-24',
  `/workouts/${workoutId}`,
  `/workouts/${workoutId}/live`,
  `/workouts/${workoutId}/history/fedb-barbell-squat`,
  '/assistant',
]) {
  test(`Fit Lime trainer screens fit a narrow phone without horizontal page clipping: ${route}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { fitLime: true })
    await page.goto(route)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    if (route.startsWith('/today')) await expect(page.locator('.fit-lime-today')).toBeVisible()
    if (route.startsWith('/schedule')) await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    if (route.startsWith('/workouts/new')) await expect(page.locator('.workout-form-page')).toBeVisible()
    if (route === '/assistant') await expect(page.locator('.assistant-page')).toBeVisible()
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(documentWidth, `Horizontal overflow on ${route}`).toBeLessThanOrEqual(320)
    const clippedControls = await page.evaluate(() => {
      const selectors = [
        '.trainer-tab-bar a',
        '.workout-form-section',
        '.workout-form-section .client-picker-trigger',
        '.workout-form-section .workout-record-mode button',
        '.workout-form-section .workout-time-row input',
        '.workout-form-section .workout-notes summary',
        '.schedule-v2-period strong',
        '.assistant-composer textarea',
      ]
      return [...document.querySelectorAll<HTMLElement>(selectors.join(', '))]
        .filter((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.right > window.innerWidth + 1 || bounds.left < -1 || element.scrollWidth > element.clientWidth + 1
        })
        .map((element) => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`)
    })
    expect(clippedControls, `Clipped controls on ${route}`).toEqual([])
    if (route.startsWith('/workouts/') || route.startsWith('/today')
      || route.startsWith('/schedule') || route === '/assistant') {
      const label = `narrow-${route.replace(/[^a-z0-9]+/gi, '-')}`
      const screenshotPath = testInfo.outputPath(`${label}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach(label, { path: screenshotPath, contentType: 'image/png' })
    }
  })
}

test('trainer without Fit Lime keeps the existing day hierarchy', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.fit-lime-today')).toHaveCount(0)
  await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-home-actions/)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime schedule keeps week, fortnight and selected date`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    const weekstripSurface = await page.locator('.schedule-v2-weekdays').first().evaluate((element) => ({
      labelBackground: getComputedStyle(element).backgroundColor,
      numberStripBackground: getComputedStyle(element, '::before').backgroundColor,
    }))
    expect(weekstripSurface).toEqual({ labelBackground: 'rgba(0, 0, 0, 0)', numberStripBackground: 'rgb(37, 54, 12)' })
    await expect(page.locator('.schedule-v2-period-summary')).toHaveText('1 тренировка · 1 клиент')
    await expect(page.locator('.schedule-v2-day-card').first()).toContainText('Свободный день')
    await expect(page.locator('.schedule-v2-day-card').nth(3)).toContainText('Алексей Смирнов')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-schedule-week.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-schedule-week', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: '2 недели', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
    await page.locator('.schedule-v2-day-card').nth(8).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
    await page.reload()
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await page.getByRole('button', { name: 'Настройки расписания' }).click()
    await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  })
}

test('Fit Lime weekstrip fits a 320-pixel phone without clipping days', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
  await mockPilot(page, { fitLime: true })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.fit-lime-schedule')).toBeVisible()
  const lastDay = await page.locator('.schedule-v2-weekdays button').last().boundingBox()
  expect(lastDay).not.toBeNull()
  expect(lastDay && lastDay.x + lastDay.width <= 320).toBe(true)
  await expect(page.locator('.schedule-v2-weekdays button')).toHaveCount(7)
})

test('trainer without Fit Lime keeps the existing week styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.schedule-v2-weekstrip')).toBeVisible()
  await expect(page.locator('.fit-lime-schedule')).toHaveCount(0)
})

test('non-pilot trainer retains the classic Today and schedule routes', async ({ page }) => {
  await mockPilot(page, { pilot: false, workouts: [] })
  await page.goto('/today')
  await expect(page.locator('.today-page')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.goto('/schedule')
  await expect(page.locator('.schedule-page:not(.schedule-v2)')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('renders the single-trainer schedule and combines questions with messages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.getByRole('button', { name: /1 Незавершённые действия/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toContainText('СегодняРасписаниеКлиенты')
  await expect(page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' })).toHaveAttribute('href', '/workouts/new?date=2026-09-24')
  const timelineScroll = await page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)
  expect(timelineScroll).toBeGreaterThan(300)
  expect(timelineScroll).toBeLessThan(500)
  const fabBox = await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' }).boundingBox()
  const navigationBox = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox()
  expect(fabBox && navigationBox && fabBox.y + fabBox.height < navigationBox.y).toBe(true)

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: /1 Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Требует действия' })).toBeVisible()
  await expect(page.getByText('Прошлый план ждёт решения')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Алексей Смирнов')).toHaveCSS('color', 'rgb(248, 248, 246)')
  const actionScreenshotPath = testInfo.outputPath('trainer-schedule-v2-actions.png')
  await page.screenshot({ path: actionScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-actions', { path: actionScreenshotPath, contentType: 'image/png' })
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()

  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 3 })).toBeVisible()
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()
  const inboxScreenshotPath = testInfo.outputPath('trainer-schedule-v2-inbox.png')
  await page.screenshot({ path: inboxScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-inbox', { path: inboxScreenshotPath, contentType: 'image/png' })

  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть все сообщения' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()

  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeFocused()
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(0)
})

test('trainer switches day-grid density from schedule and profile settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  const timeline = page.locator('.schedule-v2-timeline')
  const grid = timeline.locator('.day-grid')
  await expect(grid).toHaveCSS('height', `${24 * 56}px`)
  await timeline.evaluate((element) => { element.scrollTop = 500 })
  const before = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))

  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'Компактная сетка' }).click()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
  const after = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))
  expect((before.scrollTop + before.height / 2) / 56)
    .toBeCloseTo((after.scrollTop + after.height / 2) / 44, 1)

  await page.reload()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await page.goto('/profile/settings')
  const densityGroup = page.getByRole('radiogroup', { name: 'Плотность временной сетки' })
  await expect(densityGroup.getByRole('radio', { name: 'Компактная' })).toHaveAttribute('aria-checked', 'true')
  await densityGroup.getByRole('radio', { name: 'Обычная' }).click()
  await expect(densityGroup.getByRole('radio', { name: 'Обычная' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Сохранено')).toBeVisible()

  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.schedule-density-compact')).toHaveCount(0)
  await page.getByRole('button', { name: 'Четверг, 24 сентября' }).click()
  await expect(page.locator('.schedule-v2-timeline .day-grid')).toHaveCSS('height', `${24 * 56}px`)

  const screenshotPath = testInfo.outputPath('trainer-schedule-density-settings.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-density-settings', { path: screenshotPath, contentType: 'image/png' })
})

test('monochrome trainer switches day-grid density without Schedule V2', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page, { pilot: false })
  await page.goto('/schedule?date=2026-09-24')

  const timeline = page.locator('.day-grid-scroll')
  const grid = timeline.locator('.day-grid')
  await expect(page.locator('.trainer-schedule-identity')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(grid).toHaveCSS('height', `${24 * 56}px`)
  await timeline.evaluate((element) => { element.scrollTop = 500 })
  const before = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))

  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'Компактная сетка' }).click()

  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
  const after = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))
  expect((before.scrollTop + before.height / 2) / 56)
    .toBeCloseTo((after.scrollTop + after.height / 2) / 44, 1)
  const screenshotPath = testInfo.outputPath('trainer-schedule-monochrome-density.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-monochrome-density', { path: screenshotPath, contentType: 'image/png' })

  await page.reload()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
})

test('inbox messages fail independently and all-messages back returns to the selected day', async ({ page }) => {
  const backend = await mockPilot(page, { failThreads: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить сообщения')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку сообщений' }).click()
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await inbox.getByRole('link', { name: 'Открыть все сообщения' }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('inbox questions fail independently and recover without hiding messages', async ({ page }) => {
  const backend = await mockPilot(page, { failWorkspace: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить вопросы')).toBeVisible({ timeout: 15_000 })
  backend.setWorkspaceFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку вопросов' }).click()
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await inbox.getByText('Можно заменить приседания?').click()
  await expect(page).toHaveURL(/\/workouts\/10000000-0000-4000-8000-000000000003\?reply=1$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('replying to a trainer question updates the inbox count on return', async ({ page }) => {
  await mockPilot(page, { questionWorkout: true })
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Можно заменить приседания?')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Можно заменить приседания?').click()
  await expect(page.getByRole('textbox', { name: 'Ответ клиенту' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Ответ клиенту' }).fill('Да, можно заменить.')
  await page.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(page.getByText('Вопрос закрыт')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '4 Вопросы и сообщения' })).toBeVisible()
})

test('reading a chat message updates the inbox count on return', async ({ page }) => {
  const readRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/read')) readRequests.push(request.url()) })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Спасибо!').click()
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect.poll(() => readRequests).toHaveLength(1)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '1 Вопросы и сообщения' })).toBeVisible()
})

for (const width of [390, 430, 1440]) for (const fitLime of [false, true]) test(`compact trainer home keeps old active workout without full history ${fitLime ? 'Lime' : 'Mono'} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const rows: MockWorkout[] = Array.from({ length: 121 }, (_, index) => ({ ...workout,
    id: `c8100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, status: 'done',
    completedAt: '2026-09-20T10:00:00Z', workoutDate: '2026-09-20',
  }))
  rows.push({ ...workout, status: 'in_progress', workoutDate: '2025-01-01', startedAt: '2025-01-01T10:00:00Z' })
  const requests: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:4100') requests.push(url)
  })
  await mockPilot(page, { fitLime, workouts: rows })
  await page.goto('/today')
  if (fitLime) {
    await page.getByRole('button', { name: /Незавершённые действия/ }).click()
    await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).locator(`a[href="/workouts/${workoutId}/live"]`)).toBeVisible()
  } else {
    await expect(page.getByRole('region', { name: 'Активные тренировки' }).getByRole('link')).toHaveAttribute('href', `/workouts/${workoutId}/live`)
  }
  expect(requests.some((url) => url.pathname === '/v1/workouts/home' && url.searchParams.get('today') === '2026-09-27')).toBe(true)
  const history = requests.filter((url) => url.pathname === '/v1/training-data' && url.searchParams.get('scope') === 'workouts')
  expect(history.every((url) => url.searchParams.has('from') && url.searchParams.has('to'))).toBe(true)
  await page.screenshot({ path: info.outputPath('compact-home.png'), fullPage: true })
})

test('compact trainer home failure is not presented as no workouts and retry restores old active', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { workouts: [{ ...workout, status: 'in_progress', workoutDate: '2025-01-01' }] })
  let fail = true
  await page.route('**/v1/workouts/home?*', async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    else await route.fallback()
  })
  await page.goto('/today')
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить действия' })).toBeVisible()
  fail = false
  await queue.getByRole('button', { name: 'Повторить загрузку действий' }).click()
  await expect(page.getByRole('region', { name: 'Активные тренировки' }).getByRole('link')).toHaveAttribute('href', `/workouts/${workoutId}/live`)
})

test('non-Lime today keeps voice, text, draft, workout context and onboarding beside the calendar', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await page.addInitScript((profileId) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'compose', text: 'Приседания 3 по 10', choices: {}, items: [], clientId: '',
    }))
  }, trainerId)
  await mockPilot(page, { workouts: [{ ...workout, workoutDate: '2026-09-27', startTime: '15:00' }] })
  await page.goto('/today')

  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toHaveAttribute('href', '/today?view=compose')
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toHaveAttribute('href', '/today?view=compose&entry=text')
  await expect(page.getByRole('link', { name: /Есть незавершённая тренировка.*Продолжить/ })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Ближайшая тренировка')
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Алексей Смирнов')
  const timelineHeight = await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)
  await page.getByRole('button', { name: 'Установка и уведомления' }).click()
  await expect(page.getByRole('dialog', { name: 'Установка и уведомления' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeVisible()
  expect(await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)).toBe(timelineHeight)
  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-today-actions.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-today-actions', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: 'Закрыть подсказки' }).click()
  await page.getByRole('link', { name: 'Ввести текстом' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose&entry=text$/)
  await expect(page.locator('.today-text-fallback')).toBeVisible()
  await expect(page.locator('.today-text-fallback')).toContainText('Приседания 3 по 10')
  await page.goBack()
  await expect(page.locator('.schedule-v2-home-actions')).toBeVisible()
  await page.getByRole('link', { name: 'Надиктовать тренировку' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
})

test('today keeps creation available when the trainer has no clients or workouts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { hasClients: false, workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toHaveAttribute('href', '/clients/new')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toHaveCount(0)
  await expect(page.getByText('Свободный день')).toBeVisible()
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '0 Незавершённые действия' }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Незавершённых действий нет')).toBeVisible()
})

test('calendar error leaves inbox and action tiles reachable, then retries in place', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { failTrainingData: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: /Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /Незавершённые действия/ })).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить данные' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('action queue shows source failure and recovers on retry', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { workouts: [], failClients: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '— Незавершённые действия' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить действия' })).toBeVisible()
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить планы' })).toBeVisible()
  backend.setClientsFailure(false)
  await queue.getByRole('button', { name: 'Повторить загрузку действий' }).click()
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime action queue preserves the selected day in workout navigation`, async ({ page }) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Незавершённые действия/ }).click()
    await expect(page.locator('.fit-lime-action-backdrop')).toBeVisible()
    const action = page.getByRole('dialog', { name: 'Рабочая очередь' }).locator('.schedule-v2-action-row[href]')
    await expect(action).toHaveAttribute('href', `/workouts/${workoutId}?reply=1`)
    await action.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}\\?reply=1$`))
    expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime planning action returns to its calendar date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  await page.getByRole('dialog', { name: 'Рабочая очередь' }).getByRole('link', { name: 'Запланировать' }).click()
  expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-27')
})

test('trainer without Fit Lime keeps the queue outside the pilot portal scope', async ({ page }) => {
  await mockPilot(page, { workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.locator('.fit-lime-action-backdrop')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime inbox list keeps questions, dialogs and calendar return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
    await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-inbox-list.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-inbox-list', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime questions remain visible when dialogs fail, and dialogs recover independently', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, questionWorkout: true, failThreads: true })
  await page.goto('/chat')
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('Fit Lime dialog remains visible when questions fail', async ({ page }) => {
  await mockPilot(page, { fitLime: true, failWorkspace: true })
  await page.goto('/chat')
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить вопросы' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('trainer without Fit Lime keeps the existing messages list', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 1 })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime conversation keeps the calendar path and readable composer`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Назад' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Назад' })).toHaveCSS('opacity', '1')
    await expect(page.locator('.chat-message.partner')).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    await expect(page.getByRole('button', { name: 'Отправить' })).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-conversation.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-conversation', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime conversation retries a failed send without duplicating the message', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstChatSend: true })
  await page.goto(`/chat/${conversationId}`)
  await page.getByRole('textbox', { name: 'Сообщение' }).fill('Проверю и отвечу')
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Ошибка')).toBeVisible()
  await page.locator('.chat-message.own').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Проверю и отвечу')).toBeVisible()
  await expect(page.locator('.chat-message.own').getByText('Отправлено')).toBeVisible()
  await expect(page.locator('.chat-message.own')).toHaveCount(1)
  expect(backend.getChatSendAttempts()).toBe(2)
})

test('trainer without Fit Lime keeps the existing conversation styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/chat/${conversationId}`)
  await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

const limeClients = [
  { id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000021', fullName: 'Борис Иванов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000022', fullName: 'Вера Кузнецова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000023', fullName: 'Глеб Орлов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000024', fullName: 'Дарья Ершова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000025', fullName: 'Егор Панов', archivedAt: null, version: 1 },
]

// Chromium uses trusted browser touch input. WebKit's public input API only
// supports mouse drag here; that result is not physical iPhone acceptance.
async function beginClientGesture(page: Page, surface: Locator, browserName: string) {
  await surface.scrollIntoViewIfNeeded()
  const box = await surface.boundingBox()
  if (!box) throw new Error('Client surface is not visible')
  const from = { x: box.x + box.width * 0.88, y: box.y + box.height / 2 }
  expect(await surface.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), from)).toBe(true)
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
  let position = from
  return {
    width: box.width,
    async move(distance: number, vertical = 0) {
      const to = { x: from.x - distance, y: from.y + vertical }
      const previous = position
      for (let step = 1; step <= 8; step += 1) {
        position = { x: previous.x + (to.x - previous.x) * step / 8, y: previous.y + (to.y - previous.y) * step / 8 }
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [position] })
        else await page.mouse.move(position.x, position.y)
      }
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    },
    async end(cancel = false) {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
        await cdp.detach()
      } else if (cancel) {
        // WebKit cancellation state is tested separately from its mouse path.
        await surface.dispatchEvent('pointercancel', { pointerId: 1 })
        await page.mouse.up()
      } else await page.mouse.up()
    },
  }
}

async function openSwipeFixture(page: Page, fitLime: boolean, width = 390, theme = 'light') {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
  await mockPilot(page, { fitLime, clientRecords: limeClients.map((item, index) => index === 5 ? { ...item, fullName: 'Александра Константинопольская-Оченьдлиннаяфамилия' } : item) })
  await page.addInitScript((theme) => localStorage.setItem('fit.appTheme', theme), theme)
  await page.goto('/clients')
  await expect(page.locator('.client-swipe-surface').first()).toBeVisible()
  const tip = page.getByRole('status').filter({ hasText: 'В архив одним свайпом' })
  if (await tip.isVisible()) await tip.getByRole('button', { name: 'Понятно' }).click()
  return page.locator(`[data-client-swipe-id="${clientId}"]`)
}

async function expectSwipeActionReadable(row: Locator) {
  const ratio = await row.locator('.client-swipe-actions').evaluate((rail) => {
    const luminance = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        const channel = v / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const foreground = luminance(getComputedStyle(rail.querySelector('button')!).color)
    const background = luminance(getComputedStyle(rail).backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

for (const [fitLime, width, theme] of [
  [false, 390, 'light'], [false, 430, 'dark'], [true, 390, 'dark'], [true, 430, 'dark'], [false, 1440, 'light'],
] as const) test(`Client full swipe archives without a click and persists ${fitLime ? 'Lime' : theme} ${width}`, async ({ page, browserName }, testInfo) => {
  const row = await openSwipeFixture(page, fitLime, width, theme)
  const commands: Array<{ archived: boolean; expectedVersion: number }> = []
  page.on('request', (request) => { if (new URL(request.url()).pathname === `/v1/clients/${clientId}/archive` && request.method() === 'PUT') commands.push(request.postDataJSON() as { archived: boolean; expectedVersion: number }) })
  const short = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await short.move(96)
  await short.end()
  const shortAction = row.getByRole('button', { name: 'В архив', exact: true })
  await expect(shortAction.locator('[data-icon="archive"]')).toBeVisible()
  await expect(shortAction).toHaveCSS('font-size', '14px')
  await expectSwipeActionReadable(row)
  await page.keyboard.press('Tab')
  await shortAction.focus()
  await expect(shortAction).toHaveCSS('outline-style', 'solid')
  await page.screenshot({ path: testInfo.outputPath('full-swipe-short.png') })
  await row.getByRole('button', { name: /Действия с клиентом/ }).click()
  expect(commands).toHaveLength(0)
  const gesture = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await gesture.move(Math.min(280, gesture.width * 0.72))
  await expect(row).toHaveClass(/is-armed/)
  await expect(row.getByText('Отпустите — в архив')).toBeVisible()
  await expectSwipeActionReadable(row)
  expect(commands).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('full-swipe-armed.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await gesture.end()
  await expect(row).toHaveCount(0)
  await expect(page).toHaveURL(/\/clients$/)
  expect(commands).toEqual([{ archived: true, expectedVersion: 1 }])
  const feedback = page.locator('.clients-archive-feedback')
  await expect(feedback.locator('[data-icon="check"]')).toBeVisible()
  expect((await feedback.getByRole('button', { name: 'Вернуть' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await feedback.getByRole('button', { name: 'Закрыть сообщение' }).boundingBox())!.width).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: testInfo.outputPath('full-swipe-success.png') })
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(row).toBeVisible()
  expect(commands).toEqual([{ archived: true, expectedVersion: 1 }, { archived: false, expectedVersion: 2 }])
  const again = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await again.move(Math.min(280, again.width * 0.72))
  await again.end()
  await expect(row).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible()
  await expect(row).toHaveCount(0)
  await page.getByRole('link', { name: 'Архив', exact: true }).click()
  await expect(row).toBeVisible()
  // A long gesture must not silently restore an archived client.
  const restore = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await restore.move(Math.min(280, restore.width * 0.72))
  await restore.end()
  await expect(row.getByRole('button', { name: 'Восстановить' })).toBeVisible()
  expect(commands).toHaveLength(3)
  await page.screenshot({ path: testInfo.outputPath('full-swipe-archive.png') })
})

for (const fitLime of [false, true]) test(`Client full swipe keeps short reversed vertical and cancelled gestures harmless ${fitLime ? 'Lime' : 'ordinary'}`, async ({ page, browserName }) => {
  const row = await openSwipeFixture(page, fitLime)
  const commands: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/archive') && request.method() === 'PUT') commands.push(request.url()) })
  const surface = row.locator('.client-swipe-surface')
  const vertical = await beginClientGesture(page, surface, browserName)
  const before = await page.locator('.content').evaluate((element) => element.scrollTop)
  await vertical.move(3, -100)
  await vertical.end()
  await expect(row).not.toHaveClass(/is-open/)
  if (browserName === 'chromium') await expect.poll(() => page.locator('.content').evaluate((element) => element.scrollTop)).toBeGreaterThan(before)
  const short = await beginClientGesture(page, surface, browserName)
  await short.move(96)
  await short.end()
  await expect(row.getByRole('button', { name: 'В архив' })).toBeVisible()
  const other = page.locator('[data-client-swipe-id="10000000-0000-4000-8000-000000000021"]')
  const next = await beginClientGesture(page, other.locator('.client-swipe-surface'), browserName)
  await next.move(96)
  await expect(row).not.toHaveClass(/is-open/)
  await next.end()
  await expect(other).toHaveClass(/is-open/)
  const back = await beginClientGesture(page, surface, browserName)
  await back.move(96)
  await expect(other).not.toHaveClass(/is-open/)
  await back.end()
  await row.getByRole('link', { name: /Алексей Смирнов/ }).click()
  await expect(row).not.toHaveClass(/is-open/)
  await expect(page).toHaveURL(/\/clients$/)
  const reversed = await beginClientGesture(page, surface, browserName)
  await reversed.move(250)
  await expect(row).toHaveClass(/is-armed/)
  await reversed.move(10)
  await expect(row).not.toHaveClass(/is-armed/)
  await reversed.end()
  await expect(row).not.toHaveClass(/is-open/)
  const cancelled = await beginClientGesture(page, surface, browserName)
  await cancelled.move(250)
  await cancelled.end(true)
  await expect(row).not.toHaveClass(/is-open/)
  await expect(page).toHaveURL(/\/clients$/)
  expect(commands).toHaveLength(0)
})

for (const fitLime of [false, true]) test(`Client full swipe presentation fits long names with reduced motion ${fitLime ? 'Lime' : 'ordinary'}`, async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openSwipeFixture(page, fitLime, 320)
  // Search puts the target card above fixed navigation before trusted input.
  await page.getByRole('searchbox', { name: 'Поиск клиента' }).fill('Александра')
  await expect(page.locator('.client-swipe-row')).toHaveCount(1)
  const row = page.locator('[data-client-swipe-id="10000000-0000-4000-8000-000000000025"]')
  const surface = row.locator('.client-swipe-surface')
  const gesture = await beginClientGesture(page, surface, browserName)
  await gesture.move(gesture.width * 0.72)
  await expect(row).toHaveClass(/is-armed/)
  await expectSwipeActionReadable(row)
  expect(parseFloat(await surface.evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThan(0.01)
  await gesture.end()
  const feedback = page.locator('.clients-archive-feedback')
  await expect(feedback).toContainText('Александра Константинопольская-Оченьдлиннаяфамилия')
  await expect(feedback.getByRole('button', { name: 'Вернуть' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await feedback.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const messageBox = await feedback.locator('span:not(.clients-archive-feedback-icon)').boundingBox()
  const undoBox = await feedback.getByRole('button', { name: 'Вернуть' }).boundingBox()
  expect(undoBox!.y).toBeGreaterThanOrEqual(messageBox!.y + messageBox!.height)
  await page.screenshot({ path: testInfo.outputPath('full-swipe-long-name-success.png') })
  await feedback.getByRole('button', { name: 'Вернуть' }).click()
  await expect(row).toBeVisible()
})

test('Client full swipe has pending feedback, single request and a recoverable server error', async ({ page, browserName }, testInfo) => {
  const row = await openSwipeFixture(page, true)
  let release: () => void = () => undefined
  const gate = new Promise<void>((done) => { release = done })
  let attempts = 0
  await page.route(`**/v1/clients/${clientId}/archive`, async (route) => {
    attempts += 1
    if (attempts === 1) {
      await gate
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    }
    return route.fallback()
  })
  const gesture = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await gesture.move(250)
  await gesture.end()
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: 'Архивируем…' })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'Архивируем…' })).toHaveCSS('opacity', '1')
  await expectSwipeActionReadable(row)
  await page.screenshot({ path: testInfo.outputPath('full-swipe-pending.png') })
  const duplicate = await beginClientGesture(page, row.locator('.client-swipe-surface'), browserName)
  await duplicate.move(250)
  await duplicate.end()
  expect(attempts).toBe(1)
  expect(await page.getByRole('button', { name: 'Вернуть' }).count()).toBe(0)
  release()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('aria-busy', 'false')
  expect(await page.getByRole('button', { name: 'Вернуть' }).count()).toBe(0)
  await row.getByRole('button', { name: 'В архив' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Вернуть' })).toBeVisible()
  expect(attempts).toBe(2)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client list keeps search, archive and restore`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, clientRecords: limeClients })
    await page.goto('/clients')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
    await expect(page.locator('.client-card').first()).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    await page.getByRole('searchbox', { name: 'Поиск клиента' }).fill('кузнец')
    await expect(page.getByRole('link', { name: /Вера Кузнецова/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Алексей Смирнов/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Очистить поиск' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-clients-list.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-clients-list', { path: screenshotPath, contentType: 'image/png' })
    }
    const firstCard = page.locator(`[data-client-swipe-id="${clientId}"]`)
    await firstCard.getByRole('button', { name: 'Действия с клиентом Алексей Смирнов' }).click()
    await firstCard.getByRole('button', { name: 'В архив' }).click()
    await expect(page.getByRole('status').getByText('Карточка «Алексей Смирнов» перемещена в архив')).toBeVisible()
    await page.getByRole('link', { name: 'Архив' }).click()
    await expect(page).toHaveURL(/\/clients\/archive$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    const archivedCard = page.locator(`[data-client-swipe-id="${clientId}"]`)
    await expect(archivedCard.getByRole('link', { name: /Алексей Смирнов/ })).toBeVisible()
    await archivedCard.getByRole('button', { name: 'Действия с клиентом Алексей Смирнов' }).click()
    await archivedCard.getByRole('button', { name: 'Восстановить' }).click()
    await expect(page.getByRole('heading', { name: 'Архив пуст' })).toBeVisible()
  })
}

test('Fit Lime client loading error retries without losing the clients route', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failClients: true })
  await page.goto('/clients')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: /Алексей Смирнов/ })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
})

test('trainer without Fit Lime keeps the previous clients list and archive', async ({ page }) => {
  await mockPilot(page, { clientRecords: limeClients })
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.getByRole('link', { name: 'Архив' }).click()
  await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client card keeps actions and confirms archive`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto(`/clients/${clientId}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Сводка по спортсмену' })).toContainText('ИМТ')
    await expect(page.getByRole('link', { name: /Запланировать тренировку/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /История тренировок/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Прогресс и замеры/ })).toBeVisible()
    await expect(page.locator('.client-detail-plan')).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    for (const icon of await page.locator('.client-detail-plan svg[data-original-icon]').all()) {
      await expect(icon).toHaveCSS('filter', 'brightness(0)')
    }
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-card.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-card', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Архивировать клиента' }).click()
    await expect(page.getByRole('alertdialog', { name: /Переместить карточку/ })).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByRole('button', { name: 'Архивировать клиента' })).toBeVisible()
    await page.getByRole('button', { name: 'Архивировать клиента' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
    await expect(page.getByRole('button', { name: 'Вернуть из архива' })).toBeVisible()
    await expect(page.getByRole('status').getByText('Изменение архива сохранено')).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/clients$/)
  })
}

test('Fit Lime client card isolates secondary data failures and retries', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failTrainingData: true, failConnections: true })
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Запланировать тренировку/ })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить статистику тренировок' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить приглашения и права доступа' })).toBeVisible({ timeout: 15_000 })
  backend.setTrainingDataFailure(false)
  backend.setConnectionsFailure(false)
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить статистику тренировок' }).getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить приглашения и права доступа' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Архивировать клиента' })).toBeVisible()
})

for (const width of [390, 1440]) {
  test(`Client card aggregated stats preserve values and independent retry at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00+03:00'))
    await mockPilot(page, { fitLime: true, workouts: [] })
    let failure = false
    const statRequests: string[] = []
    await page.route(`**/v1/clients/${clientId}/workout-stats?*`, async (route) => {
      statRequests.push(route.request().url())
      await route.fulfill({ status: failure ? 404 : 200, contentType: 'application/json',
        body: failure ? '{"error":"not_found"}' : JSON.stringify({ stats: {
          doneCount: 120, completionPercent: 98, lastWorkoutDate: '2026-09-01', daysInWork: 35, needsAttention: true,
        } }) })
    })
    await page.goto(`/clients/${clientId}`)
    const coachmark = page.getByRole('button', { name: 'Понятно', exact: true })
    if (await coachmark.isVisible()) await coachmark.click()
    await expect(page.locator('.client-detail-activity')).toContainText('120 тренировок')
    await expect(page.locator('.client-detail-activity')).toContainText('98%')
    await expect(page.getByText('Давно не тренировался', { exact: true })).toBeVisible()
    expect(statRequests).toHaveLength(1)
    expect(new URL(statRequests[0]!).searchParams.get('today')).toBe('2026-10-06')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('client-card-stats.png') })
    failure = true
    await page.reload()
    const alert = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить статистику тренировок' })
    await expect(alert).toBeVisible()
    await expect(page.getByRole('link', { name: /Запланировать тренировку/ })).toBeVisible()
    failure = false
    await alert.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.locator('.client-detail-activity')).toContainText('120 тренировок')
    await expect(alert).toHaveCount(0)
  })
}

test('trainer without Fit Lime keeps the existing client card', async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client creation keeps validation, save and safe return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/clients/new')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible()
    await expect(page.locator('.client-form-section')).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-create.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-create', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page).toHaveURL(/\/clients$/)
    await page.goto('/clients/new')
    await page.getByLabel('Имя', { exact: true }).fill('Мария Тестовая')
    await page.getByLabel('Пол').selectOption('female')
    await page.getByLabel('Возраст').fill('28')
    await page.getByLabel('Рост, см').fill('168')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page).toHaveURL(/\/clients\/10000000-0000-4000-8000-000000000030$/)
    await expect(page.getByRole('heading', { name: 'Мария Тестовая' })).toBeVisible()
  })
}

test('Fit Lime trainer edit and join keep a route back to the client list', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto(`/clients/${clientId}/edit`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  await page.goto('/join')
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('heading', { name: 'Подключение' })).toBeVisible()
  await expect(page.getByLabel('Код приглашения')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/clients$/)
})

test('Fit Lime invitation dialog keeps the existing invite entry and close', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/clients')
  const invite = page.getByRole('button', { name: 'Пригласить спортсмена' })
  await invite.click()
  const dialog = page.getByRole('dialog', { name: 'Кого пригласить?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('background-color', 'rgb(37, 37, 41)')
  await expect(dialog.getByLabel('Имя спортсмена')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Создать приглашение' })).toBeFocused()
  const screenshotPath = testInfo.outputPath('fit-lime-invite-dialog.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('fit-lime-invite-dialog', { path: screenshotPath, contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(invite).toBeFocused()
})

test('trainer without Fit Lime keeps create, edit and join outside the pilot theme', async ({ page }) => {
  await mockPilot(page)
  for (const route of ['/clients/new', `/clients/${clientId}/edit`, '/join']) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime goal keeps the current stage and edit actions`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, withGoal: true })
    await page.goto(`/clients/${clientId}/goal`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Подготовка к старту' })).toBeVisible()
    await expect(page.locator('.stage-row.current')).toContainText('База')
    await expect(page.locator('.stage-row.current')).toContainText('идёт')
    await expect(page.locator('.stage-row.current')).toHaveCSS('border-top-color', 'rgb(182, 239, 77)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-goal.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-goal', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByLabel('Название этапа')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByLabel('Название этапа')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  })
}

test('Fit Lime empty goal can be created without automatic criteria', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Цель' }).fill('Укрепить спину')
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Укрепить спину' })).toBeVisible()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
})

test('Fit Lime goal error retries without changing the client route', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/goal$`))
})

test('trainer without Fit Lime keeps the original goal surface', async ({ page }) => {
  await mockPilot(page, { withGoal: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('heading', { name: 'Подготовка к старту' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime progress keeps weekly data and the measurements route`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto(`/progress/${clientId}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toContainText('Тренировок пока не было')
    await expect(page.getByRole('link', { name: 'Открыть замеры и показатели' })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'Прогресс стал короче' }).getByRole('button', { name: 'Понятно' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-progress.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-progress', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
    await expect(page).toHaveURL(new RegExp(`/progress/${clientId}\\?view=measurements$`))
    await expect(page.getByText('Замеров пока нет')).toBeVisible()
    await page.getByRole('button', { name: 'Добавить замер' }).click()
    await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.goto(`/progress/${clientId}?view=running`)
    await expect(page.getByText('За этот период пробежек нет.')).toBeVisible()
  })
}

test('Fit Lime measurement history confirms destructive removal', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, withMeasurements: true })
  await page.goto(`/progress/${clientId}?view=measurements`)
  await expect(page.getByText('Последний замер')).toBeVisible()
  await page.getByRole('button', { name: 'История · 1' }).click()
  await expect(page.getByRole('heading', { name: 'История замеров (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('alertdialog', { name: /Удалить замер/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('heading', { name: 'История замеров (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Замеров пока нет')).toBeVisible()
})

test('Fit Lime progress source error has a working retry', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/progress/${clientId}?view=measurements`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Замеров пока нет')).toBeVisible()
})

for (const fitLime of [false, true]) {
  test(`Yandex client workouts show current and future plans (Fit Lime ${fitLime})`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { fitLime, workouts: [
      { ...workout, id: newWorkoutId, workoutDate: '2026-10-01' },
      workout,
      { ...workout, id: '10000000-0000-4000-8000-000000000007', status: 'in_progress' },
    ] })
    await page.goto(`/clients/${clientId}/workouts`)
    const cards = page.locator('.client-workout-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.first()).toContainText('24 сентября 2026 г.')
    await expect(cards.last()).toContainText('1 октября 2026 г.')
    await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('fit.appTheme', value), theme)
      await page.reload()
      await expect(cards).toHaveCount(3)
for (const width of [390, 430, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`upcoming-${fitLime}-${theme}-${width}.png`), fullPage: true })
      }
    }
    await page.getByRole('button', { name: 'Календарь', exact: true }).click()
    await expect(cards).toHaveCount(3)
    await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible()
  })
}

test('Fit Lime client workout history retains list, calendar and planning exit', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [{ ...workout, status: 'done' }] })
  await page.goto(`/clients/${clientId}/workouts`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.locator('.workout-chronicle-card')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Запланировать' })).toBeVisible()
  await page.getByRole('status').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
  const screenshotPath = testInfo.outputPath('fit-lime-client-workout-history.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('fit-lime-client-workout-history', { path: screenshotPath, contentType: 'image/png' })
  await page.getByRole('group', { name: 'Вид истории тренировок' }).getByRole('button', { name: 'Календарь' }).click()
  await expect(page.locator('.client-history-calendar')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
})

test('trainer without Fit Lime keeps progress and workout history in the prior theme', async ({ page }) => {
  await mockPilot(page, { workouts: [{ ...workout, status: 'done' }] })
  for (const route of [`/progress/${clientId}`, `/progress/${clientId}?view=measurements`, `/clients/${clientId}/workouts`]) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime trainer profile keeps questionnaire, save and settings`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/profile')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'Настройки переехали' }).getByRole('button', { name: 'Понятно' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-trainer-profile.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-trainer-profile', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Заполнить анкету' }).click()
    const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
    await expect(form.getByLabel('Выбрать фото')).toBeVisible()
    await form.getByLabel('О себе').fill('Тренирую бережно и регулярно.')
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Тренирую бережно и регулярно.')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.getByRole('link', { name: 'Настройки профиля' }).click()
    await expect(page).toHaveURL(/\/profile\/settings$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByText('Lime пока доступна только на экранах тренера из пилота.')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Тёмная тема остальных экранов' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await page.goto('/profile/trainer')
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  })
}

test('Fit Lime trainer profile keeps draft after save failure and retries', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstProfileSave: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить анкету' }).click()
  const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await form.getByLabel('О себе').fill('Сохраняемый текст')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(form.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('О себе')).toHaveValue('Сохраняемый текст')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
  expect(backend.getProfileSaveAttempts()).toBe(2)
})

test('Fit Lime trainer profile reports photo upload failure without losing editor', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить анкету' }).click()
  const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await form.getByLabel('Выбрать фото').setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg')
  await expect(form.locator('.trainer-photo-editor').getByRole('alert')).toBeVisible()
  await expect(form.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('Fit Lime trainer profile retains publication, confirmation and sign-out', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByRole('button', { name: 'Снять с публикации' })).toBeVisible()
  await page.getByRole('button', { name: 'Снять с публикации' }).click()
  await expect(page.getByRole('alertdialog', { name: /Снять анкету с публикации/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('button', { name: 'Снять с публикации' })).toBeVisible()
  await page.goto('/profile/settings')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime trainer profile has addressed load retry and non-pilot control', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProfile: true })
  await page.goto('/profile')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setProfileFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
  await mockPilot(page)
  await page.reload()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.goto('/profile/settings')
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Тёмная тема', exact: true })).toBeVisible()
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime exercises retain search, technique, own list and profile return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, withCustomExercise: true })
    await page.goto('/exercises')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Упражнения', exact: true })).toBeVisible()
    await page.getByLabel('Поиск упражнения').fill('лестница')
    await expect(page.locator('.catalog-media-card').filter({ hasText: 'Лестничный тренажёр' })).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-exercises.png')
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach('fit-lime-exercises', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.locator('.catalog-media-card').filter({ hasText: 'Лестничный тренажёр' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Лестничный тренажёр' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first().click()
    await page.getByLabel('Поиск упражнения').fill('невозможное упражнение')
    await expect(page.getByText('Ничего не найдено')).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить поиск' }).click()
    await expect(page.locator('.catalog-custom-item')).toContainText('Мой присед')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })
}

test('Fit Lime custom exercise creation keeps draft after server error', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstCustomExerciseSave: true })
  await page.goto('/exercises')
  const form = page.locator('.catalog-custom-form')
  await form.getByLabel('Название').fill('Мой присед')
  await form.getByRole('button', { name: 'Добавить' }).click()
  await expect(form.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('Название')).toHaveValue('Мой присед')
  await form.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.locator('.catalog-custom-item')).toContainText('Мой присед')
  expect(backend.getCustomExerciseSaveAttempts()).toBe(2)
})

test('Fit Lime custom exercise edit and archive keep confirmation, error and restore', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, withCustomExercise: true, failArchive: true })
  await page.goto('/exercises')
  const item = page.locator('.catalog-custom-item')
  await expect(item).toContainText('Мой присед')
  await item.getByRole('button', { name: 'Изменить' }).click()
  const form = page.locator('.catalog-custom-form')
  await form.getByLabel('Название').fill('Мой присед с паузой')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(item).toContainText('Мой присед с паузой')
  await item.getByRole('button', { name: 'В архив' }).click()
  await expect(page.getByRole('alertdialog', { name: /Перенести «Мой присед с паузой» в архив/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(item).not.toHaveClass(/archived/)
  await item.getByRole('button', { name: 'В архив' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(item).not.toHaveClass(/archived/)
  backend.setArchiveFailure(false)
  await item.getByRole('button', { name: 'В архив' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
  await expect(item).toHaveClass(/archived/)
  await item.getByRole('button', { name: 'Вернуть' }).click()
  await expect(item).not.toHaveClass(/archived/)
})

test('Fit Lime exercises retry failed data without changing non-pilot catalog', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failTrainingData: true })
  await page.goto('/exercises')
  await expect(page.locator('.catalog-custom-results').getByRole('alert')).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.locator('.catalog-custom-results').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Собственных упражнений пока нет')).toBeVisible()
  await mockPilot(page)
  await page.reload()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
})

test('the bell count equals the visible queue and updates after snoozing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  let snoozeStatus = 0
  const snoozeRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/attention/snooze')) snoozeRequests.push(request.url()) })
  page.on('response', (response) => { if (response.url().includes('/attention/snooze')) snoozeStatus = response.status() })
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
  await expect(queue.getByText('Тренировки ещё не добавлены')).toBeVisible()
  await queue.getByRole('button', { name: 'Напомнить через 2 недели' }).click()
  await expect.poll(() => snoozeRequests).toHaveLength(1)
  await expect.poll(() => snoozeStatus).toBe(200)
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByText('Незавершённых действий нет')).toBeVisible()
})

test('action and onboarding sheets keep keyboard focus inside and return it on close', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  const bell = page.getByRole('button', { name: '1 Незавершённые действия' })
  await bell.click()
  const closeQueue = page.getByRole('button', { name: 'Закрыть рабочую очередь' })
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Напомнить через 2 недели' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bell).toBeFocused()

  const onboarding = page.getByRole('button', { name: 'Установка и уведомления' })
  await onboarding.click()
  const closeOnboarding = page.getByRole('button', { name: 'Закрыть подсказки' })
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(onboarding).toBeFocused()
})

test('today keeps workout entry usable while clients fail and recover', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page)
  let recovered = false
  await page.route('http://127.0.0.1:4100/v1/clients', async (route) => {
    await route.fulfill(recovered
      ? { status: 200, contentType: 'application/json', body: JSON.stringify({ clients: [] }) }
      : { status: 503, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  const clientError = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить клиентов' })
  await expect(clientError).toBeVisible()
  recovered = true
  await clientError.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toBeVisible()
})

test('renders the weekly overview from the approved composition', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('Расписание')
  await expect(page.getByText('21 — 27 Сентября 2026 г.')).toBeVisible()
  await expect(page.getByText('1 тренировка · 1 клиент')).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByText('Свободный день')).toHaveCount(6)
  await expect(page.locator('.schedule-event-decision')).toBeVisible()

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-week.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-week', { path: screenshotPath, contentType: 'image/png' })
})

test('keeps the selected day and both weeks through navigation and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await page.getByRole('button', { name: '2 недели', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  const twoWeekScreenshot = testInfo.outputPath('two-weeks.png')
  await page.screenshot({ path: twoWeekScreenshot, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-two-weeks', { path: twoWeekScreenshot, contentType: 'image/png' })
  await page.locator('.schedule-v2-day-card').nth(8).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)

  await page.locator('.schedule-v2-day-card').nth(3).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await page.locator('.schedule-v2-event').click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
})

test('new workout keeps the selected calendar day and returns to its two-week context', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-day-card').nth(8).click()
  const selectedDay = '/today?date=2026-09-29&week=2026-09-21&range=2w'
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
  await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-29' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?date=2026-09-29$/)
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
})

test('direct pilot workout link returns to its dated calendar instead of clients', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/workouts/new?date=2026-09-29')
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29$/)
})

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime actual date and original plan are distinct for ${profileId}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout, trainerId: profileId, createdBy: profileId, workoutDate: '2026-09-26' }] })
    await page.goto(`/workouts/${workoutId}`)
    await expect(page.getByText('При запуске сейчас тренировка начнётся сегодня,', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeVisible()
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout,
      status: 'done', workoutDate: '2026-09-24', startTime: '12:00:00', endTime: null,
      completedAt: '2026-09-25T00:10:00+03:00', plannedDate: '2026-09-26',
      plannedStartTime: '10:00:00', plannedEndTime: '11:00:00',
    }] })
    await page.reload()
    await expect(page.locator('.workout-header-meta')).toContainText('24 сентября 2026')
    await expect(page.getByText('Исходный план: 26 сентября 2026 г. · 10:00–11:00')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-actual-and-planned-date.png'), fullPage: true })
  })
}

test('Lime complete lifecycle preserves one plan through start resume and finish', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  const writes: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/workouts')) writes.push(new URL(request.url()).pathname) })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнения' }).click()
  await page.locator('.client-picker-trigger').click()
  await page.locator(`.client-picker-item[data-client-id="${clientId}"]`).click()
  await page.getByLabel('Начало').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'С тренером', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}/live$`))
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.schedule-v2-event.schedule-event-done')).toHaveCount(1)
  expect(writes).toEqual(['/v1/workouts', `/v1/workouts/${newWorkoutId}/start`, `/v1/workouts/${newWorkoutId}/finish`])
})

test('Lime adjacent sessions and current time remain readable and scroll returns', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-24T16:51:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [{ ...workout, startTime: '14:00', endTime: '15:00' }, { ...workout, id: newWorkoutId, startTime: '15:00', endTime: '16:00' }] })
  await page.goto('/today?date=2026-09-24')
  const events = page.locator('.schedule-v2-event')
  await expect(events).toHaveCount(2)
  await expect(events.first()).not.toHaveClass(/is-compact/)
  await expect(events.last()).not.toHaveClass(/is-compact/)
  await expect(page.locator('.day-grid-hour-label').filter({ hasText: /^17:00$/ })).toHaveCSS('visibility', 'hidden')
  const timeline = page.locator('.day-grid-scroll')
  await timeline.evaluate((element) => { element.scrollTop = 650; element.dispatchEvent(new Event('scroll')) })
  const position = await timeline.evaluate((element) => element.scrollTop)
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть выбор действия' }).click()
  expect(await timeline.evaluate((element) => element.scrollTop)).toBe(position)
  await page.goto(`/workouts/${workoutId}`)
  await page.goto('/today?date=2026-09-24')
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(position)
  await page.screenshot({ path: testInfo.outputPath('lime-calendar-readable.png') })
})

test('failed calendar save preserves the form and retry returns to the selected day once', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstSave: true })
  await page.goto('/today?date=2026-09-29&week=2026-09-21&range=2w')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнения' }).click()
  await page.locator('.client-picker-trigger').click()
  await page.locator(`.client-picker-item[data-client-id="${clientId}"]`).click()
  await page.getByLabel('Начало').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'С тренером', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.locator('.workout-form .error')).toBeVisible()
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await expect(page.getByLabel('Начало')).toHaveValue('14:00')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  expect(backend.getLastSavedStartTime()).toBe('14:00')
  expect(backend.getSaveAttempts()).toBe(2)
  await page.reload()
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('editing a pilot workout returns to its calendar day with the changed time', async ({ page }) => {
  const backend = await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  const coachmarkDismiss = page.getByRole('button', { name: 'Понятно' })
  if (await coachmarkDismiss.isVisible()) await coachmarkDismiss.click()
  await page.getByRole('link', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('Начало').fill('13:00')
  await page.getByLabel('Окончание').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  expect(backend.getLastEditedStartTime()).toBe('13:00')
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('rescheduling refreshes both the former day and the two-week overview', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Перенести тренировку' }).click()
  await page.getByLabel('Новая дата').fill('2026-09-29')
  await page.getByRole('button', { name: 'Перенести', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Перенести тренировку' })).toBeHidden()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(0)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.locator('.schedule-v2-day-card').nth(8)).toContainText('Алексей Смирнов')
})

test('cancelling a pilot plan updates the day and excludes it from weekly totals', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Тренировка не состоялась' }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveClass(/schedule-event-skipped/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.getByText('0 тренировок · 0 клиентов')).toBeVisible()
})

test('short overlapping workouts remain separate tappable cards on mobile and desktop', async ({ page }, testInfo) => {
  const firstId = '10000000-0000-4000-8000-000000000007'
  const secondId = '10000000-0000-4000-8000-000000000008'
  await mockPilot(page, { workouts: [
    { ...workout, id: firstId, clientName: 'Александр Длиннофамильный Первый', startTime: '14:00', endTime: '14:10' },
    { ...workout, id: secondId, clientName: 'Богдан Длиннофамильный Второй', startTime: '14:05', endTime: '14:20' },
  ] })
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/today?date=2026-09-24')
    const events = page.locator('.schedule-v2-event')
    await expect(events).toHaveCount(2)
    const geometry = await events.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }
    }))
    expect(geometry[0]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[1]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[0]!.right).toBeLessThanOrEqual(geometry[1]!.left)
    await expect(events.nth(0)).toHaveAttribute('aria-label', /Александр Длиннофамильный Первый/)
    await expect(events.nth(1)).toHaveAttribute('aria-label', /Богдан Длиннофамильный Второй/)
    if (viewport.width === 390) {
      await events.first().scrollIntoViewIfNeeded()
      const screenshotPath = testInfo.outputPath('trainer-schedule-v2-overlap-mobile.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('trainer-schedule-v2-overlap-mobile', { path: screenshotPath, contentType: 'image/png' })
    }
  }
  await page.locator('.schedule-v2-event').nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${secondId}$`))
})

test('untimed and near-midnight workouts remain reachable at the bottom of the day', async ({ page }) => {
  await mockPilot(page, { workouts: [
    { ...workout, id: '10000000-0000-4000-8000-000000000009', startTime: null, endTime: null },
    { ...workout, id: '10000000-0000-4000-8000-000000000010', startTime: '23:50', endTime: '00:20' },
  ] })
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.schedule-v2-untimed').getByText('Без времени', { exact: true })).toBeVisible()
  const late = page.locator('.schedule-v2-event')
  await expect(late).toHaveCount(1)
  await expect(late).toContainText('30 мин')
  const bottom = await late.evaluate((element) => (element as HTMLElement).offsetTop + element.clientHeight)
  const gridHeight = await page.locator('.schedule-v2-timeline .day-grid').evaluate((element) => element.clientHeight)
  expect(gridHeight).toBeGreaterThanOrEqual(bottom)
  await late.scrollIntoViewIfNeeded()
  await expect(late).toBeInViewport()
})

test('live clock refreshes after focus without resetting manual scroll and crosses midnight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:00.000Z'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: '27 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 700 })
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:40.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(700)
  await page.clock.setFixedTime(new Date('2026-09-27T21:01:00.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '28 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('00:01')
})

test('invalid calendar URL dates do not crash the pilot', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-02-31&range=2w')
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  await page.goto('/today?date=oops&week=2026-02-31')
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('pilot tabs, profile and browser back keep a stable calendar route', async ({ page }, testInfo) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toBeVisible()
  const tabLabels = async () => (await navigation.locator('a').allTextContents()).map((label) => label.trim())
  const initialLabels = await tabLabels()
  expect(initialLabels.slice(0, 3)).toEqual(['Сегодня', 'Расписание', 'Клиенты'])
  await navigation.getByRole('link', { name: 'Расписание' }).click()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('link', { name: 'Клиенты' }).click()
  await expect(page).toHaveURL(/\/clients$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menu')).toHaveCSS('background-color', 'rgb(34, 34, 38)')
  await expect(page.getByRole('menuitem', { name: 'Профиль', exact: true })).toHaveCSS('color', 'rgb(248, 248, 246)')
  const menuScreenshot = testInfo.outputPath('pilot-nav-profile-menu.png')
  await page.screenshot({ path: menuScreenshot })
  await testInfo.attach('pilot-nav-profile-menu', { path: menuScreenshot, contentType: 'image/png' })
  await page.getByRole('menuitem', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menuitem', { name: 'Настройки', exact: true })).toBeVisible()
})

test('pilot calendar keeps workout review and save in the existing entry flow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  expect(await page.evaluate(() => localStorage.getItem('fit.yandexAppSession.v1') !== null)).toBe(true)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.evaluate(({ profileId, workoutClientId }) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'review',
      text: 'Приседания 3 по 8',
      choices: {},
      items: [{
        line: 'Приседания 3 по 8',
        exercise: { ref: 'squat', name: 'Приседания', inputKind: 'reps' },
        sets: [{ position: 0, reps: 8 }],
        hasValues: true,
      }],
      clientId: workoutClientId,
      recordMode: 'planned',
      workoutDate: '2026-09-24',
      startTime: '10:00',
    }))
  }, { profileId: trainerId, workoutClientId: clientId })
  await page.goto('/today?view=review')
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.schedule-v2-timeline')).toHaveCount(0)
  await testInfo.attach('pilot-workout-review', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL(/\/today\?view=save$/)
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await testInfo.attach('pilot-workout-save', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.goto('/today?classic=1#trainer-attention')
  await expect(page.getByRole('heading', { name: 'Составить тренировку' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible()
})


test('Client Lime baseline keeps another client outside the redesign', async ({ page }, testInfo) => {
  await mockPilot(page, { role: 'client', profileId: '10000000-0000-4000-8000-000000000099' })
  await page.goto('/me')
  await expect(page.locator('.client-home-identity')).toBeVisible()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-client-lime/)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('client-before.png'), fullPage: true })
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime planned exercises have one list surface ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const exercises: WorkoutExercise[] = [0, 1, 2].map((position) => ({
      id: `10000000-0000-4000-8000-${String(80 + position).padStart(12, '0')}`,
      source: 'system', ref: 'squat',
      name: position === 0 ? 'Разводка гантелей на наклонной скамье с длинным названием упражнения' : `Упражнение ${position + 1}`,
      muscleGroup: 'chest', inputKind: 'strength', position,
      blockId: position === 0 ? '10000000-0000-4000-8000-000000000090' : '10000000-0000-4000-8000-000000000091',
      blockType: position === 0 ? 'single' : 'group', blockPreset: 'set', blockRounds: 3,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: `10000000-0000-4000-8000-${String(92 + position).padStart(12, '0')}`, position: 0, weightKg: 12, reps: 10, fact: {}, confirmedAt: null, version: 1 }],
    }))
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self', exercises }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto(`/workouts/${workoutId}`)
    const list = page.locator('.workout-detail-page > .planned-exercise-list')
    await expect(list.locator('.planned-detail-exercise')).toHaveCount(3)
    const geometry = await list.evaluate((element) => {
      const rows = Array.from(element.querySelectorAll('.planned-detail-exercise'))
      const rowStyles = rows.map((row) => getComputedStyle(row))
      const heading = rows[0]?.querySelector('.workout-detail-exercise-heading')
      return {
        listBorder: getComputedStyle(element).borderTopWidth,
        rowBorders: rowStyles.map((style) => style.borderTopWidth),
        rowRadii: rowStyles.map((style) => style.borderTopLeftRadius),
        innerBorders: rows.map((row) => getComputedStyle(row.querySelector('.workout-detail-exercise-row')!).borderTopWidth),
        headingFits: !!heading && heading.scrollWidth <= heading.clientWidth,
        noOverlap: rows.every((row, index) => index === 0 || rows[index - 1]!.getBoundingClientRect().bottom <= row.getBoundingClientRect().top),
      }
    })
    expect(geometry.listBorder).toBe('1px')
    expect(geometry.rowBorders).toEqual(['0px', '0px', '1px'])
    expect(geometry.rowRadii).toEqual(['0px', '0px', '0px'])
    expect(geometry.innerBorders).toEqual(['0px', '0px', '0px'])
    expect(geometry.headingFits).toBe(true)
    expect(geometry.noOverlap).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`client-plan-list-${theme}-${width}.png`) })
  })
}

for (const width of [390, 430]) {
  test(`Client Lime shell themes and account isolation ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ colorScheme: 'light' })
    await mockPilot(page, { role: 'client', profileId: clientId })
    await page.goto('/me/settings')
    const theme = page.getByLabel('Тема оформления')
    await expect(theme).toBeVisible()
    await expect(theme).toHaveValue('dark')
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await page.screenshot({ path: testInfo.outputPath(`client-default-dark-${width}.png`), fullPage: true })
    expect(await theme.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    for (const value of ['dark', 'light', 'system']) {
      await theme.selectOption(value)
      if (value === 'system') await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
      const expected = value === 'light' ? 'rgb(246, 247, 242)' : 'rgb(0, 0, 0)'
      await expect(page.locator('.phone-frame')).toHaveCSS('background-color', expected)
      await expect(page.locator('body')).toHaveCSS('background-color', expected)
      const bottomClearance = await page.locator('.phone-frame').evaluate((frame) => {
        const content = frame.querySelector('.content')
        const navigation = frame.querySelector('.client-tab-bar')
        if (!content || !navigation) return 0
        const navigationBounds = navigation.getBoundingClientRect()
        return parseFloat(getComputedStyle(content).paddingBottom) - navigationBounds.height - (innerHeight - navigationBounds.bottom)
      })
      expect(bottomClearance).toBeGreaterThanOrEqual(16)
      const lastContentClearance = await page.locator('.phone-frame').evaluate((frame) => {
        const content = frame.querySelector('.content')
        const navigation = frame.querySelector('.client-tab-bar')
        if (!content || !navigation || !content.lastElementChild) return -1
        content.scrollTop = content.scrollHeight
        return navigation.getBoundingClientRect().top - content.lastElementChild.getBoundingClientRect().bottom
      })
      expect(lastContentClearance).toBeGreaterThanOrEqual(16)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`client-settings-${value}-${width}.png`), fullPage: true })
      await page.reload()
      await expect(theme).toHaveValue(value)
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(246, 247, 242)')
    await mockPilot(page, { role: 'client', profileId: '10000000-0000-4000-8000-000000000099' })
    await page.reload()
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-client-lime/)
    await expect(page.getByLabel('Тёмная тема')).toBeVisible()
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime workout lifecycle ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self', exercises: [{
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, reps: 8, fact: {}, confirmedAt: null, version: 1 }],
    }] }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    await expect(page.locator('.fit-client-lime')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeEnabled()
    await expect(page.locator('.voice-action-button svg[data-original-icon]')).toHaveCSS('filter', theme === 'light' ? 'brightness(0)' : 'none')
    await page.screenshot({ path: testInfo.outputPath(`client-home-${theme}.png`) })
    await page.goto('/me/workouts')
    await expect(page.locator('.client-workouts-identity')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`client-workouts-${theme}.png`) })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    await expect(page.locator('.live-workout-page')).toBeVisible()
    await expect(page.locator('.live-bottom-bar')).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 28)')
    await page.screenshot({ path: testInfo.outputPath(`client-live-${theme}.png`) })
    await expect(page.locator('.live-set-check:not(.done)')).toHaveText('Готово')
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
    await expect(page.getByText('Готово 1 из 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Завершить', exact: true })
    if (await confirm.isVisible()) await confirm.click()
    await expect(page.getByRole('region', { name: 'Тренировка завершена', exact: true })).toBeVisible()
    await expect(page.getByText('Выполнено 1 из 1 подходов')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`client-completion-${theme}.png`) })
    const completionClearance = await page.locator('.content').evaluate((content) => {
      content.scrollTop = content.scrollHeight
      const navigation = document.querySelector('.client-tab-bar')!.getBoundingClientRect()
      const lastAction = content.querySelector('.workout-completion-share-actions')!.getBoundingClientRect()
      return navigation.top - lastAction.bottom
    })
    expect(completionClearance).toBeGreaterThanOrEqual(16)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime workout list and calendar actions ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [
      { ...workout, createdBy: clientId, trainingFormat: 'self' },
      { ...workout, id: newWorkoutId, createdBy: clientId, trainingFormat: 'self', status: 'done',
        completedAt: '2026-09-23T12:00:00Z', workoutDate: '2026-09-23' },
    ] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    await page.goto('/me/workouts')
    const workoutsPage = page.locator('.fit-client-lime.client-workouts-identity')
    await expect(workoutsPage.locator('.client-workouts-page > .page-header .button')).toHaveCSS('border-radius', '999px')
    const toggle = workoutsPage.getByRole('group', { name: 'Вид истории тренировок' })
    await expect(toggle).toHaveCSS('border-radius', '28px')
    await expect(toggle.getByRole('button', { name: 'Список' })).toHaveCSS('border-radius', '24px')
    await toggle.getByRole('button', { name: 'Календарь' }).click()
    await expect(workoutsPage.locator('.client-history-calendar')).toBeVisible()
    await expect(toggle.getByRole('button', { name: 'Календарь' })).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle.getByRole('button', { name: 'Календарь' })).toHaveCSS('border-radius', '24px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`client-workout-calendar-${theme}-${width}.png`) })
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime live secondary actions ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    const exercise: WorkoutExercise = {
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, reps: 8, fact: {}, confirmedAt: null, version: 1 }],
    }
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self', exercises: [
      exercise,
      { ...exercise, id: '10000000-0000-4000-8000-000000000083', ref: 'lunge', name: 'Выпады с гантелями', position: 1,
        blockId: '10000000-0000-4000-8000-000000000084', sets: [{ ...exercise.sets[0]!, id: '10000000-0000-4000-8000-000000000085' }] },
    ] }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    await expect(page.locator('.fit-client-lime')).toBeVisible()
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    const live = page.locator('.fit-client-lime.live-identity')
    await expect(live.locator('.live-exercise.current')).toBeVisible()
    await expect(live.locator('.live-exercise-upcoming')).toBeVisible()
    await expect(live.locator('.live-add-set')).toHaveCSS('border-radius', '999px')
    await expect(live.locator('.live-add-set')).toHaveCSS('min-height', '44px')
    await expect(live.locator('.live-add-set svg')).toBeVisible()
    await expect(live.locator('.live-add-set')).toHaveText('Подход')
    await expect(live.locator('.live-add-set')).toHaveCSS('font-weight', '500')
    await expect(live.locator('.live-exercise-start')).toHaveCSS('border-radius', '999px')
    await expect(live.locator('.live-bottom-bar .workout-cta')).toHaveCSS('border-radius', '999px')
    await expect(live.locator('.live-exercise-note summary')).toHaveCSS('min-height', '44px')
    const repsInput = live.locator('input.live-set-input[type="number"]').first()
    await expect(repsInput).toHaveCSS('appearance', 'textfield')
    await repsInput.fill('10')
    await expect(repsInput).toHaveValue('10')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`client-live-actions-${theme}-${width}.png`) })
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime live circuit keeps controls and sets together ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    const exercises: WorkoutExercise[] = [0, 1].map((position) => ({
      id: `10000000-0000-4000-8000-${String(80 + position).padStart(12, '0')}`,
      source: 'system', ref: position === 0 ? 'fedb-front-dumbbell-raise' : 'squat',
      name: position === 0 ? 'Подъём гантелей вперёд' : 'Приседания',
      muscleGroup: 'shoulders', inputKind: 'strength', position,
      blockId: '10000000-0000-4000-8000-000000000090', blockType: 'group', blockPreset: 'set', blockRounds: 3,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [0, 1, 2].map((setPosition) => ({
        id: `10000000-0000-4000-8000-${String(92 + position * 3 + setPosition).padStart(12, '0')}`,
        position: setPosition, weightKg: 12, reps: 10, fact: {}, confirmedAt: null, version: 1,
      })),
    }))
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self', exercises }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    const circuit = page.locator('.fit-client-lime.live-identity .exercise-block.live').first()
    await expect(circuit.locator('.circuit-round.current')).toBeVisible()
    await expect(circuit.locator('.circuit-round.collapsed')).toHaveCount(2)
    await expect(circuit.locator('.live-round-actions')).toBeVisible()
    await expect(circuit.locator('.circuit-head-actions-only')).toBeVisible()
    const controls = await circuit.evaluate((element) => {
      const head = element.querySelector('.circuit-head-actions-only')!.getBoundingClientRect()
      const actions = element.querySelector('.live-round-actions')!.getBoundingClientRect()
      const round = element.querySelector('.circuit-round.current')!.getBoundingClientRect()
      return { aligned: Math.abs(head.top - actions.top) <= 2, close: round.top - Math.max(head.bottom, actions.bottom) <= 24 }
    })
    expect(controls.aligned).toBe(true)
    expect(controls.close).toBe(true)
    const technique = circuit.locator('.circuit-round.current .live-technique .exercise-image-technique')
    if (await technique.count()) {
      await expect(technique).toHaveCSS('max-height', '100px')
      await expect(circuit.locator('.circuit-round.current section').first().locator('.exercise-thumbnail')).toHaveCount(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`client-live-circuit-${theme}-${width}.png`) })
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime completed workout separates calorie explanation ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const exercise: WorkoutExercise = {
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'strength', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, weightKg: 20, reps: 12, fact: { weightKg: 25, reps: 12 }, confirmedAt: '2026-09-24T12:00:00Z', version: 1 }],
    }
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self',
      status: 'done', startedAt: '2026-09-24T11:00:00Z', completedAt: '2026-09-24T12:00:00Z',
      activeCaloriesKcal: 210, calorieEstimateBasis: 'Приблизительно по данным тренировки', exercises: [exercise],
    }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    await page.goto(`/workouts/${workoutId}`)
    const history = page.locator('.fit-client-lime.workout-detail-history-identity')
    const facts = history.locator('.workout-fact-summary')
    const explanation = history.locator('.workout-calorie-explanation')
    await expect(facts).toBeVisible()
    await expect(facts).toContainText('≈ 210 ккал')
    await expect(facts.locator('strong').first()).toHaveCSS('font-weight', '500')
    await expect(facts).not.toContainText('Приблизительно по данным тренировки')
    await expect(explanation).toContainText('Приблизительно по данным тренировки')
    const geometry = await page.evaluate(() => {
      const facts = document.querySelector('.workout-fact-summary')!.getBoundingClientRect()
      const explanation = document.querySelector('.workout-calorie-explanation')!.getBoundingClientRect()
      return { separated: explanation.top >= facts.bottom - 5, explanationFits: explanation.right <= innerWidth }
    })
    expect(geometry.separated && geometry.explanationFits).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const historyClearance = await page.locator('.content').evaluate((content) => {
      content.scrollTop = content.scrollHeight
      const navigation = document.querySelector('.client-tab-bar')!.getBoundingClientRect()
      const lastAction = content.querySelector('.workout-detail-actions')!.getBoundingClientRect()
      return navigation.top - lastAction.bottom
    })
    expect(historyClearance).toBeGreaterThanOrEqual(16)
    await page.screenshot({ path: testInfo.outputPath(`client-workout-history-${theme}-${width}.png`) })
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  // Keep the default 30s limit and every assertion. Twelve document loads plus
  // screenshots and a detail dialog exceeded one shared budget on CI WebKit.
  for (const [section, routes] of [
    ['profile', ['/me/progress', '/me/goal', '/me/profile', '/me/settings', '/me/edit', '/me/finance']],
    ['communication', ['/me/trainers', '/me/achievements', '/chat', `/chat/${conversationId}`, '/assistant', '/join']],
  ] as const) test(`Client Lime sections ${theme} ${width} ${section}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { role: 'client', profileId: clientId, withGoal: true, withMeasurements: true })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('.fit-client-lime')).toBeVisible()
      await expect(page.locator('h1').first()).toBeVisible()
      if (route === '/assistant' && process.env.VITE_ASSISTANT_NAV_ENABLED === 'true' && process.env.VITE_ASSISTANT_NAV_PILOT_USER_IDS?.split(',').includes(clientId)) {
        await expect(page).toHaveURL(/\/assistant$/)
        await expect(page.getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeVisible()
        const actions = page.locator('.assistant-first-entry-actions')
        const starter = actions.getByRole('button')
        await expect(actions.getByRole('button', { name: 'Записать тренировку' })).toBeVisible()
        await expect(actions.getByRole('button', { name: 'Показать прогресс' })).toBeVisible()
        await expect(actions.getByRole('button', { name: 'Что ты умеешь?' })).toBeVisible()
        await expect.poll(async () => {
          const colors = await starter.evaluateAll((buttons) => buttons.slice(0, 2).map((button) => getComputedStyle(button).backgroundColor))
          return colors.length === 2 && colors[0] !== colors[1]
        }).toBe(true)
        await expect(page.locator('.assistant-composer .assistant-icon-button').first()).toHaveCSS('border-top-left-radius', '999px')
      }
      await expect(page.getByText('Загружаем…', { exact: true })).toHaveCount(0)
      await expect(page.locator('.state-panel-error')).toHaveCount(0)
      if (route === '/me/progress') {
        const period = page.locator('.progress-story-period .ai-progress-periods.period-count-1')
        await expect(period).toBeVisible()
        const widths = await period.evaluate((element) => ({
          period: element.getBoundingClientRect().width,
          card: element.closest('.progress-story-period')!.getBoundingClientRect().width,
        }))
        expect(widths.period).toBeLessThan(widths.card / 2)
        const emphasis = await page.evaluate(() => ({
          period: getComputedStyle(document.querySelector('.progress-story-period .ai-progress-periods.period-count-1 button.active')!).backgroundColor,
          overview: getComputedStyle(document.querySelector('.progress-view-tabs button.active')!).backgroundColor,
        }))
        expect(emphasis.period).not.toBe(emphasis.overview)
      }
      if (route === '/me/profile') {
        const actions = page.locator('.client-trainer-connection-card .client-trainer-actions')
        const geometry = await actions.evaluate((element) => {
          const message = element.querySelector('.chat-start-wrap button')!.getBoundingClientRect()
          const menu = element.querySelector('.overflow-trigger')!.getBoundingClientRect()
          const card = element.closest('.client-trainer-connection-card')!.getBoundingClientRect()
          return { separate: message.right < menu.left, contained: menu.right <= card.right }
        })
        expect(geometry.separate && geometry.contained).toBe(true)
        await expect(page.locator('.client-profile-edit')).toHaveCSS('border-top-left-radius', '0px')
      }
      if (route === '/me/settings') {
        await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toHaveCSS('border-radius', '999px')
        const options = page.locator('.body-map-appearance-options.count-1')
        await expect(options).toBeVisible()
        const widths = await options.evaluate((element) => ({
          option: element.getBoundingClientRect().width,
          card: element.closest('.body-map-appearance-setting')!.getBoundingClientRect().width,
        }))
        expect(widths.option).toBeLessThan(widths.card / 2)
      }
      if (route === '/me/edit') {
        for (const button of await page.locator('.client-profile-form .actions button').all()) {
          await expect(button).toHaveCSS('border-radius', '999px')
          await expect(button).toHaveCSS('font-size', '16px')
        }
        await expect(page.locator('.client-form-section').first()).toHaveCSS('border-radius', '32px')
        await expect(page.locator('.client-profile-form input').first()).toHaveCSS('border-radius', '16px')
        await expect(page.locator('.client-profile-form select')).toHaveCSS('appearance', 'none')
        await expect(page.locator('.client-profile-form input[type="number"]').first()).toHaveCSS('appearance', 'textfield')
      }
      if (route === '/me/finance') await expect(page.locator('.page-back')).toHaveCSS('border-radius', '50%')
      if (route === '/join') {
        await expect(page.locator('.join-card')).toHaveCSS('border-radius', '32px')
        await expect(page.locator('.join-form input')).toHaveCSS('border-radius', '16px')
        await expect(page.locator('.join-form button')).toHaveCSS('border-radius', '999px')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`section-${route.replaceAll('/', '-')}.png`) })
    }
  })
  test(`Client Lime achievement detail ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { role: 'client', profileId: clientId, withGoal: true, withMeasurements: true })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me/achievements')
    await page.locator('.athlete-achievement-card').first().click()
    const detail = page.locator('.athlete-achievement-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 28)')
    await page.screenshot({ path: testInfo.outputPath('achievement-detail.png') })
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
  })
}

for (const theme of ['light', 'dark']) {
  test(`Client Lime loading error retry empty and keyboard ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const backend = await mockPilot(page, { role: 'client', profileId: clientId, workouts: [], failTrainingData: true })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    let release = () => {}
    const ready = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/v1/training-data**', async (route) => { await ready; await route.fallback() })
    await page.goto('/me/workouts')
    await expect(page.getByRole('status', { name: 'Загрузка' }).first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('loading.png') })
    release()
    await expect(page.locator('.state-panel-error')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('error.png') })
    backend.setTrainingDataFailure(false)
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.locator('.state-panel-error')).toHaveCount(0)
    await expect(page.locator('.state-panel-empty')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('empty.png') })
    await page.goto('/me/progress')
    await page.getByRole('button', { name: 'Добавить замер', exact: true }).click()
    await page.getByLabel('Заметка', { exact: true }).fill('Длинная заметка о тренировке и самочувствии спортсмена. '.repeat(12))
    await page.setViewportSize({ width: 390, height: 430 })
    await page.getByRole('button', { name: 'Сохранить замер', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Сохранить замер', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('measurement-keyboard.png') })
    await page.goto(`/chat/${conversationId}`)
    await page.locator('.chat-message').last().click()
    const sheet = page.getByRole('dialog', { name: 'Действия с сообщением' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 28)')
    for (const action of await sheet.getByRole('button').all()) await expect(action).toHaveCSS('font-weight', '500')
    await page.screenshot({ path: testInfo.outputPath('chat-menu.png') })
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })
}

test('Client Lime logout resets document scope and return preserves only its own preference', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me/settings')
  await page.getByLabel('Тема оформления').selectOption('dark')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/auth/)
  await expect(page.locator('html')).not.toHaveClass(/fit-client-lime-document/)
  await expect(page.locator('.fit-client-lime')).toHaveCount(0)
  await mockPilot(page, { role: 'client', profileId: '10000000-0000-4000-8000-000000000099' })
  await page.goto('/me/settings')
  await expect(page.getByLabel('Тёмная тема')).toBeVisible()
  await expect(page.locator('.fit-client-lime')).toHaveCount(0)
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me/settings')
  await expect(page.getByLabel('Тема оформления')).toHaveValue('dark')
  await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
})

for (const theme of ['light', 'dark']) {
  test(`Client Lime editor and exercise history ${theme}`, async ({ page }, testInfo) => {
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self' }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      for (const [route, surface] of [
        ['/workouts/new', '.workout-form-page'],
        [`/workouts/${workoutId}/edit`, '.workout-form-page'],
        [`/workouts/${workoutId}/history/fedb-barbell-squat`, '.exercise-card-tabs'],
      ] as const) {
        await page.goto(route)
        await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
        await expect(page.locator(surface)).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${width}.png`) })
      }
    }
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime workout composer voice action matches form ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self' }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    for (const route of ['/workouts/new', `/workouts/${workoutId}/edit`]) {
      await page.goto(route)
      const composer = page.locator('.fit-client-lime.workout-create-edit-identity .workout-composer-card')
      const voice = composer.locator('.voice-input-button')
      await expect(page.locator('.page-back')).toHaveCSS('border-radius', '50%')
      await expect(page.locator('.workout-form-section').first()).toHaveCSS('border-radius', '32px')
      await expect(page.locator('.workout-form .field input').first()).toHaveCSS('border-radius', '16px')
      await expect(voice).toBeVisible()
      await expect(voice).toHaveCSS('border-radius', '999px')
      await expect(voice).toHaveCSS('min-height', '44px')
      await expect(composer.locator('.voice-input')).toHaveCSS('border-top-width', '0px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`client-workout-composer-${route.includes('edit') ? 'edit' : 'new'}-${theme}-${width}.png`) })
    }
  })
}


for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime composer is identical from home and workout list ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    const sizes: number[] = []
    for (const entry of ['home', 'list']) {
      await page.goto(entry === 'home' ? '/me' : '/me/workouts')
      if (entry === 'home') await page.getByRole('button', { name: 'Ввести текстом', exact: true }).click()
      else await page.getByRole('link', { name: 'Добавить', exact: true }).click()
      const input = page.getByLabel('Тренировка', { exact: true })
      await expect(input).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.load('400 16px "YS Geo"', 'Тренировка')
        await document.fonts.load('500 18px "YS Geo"', 'Новая тренировка')
        await document.fonts.ready
      })
      await expect(input).toHaveCSS('font-family', /YS Geo/)
      await expect(input).toHaveCSS('font-size', '16px')
      await expect(input).toHaveCSS('font-weight', '400')
      sizes.push((await page.locator('.today-text-fallback').boundingBox())!.height)
      await expect(input).toHaveAttribute('placeholder', 'Жим штанги лёжа 3×10 50 кг\nЖим гантелей сидя 3×10 30 кг\nПланка 3×1 мин')
      await expect(input).toHaveValue('')
      const voice = page.getByRole('button', { name: 'Надиктовать тренировку', exact: true })
      expect((await voice.boundingBox())!.y).toBeGreaterThanOrEqual((await input.boundingBox())!.y + (await input.boundingBox())!.height)
      await input.fill(Array.from({ length: 18 }, () => 'Жим гантелей сидя 3×10 30 кг').join('\n'))
      await expect(input).toHaveCSS('overflow-y', 'auto')
      expect((await input.boundingBox())!.height).toBe(264)
      await input.focus()
      await expect(input).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('button', { name: 'Очистить', exact: true }).click()
      await expect(input).toHaveValue('')
      expect((await input.boundingBox())!.height).toBe(144)

      await page.screenshot({ path: info.outputPath(`composer-${entry}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
    }
    expect(sizes[0]).toBe(sizes[1])
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) for (const hasWorkouts of [false, true]) {
  test(`Client Lime add workout opens compact composer ${theme} ${width} filled=${hasWorkouts}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: hasWorkouts ? [{ ...workout, createdBy: clientId, trainingFormat: 'self' }] : [] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me/workouts', { waitUntil: 'domcontentloaded' })
    const addWorkout = page.getByRole('link', { name: hasWorkouts ? 'Добавить' : 'Добавить тренировку', exact: true })
    await expect(addWorkout).toHaveCount(1)
    await expect(addWorkout).toHaveAttribute('href', '/me?entry=workout')
    await addWorkout.click()
    await expect(page).toHaveURL(/\/me\?entry=workout&draft=[\w-]+$/)
    await expect(page.getByLabel('Тренировка', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Надиктовать тренировку', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Разобрать тренировку', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Тип тренировки' })).toHaveCount(0)
    await expect(page.getByLabel('Дата', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`client-compact-workout-${theme}-${width}-${hasWorkouts ? 'filled' : 'empty'}.png`) })
    await page.getByLabel('Тренировка', { exact: true }).fill('Жим лёжа 3 по 10 80 кг')
    await expect.poll(() => page.evaluate((id) => {
      const draftId = new URLSearchParams(location.search).get('draft')
      const saved = localStorage.getItem(`fit.today-draft.${id}.plan.client-${draftId}`)
      return saved ? (JSON.parse(saved) as { text?: string }).text : null
    }, clientId)).toBe('Жим лёжа 3 по 10 80 кг')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Жим лёжа 3 по 10 80 кг')
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
    await expect(page).toHaveURL(/\/me$/)
  })
}

for (const width of [390, 430]) test(`Client Lime isolated drafts survive new input and deletion ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 })
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me')
  await page.evaluate((id) => localStorage.setItem(`fit.today-draft.${id}`, JSON.stringify({ screen: 'compose', text: 'Старый ввод: планка', choices: {}, items: [], clientId: id })), clientId)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Черновик плана' })).toHaveCount(1)
  const coachmark = page.getByRole('button', { name: 'Понятно', exact: true })
  if (await coachmark.isVisible()) await coachmark.click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('')
  await page.getByLabel('Тренировка', { exact: true }).fill('Новый ввод: приседания 10')
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
  const firstUrl = page.url()
  await page.reload()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Новый ввод: приседания 10')
  await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Черновик плана' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('')
  await page.getByLabel('Тренировка', { exact: true }).fill('Третий черновик')
  await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
  const old = page.getByRole('region', { name: 'Черновик плана' }).filter({ hasText: 'Старый ввод' })
  await old.getByRole('button', { name: 'Удалить черновик' }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Черновик плана' })).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath(`client-drafts-${width}.png`), fullPage: true })
  await page.goto(firstUrl)
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Новый ввод: приседания 10')
})

for (const width of [390, 430]) test(`Client Lime reviewed instances persist through reparse ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 })
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me')
  await page.evaluate((id) => {
    const item = { line: 'Жим лёжа 40 кг 10', exercise: { ref: 'bench-press', name: 'Жим лёжа', inputKind: 'strength' }, sets: [{ position: 0, weightKg: 40, reps: 10 }], hasValues: true }
    localStorage.setItem(`fit.today-draft.${id}.plan.client-reviewed`, JSON.stringify({ screen: 'review', text: 'Жим лёжа 40 кг 10\nЖим лёжа 40 кг 10', reviewedText: 'Жим лёжа 40 кг 10\nЖим лёжа 40 кг 10', choices: {}, items: [item, item], clientId: id }))
  }, clientId)
  await page.goto('/me?draft=reviewed&view=review')
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: 'Настройки упражнения «Жим лёжа»' }).first().click()
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(1)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: 'Настройки упражнения «Жим лёжа»' }).first().click()
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: '← Назад', exact: true }).click()
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.today-exercise')).toHaveCount(1)
  await page.getByRole('button', { name: '← Назад', exact: true }).click()
  await page.getByLabel('Тренировка', { exact: true }).fill('Другой текст')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Текст изменился')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.goto('/me?draft=reviewed&view=review')
  await expect(page.locator('.today-exercise')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`client-review-${width}.png`), fullPage: true })
})

async function mockClientStreamingVoice(page: import('@playwright/test').Page, transcript = 'Жим лёжа три подхода по десять 80 килограммов') {
  await page.addInitScript((recognizedText) => {
    const track = { stop() {} }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) } })
    class FakeAudioContext {
      sampleRate = 48_000
      destination = {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
      async close() {}
    }
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      binaryType = 'arraybuffer'
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor(url: string) { void url; window.setTimeout(() => this.onopen?.(), 0) }
      send(data: string | ArrayBuffer) {
        if (typeof data !== 'string') return
        const message = JSON.parse(data) as { type?: string }
        if (message.type === 'config') window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'partial', text: recognizedText.slice(0, 22) }) }), 20)
        if (message.type === 'stop') window.setTimeout(() => { this.onmessage?.({ data: JSON.stringify({ type: 'final', text: recognizedText }) }); this.onmessage?.({ data: JSON.stringify({ type: 'done' }) }) }, 20)
      }
      close() { this.readyState = 3 }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket })
  }, transcript)
}

test('Client Lime direct list entry keeps text through voice, review and save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const backend = await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
  await mockClientStreamingVoice(page, 'Приседания один подход десять повторений')
  await page.goto('/me?entry=workout')
  await expect(page).toHaveURL(/\/me\?entry=workout&draft=[\w-]+$/)
  const input = page.getByLabel('Тренировка', { exact: true })
  await input.fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(input).toHaveValue('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await page.getByRole('button', { name: /Остановить ·/ }).click()
  await expect(input).toHaveValue(/Жим лёжа[\s\S]*Присед/)
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
})

test('Client Lime compact voice permission denial preserves typed text', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
    })
  })
  await page.goto('/me?entry=workout')
  const input = page.getByLabel('Тренировка', { exact: true })
  await input.fill('Жим лёжа 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.getByText('Нет доступа к микрофону.', { exact: false })).toBeVisible()
  await expect(input).toHaveValue('Жим лёжа 40 кг')
})

test('Client Lime voice parsing exposes progress and retains failed transcript', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me')
  await mockClientStreamingVoice(page, 'Упражнение с необычным названием десять раз')
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/assistant/yandex/parse-workout', async (route) => {
    await pending
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"error":"unavailable"}' })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Слушаю…' })).toBeVisible()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Разбираю диктовку' })).toBeVisible()
  release?.()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Упражнение с необычным названием десять раз')
  await expect(page.getByRole('region', { name: 'Не нашли упражнение' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Упражнение с необычным названием десять раз')
})

for (const theme of ['light', 'dark']) test(`Client Lime confirmation failure retries without counting planned sets ${theme}`, async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page, { role: 'client', profileId: clientId, failFirstSetConfirm: true, workouts: [{ ...workout, createdBy: clientId, trainingFormat: 'self', exercises: [{
    id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps', position: 0,
    blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: [0, 1].map((position) => ({ id: `10000000-0000-4000-8000-00000000008${position + 2}`, position, reps: 8, fact: {}, confirmedAt: null, version: 1 })),
  }] }] })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.getByText('Готово 0 из 2', { exact: true })).toBeVisible()
  await expect(page.locator('.live-set-check:not(.done)').first()).toHaveText('Готово')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.getByText('Не удалось подтвердить подход. Нажмите «Повтор».')).toBeVisible()
  await expect(page.getByText('Готово 0 из 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.getByText('Готово 1 из 2', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Готово 1 из 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.getByText('Не подтверждено подходов: 1. Завершить тренировку?')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`client-live-partial-${theme}.png`) })
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByText('Выполнено 1 из 2 подходов')).toBeVisible()
})

for (const theme of ['light', 'dark']) test(`Client Lime voice to completion end-to-end ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: theme === 'light' ? 390 : 430, height: 844 })
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await mockPilot(page, { role: 'client', profileId: clientId })
  await mockClientStreamingVoice(page, 'Жим лёжа один подход десять повторений 40 килограммов')
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
  await page.goto('/me')
  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Слушаю…' })).toBeVisible()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByText('Править подходы', { exact: true }).click()
  await page.getByLabel(/: повторы, подход 1/).fill('9')
  await page.reload()
  await page.getByText('Править подходы', { exact: true }).click()
  await expect(page.getByLabel(/: повторы, подход 1/)).toHaveValue('9')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(page.getByText('Готово 1 из 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.getByText('Все подходы плана подтверждены и сохранены.')).toBeVisible()
  await expect(page.getByText('Выполнено 1 из 1 подходов')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`client-final-${theme}.png`), fullPage: true })
})

for (const theme of ['light', 'dark']) test(`Client Lime zero completion is neutral ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: theme === 'light' ? 390 : 430, height: 844 })
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, exercises: [{
    id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps', position: 0,
    blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, reps: 8, fact: {}, confirmedAt: null, version: 1 }],
  }] }] })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.getByText('Не подтверждено подходов: 1. Завершить тренировку?')).toBeVisible()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена', exact: true })).toBeVisible()
  await expect(page.getByText('Подходы не отмечены. Выполненный объём не записан.')).toBeVisible()
  await expect(page.getByText('Выполнено 0 из 1 подходов')).toBeVisible()
  await expect(page.locator('.workout-completion-report-art img')).toHaveCount(0)
  await expect(page.locator('.workout-completion-muscles-line')).toHaveCount(0)
  await expect(page.getByText('Новая ачивка', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath(`client-zero-${theme}.png`), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime tertiary actions and nested disclosures ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    const exercise: WorkoutExercise = {
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'strength', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, weightKg: 20, reps: 8, fact: { weightKg: 20, reps: 8 }, confirmedAt: '2026-09-24T10:50:00.000Z', version: 2 }],
    }
    await mockPilot(page, { role: 'client', profileId: clientId, withGoal: true, withMeasurements: true, clientGender: 'male', workouts: [{ ...workout, status: 'done', startedAt: '2026-09-24T10:00:00.000Z', completedAt: '2026-09-24T11:00:00.000Z', exercises: [exercise] }] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me')
    const latestWorkoutAction = page.locator('.personal-workout-result .actions .link').first()
    await expect(latestWorkoutAction).toHaveCSS('text-decoration-line', 'none')
    await expect(latestWorkoutAction).toHaveCSS('min-height', '44px')
    for (const selector of ['.body-progress-zone-picker', '.body-progress-meaning']) {
      const disclosure = page.locator(selector).first()
      const summary = disclosure.locator('summary')
      await summary.scrollIntoViewIfNeeded()
      await expect(summary).toHaveClass(/progress-details-toggle/)
      await expect(summary).toHaveCSS('text-decoration-line', 'none')
      await expect(summary.locator('svg')).toBeVisible()
      await summary.click()
      await expect(disclosure).toHaveAttribute('open', '')
      await page.screenshot({ path: testInfo.outputPath(`${selector.slice(1)}.png`) })
      await summary.click()
    }
    await page.goto('/me/progress')
    const history = page.getByRole('button', { name: /История замеров/ })
    await expect(history).toHaveCSS('text-decoration-line', 'none')
    await expect(history).toHaveCSS('min-height', '44px')
    await history.click()
    const entry = page.locator('.client-progress-history .card').first()
    await expect(entry.getByRole('button', { name: 'Изменить' })).toHaveCSS('min-height', '44px')
    const remove = entry.getByRole('button', { name: 'Удалить' })
    expect(await remove.evaluate((element) => getComputedStyle(element).color)).not.toBe(await history.evaluate((element) => getComputedStyle(element).color))
    await remove.click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('measurement-confirm.png') })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await entry.getByRole('button', { name: 'Изменить' }).click()
    await expect(entry.getByRole('button', { name: 'Сохранить замер', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('measurement-edit.png') })
    await entry.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('button', { name: 'Настроить показатели', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Новый показатель' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('measurement-metrics.png') })
    await page.goto('/me/goal')
    const goal = page.locator('.goal-block').first()
    await expect(goal.getByRole('button', { name: 'Изменить' })).toHaveCSS('min-height', '44px')
    await goal.getByRole('button', { name: 'Изменить' }).click()
    await expect(page.getByRole('textbox', { name: 'Цель', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('goal-edit.png') })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.locator('.stage-row').getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime catalog and support nested states ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/workouts/new')
    await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
    await expect(picker).toBeVisible()
    await expect(picker).toHaveCSS('background-color', theme === 'light' ? 'rgb(238, 240, 232)' : 'rgb(37, 37, 41)')
    await expect(picker).toHaveCSS('border-top-left-radius', '40px')
    await page.screenshot({ path: testInfo.outputPath('exercise-picker.png') })
    await picker.getByRole('button', { name: 'Фильтры', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Фильтры упражнений' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('exercise-filters.png') })
    await picker.getByRole('button', { name: 'Фильтры', exact: true }).click()
    await picker.getByLabel('Поиск упражнения').fill('присед со штангой')
    await picker.getByRole('button', { name: 'Проиграть технику: Присед со штангой', exact: true }).click()
    await picker.getByRole('button', { name: 'Открыть технику: Присед со штангой', exact: true }).click()
    await expect(picker.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('exercise-technique.png') })
    await picker.getByRole('button', { name: 'Назад к выбору' }).click()
    await picker.getByRole('button', { name: 'Создать упражнение' }).click()
    await expect(picker.getByRole('heading', { name: 'Своё упражнение' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('exercise-create.png') })
    await page.goto('/me/trainers')
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
    const filters = page.getByRole('dialog', { name: 'Фильтры тренеров' })
    await expect(filters).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('trainer-filters.png') })
    await filters.getByRole('button', { name: 'Закрыть фильтры' }).click()
    await page.goto('/me/settings')
    await page.getByRole('button', { name: 'Предложение или проблема' }).click()
    const form = page.getByRole('form', { name: 'Напишите команде Fit' })
    const suggestion = form.getByRole('button', { name: 'Предложение', exact: true })
    const problem = form.getByRole('button', { name: 'Проблема', exact: true })
    const background = async () => suggestion.evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.screenshot({ path: testInfo.outputPath('feedback-selection.png') })
    expect(await background()).not.toBe(await form.locator('.app-feedback-kinds').evaluate((element) => getComputedStyle(element).backgroundColor))
    await problem.click()
    await expect(problem).toHaveAttribute('aria-pressed', 'true')
    await expect(form.getByRole('button', { name: 'Отправить', exact: true })).toBeDisabled()
    await form.getByLabel('Сообщение', { exact: true }).fill('Тест интерфейса, данные только в фикстуре')
    let attempts = 0
    await page.route('**/v1/app-feedback', async (route) => {
      attempts += 1
      await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: attempts === 1 ? '{"error":"unavailable"}' : '{"feedback":{"id":"10000000-0000-4000-8000-000000000070"}}' })
    })
    await form.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(form.getByRole('alert')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('feedback-error.png') })
    await form.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Сообщение отправлено' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('feedback-success.png') })
    expect(attempts).toBe(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

const publicTrainerId = '10000000-0000-4000-8000-000000000060'
const publicTrainerDraft = {
  displayName: 'Тестовый тренер', bio: 'Анкета для проверки интерфейса без реальных пользовательских данных.',
  specialties: ['Тренажёрный зал / силовой тренинг'], city: 'Москва', metroStationIds: [], customLocations: ['Тестовый зал'],
  trainingModes: ['online', 'in_person'], experienceStartYear: 2020, education: 'Тестовое образование', formats: 'Индивидуальные занятия', price: 'По договорённости', acceptingClients: true,
  avatarDataUrl: null,
  photos: [0, 1].map((index) => ({ id: `10000000-0000-4000-8000-00000000006${index + 1}`, url: 'http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg', thumbnailUrl: 'http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg', mimeType: 'image/jpeg', width: 940, height: 1673 })),
  certificates: [{ title: 'Тестовый сертификат', organization: 'Фикстура', year: 2020 }],
}

async function mockPublicTrainer(page: Page) {
  await page.route(`**/v1/trainers/${publicTrainerId}/public-profile`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ publicId: publicTrainerId, draft: publicTrainerDraft, published: publicTrainerDraft, listedInCatalog: true, publishedAt: '2026-09-24T09:00:00.000Z', updatedAt: '2026-09-24T09:00:00.000Z', version: 1, isBrandTrainer: false }) }))
  await page.route('**/v1/trainers/catalog*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ publicId: publicTrainerId, profile: publicTrainerDraft, isBrandTrainer: false }], totalCount: 1, nextOffset: null }) }))
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime public context and photo portal ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId })
    await mockPublicTrainer(page)
    await page.route('**/v1/account-deletion-request', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supported: true, request: null }) }))
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me/trainers')
    await expect(page.getByRole('link', { name: 'Посмотреть анкету' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('catalog-filled.png') })
    await page.getByRole('link', { name: 'Посмотреть анкету' }).click()
    await expect(page.locator('.fit-client-lime-public')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/fit-client-lime-document/)
    await expect(page.locator('.trainer-card')).toContainText('Тестовый тренер')
    await expect(page.locator('.trainer-card')).toHaveCSS('border-radius', '32px')
    await page.getByText('Тестовый сертификат', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('public-trainer.png') })
    await page.getByRole('button', { name: 'Открыть фото тренера Тестовый тренер' }).click()
    const viewer = page.getByRole('dialog', { name: 'Фотографии тренера' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Уменьшить' }).locator('svg[data-icon="minus"]')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Уменьшить' })).toBeDisabled()
    await viewer.getByRole('button', { name: 'Увеличить' }).click()
    await expect(viewer.locator('.fullscreen-image-controls span')).toHaveText('150%')
    await viewer.getByRole('button', { name: 'Уменьшить' }).click()
    await expect(viewer.locator('.fullscreen-image-controls span')).toHaveText('100%')
    await page.screenshot({ path: testInfo.outputPath('photo-portal-before.png') })
    await expect(viewer.locator('.fullscreen-image-controls span')).toHaveCSS('font-family', /YS Geo/)
    await expect(viewer.getByRole('button', { name: 'Закрыть фото' })).toHaveCSS('border-radius', '999px')
    await expect(viewer.getByRole('button', { name: 'Закрыть фото' }).locator('svg[data-original-icon="close"]')).toHaveCSS('filter', theme === 'light' ? 'brightness(0)' : 'none')
    await viewer.getByRole('button', { name: 'Следующее фото' }).click()
    await expect(viewer.locator('.fullscreen-image-counter')).toHaveText('2 из 2')
    await viewer.getByRole('button', { name: 'Увеличить', exact: true }).click()
    await expect(viewer.locator('.fullscreen-image-controls span')).toHaveText('150%')
    await page.screenshot({ path: testInfo.outputPath('photo-portal.png') })
    await viewer.getByRole('button', { name: 'Закрыть фото' }).click()
    await expect(viewer).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.fit-client-lime-public')).toBeVisible()
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'light' ? '#f6f7f2' : '#000000')
    for (const route of ['/legal/terms', '/legal/privacy', '/legal/delete-account', '/invite']) {
      await page.goto(route)
      await expect(page.locator('.fit-client-lime-public')).toBeVisible()
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'light' ? '#f6f7f2' : '#000000')
      await expect(page.locator('.fit-client-lime-public')).toHaveCSS('font-family', /YS Geo/)
      if (route === '/legal/delete-account') {
        await page.getByRole('button', { name: 'Запросить удаление аккаунта' }).click()
        await expect(page.getByRole('alertdialog')).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath('account-deletion-confirm.png') })
        await page.getByRole('button', { name: 'Отмена', exact: true }).click()
      }
      if (route.startsWith('/legal/')) {
        await page.locator('.legal-footer-links').scrollIntoViewIfNeeded()
        await expect(page.locator('.legal-footer-links')).toBeVisible()
      }
      await page.screenshot({ path: testInfo.outputPath(`${route.split('/').at(-1)}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.goto('/me')
    await expect(page.locator('.client-tab-bar')).toBeVisible()
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime legal acceptance and valid invitation ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    let accepted = false
    let attempts = 0
    await page.route('**/v1/legal/acceptance', async (route) => {
      if (route.request().method() === 'PUT') {
        attempts++
        if (attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        accepted = true
        return route.fulfill({ contentType: 'application/json', body: '{"acceptedAt":"2026-10-06T10:00:00.000Z"}' })
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ applicable: true, accepted, acceptedAt: accepted ? '2026-10-06T10:00:00.000Z' : null }) })
    })
    await page.goto('/me')
    await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
    await expect(page.locator('.legal-gate-card')).toHaveCSS('border-radius', '32px')
    const accept = page.getByRole('button', { name: 'Принять и продолжить' })
    await expect(accept).toHaveCSS('border-radius', '999px')
    await accept.click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('legal-acceptance-error.png') })
    await accept.click()
    await expect(page.locator('.client-tab-bar')).toBeVisible()
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    await page.route('**/v1/invitation-links/preview', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ invitation: { inviterName: 'Тестовый тренер', targetRole: 'client', expiresAt: '2099-01-01T00:00:00.000Z', status: 'active' } }) }))
    let claims = 0
    await page.route('**/v1/invitation-links/claim', (route) => { claims++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clientId }) }) })
    await page.goto(`/invite?source=yandex&token=${token}`)
    const connect = page.getByRole('button', { name: 'Подключиться к тренеру' })
    await expect(connect).toHaveCSS('border-radius', '999px')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'light' ? '#f6f7f2' : '#000000')
    await page.screenshot({ path: testInfo.outputPath('valid-invitation.png') })
    await connect.click()
    await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
    expect(claims).toBe(1)
    await page.getByRole('button', { name: 'Открыть кабинет' }).click()
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.locator('.client-tab-bar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const kind of ['anonymous', 'other-client', 'trainer'] as const) {
  test(`Client Lime public routes exclude ${kind}`, async ({ page }) => {
    await mockPilot(page, { role: kind === 'trainer' ? 'trainer' : 'client', profileId: kind === 'other-client' ? '10000000-0000-4000-8000-000000000010' : kind === 'trainer' ? trainerId : clientId, fitLime: kind === 'trainer' })
    if (kind === 'anonymous') await page.addInitScript(() => localStorage.removeItem('fit.yandexAppSession.v1'))
    await page.addInitScript((id) => localStorage.setItem(`fit.clientLime.theme.${id}`, 'dark'), clientId)
    await mockPublicTrainer(page)
    for (const route of ['/legal/privacy', `/trainers/${publicTrainerId}`, '/invite']) {
      await page.goto(route)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expect(page.locator('.fit-client-lime')).toHaveCount(0)
      await expect(page.locator('html')).not.toHaveClass(/fit-client-lime-document/)
    }
  })
}

for (const withTrainer of [false, true]) for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime first run and trainer connection ${withTrainer ? 'connected' : 'independent'} ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, clientTrainerId: withTrainer ? trainerId : clientId, workouts: [] })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.route('**/v1/connections', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ memberships: withTrainer ? [{ clientId, trainerId, firstName: 'Тестовый тренер', lastName: null, joinedAt: '2026-09-01T00:00:00.000Z', isRoot: true }] : [], invitations: [] }) }))
    await page.goto('/me')
    await expect(page.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
    const invitation = page.getByRole('link', { name: 'Подключиться по приглашению' })
    if (withTrainer) await expect(invitation).toHaveCount(0)
    else await invitation.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('first-run.png') })
    await page.goto('/me/profile')
    const connections = page.getByRole('region', { name: 'Связь с тренером' })
    if (withTrainer) {
      await expect(connections).toContainText('Основной тренер')
      await connections.getByRole('button', { name: 'Действия с тренером Тестовый тренер' }).click()
      await page.getByRole('menuitem', { name: 'Отключить' }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('trainer-disconnect-confirm.png') })
      await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    } else {
      await expect(connections).toContainText('Найдите своего тренера')
      const find = connections.getByRole('link', { name: 'Найти тренера' })
      await expect(find).toHaveCSS('border-radius', '999px')
      await find.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('independent-profile.png') })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime filled finance assistant and chat media ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-10-06T12:00:00+03:00'))
    await mockPilot(page, { role: 'client', profileId: clientId })
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    let financeFailure = true
    const packageId = '10000000-0000-4000-8000-000000000090'
    await page.route('**/v1/me/finance', (route) => route.fulfill(financeFailure
      ? { status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }
      : { contentType: 'application/json', body: JSON.stringify({ finance: { trainers: [{ trainerId, trainerName: 'Тестовый тренер', packages: [{ id: packageId, kind: 'session_pack', title: 'Персональные тренировки с длинным названием услуги', sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, startsOn: '2026-10-01', endsOn: '2026-11-01', paymentDueOn: '2026-10-10', packageStatus: 'active', paymentStatus: 'partial' }], payments: [{ id: '10000000-0000-4000-8000-000000000091', packageId, amountCents: 1000000, receivedOn: '2026-10-01' }] }] } }) }))
    await page.goto('/me/finance')
    await expect(page.locator('.state-panel-error')).toBeVisible()
    financeFailure = false
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    const service = page.locator('.client-finance-package')
    await expect(service).toContainText('8 из 10')
    await expect(service).toHaveCSS('border-radius', '32px')
    await page.getByRole('heading', { name: 'Оплаты', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('finance-filled.png'), fullPage: true })

    let attempts = 0
    await page.route('**/v1/assistant/turn', (route) => {
      attempts++
      return route.fulfill(attempts === 1
        ? { status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }
        : { contentType: 'application/json', body: JSON.stringify({ reply: 'Продолжайте тренировки по плану. Проверенный тестовый ответ.', action: null }) })
    })
    await page.goto('/assistant')
    const composer = page.getByRole('textbox', { name: 'Сообщение ассистенту' })
    await expect(composer).toBeEnabled()
    await composer.fill('Как идёт мой прогресс?')
    await page.getByRole('button', { name: 'Отправить сообщение' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('assistant-error.png') })
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.getByText('Продолжайте тренировки по плану. Проверенный тестовый ответ.')).toBeVisible()
    expect(attempts).toBe(2)
    await expect(composer).toHaveCSS('font-family', /YS Geo/)
    await page.screenshot({ path: testInfo.outputPath('assistant-filled.png') })

    const programPayload = {
      programPilot: true, step: 'confirm', clientId, clientName: 'Тестовый клиент',
      goal: 'Регулярные тренировки', briefState: { scope: 'single_workout', weeks: 1, frequency: 1, durationMin: 30 },
      editableCatalog: [{ ref: 'squat', name: 'Приседания', inputKind: 'reps' }],
      modelInputJson: { fixture: true }, modelOutputJson: { fixture: true },
      canonicalWorkouts: [{ requestId: '10000000-0000-4000-8000-000000000093', clientId, workoutDate: '2026-10-07', exercises: [{ name: 'Приседания', restBetweenSetsSec: 90, sets: [{ reps: 10, rpe: 6 }] }] }],
    }
    await page.route('**/v1/assistant/turn', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Готова рекомендация к тренировке.', action: { tool: 'create_program_draft', status: 'proposed', title: 'Одна тренировка', description: 'Проверьте тренировку', payload: programPayload } }) }))
    await composer.fill('Составь одну тренировку')
    await page.getByRole('button', { name: 'Отправить сообщение' }).click()
    await expect(page.locator('.assistant-program-card')).toBeVisible()
    await page.locator('.assistant-program-sessions summary').click()
    await expect(page.locator('.assistant-program-sessions')).toContainText('Приседания')
    const addProgram = page.getByRole('button', { name: 'Добавить в расписание', exact: true })
    await addProgram.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('assistant-program-before.png') })
    await expect(addProgram).toHaveCSS('border-radius', '999px')
    await page.screenshot({ path: testInfo.outputPath('assistant-program-result.png') })
    await page.locator('.assistant-program-sessions').getByRole('button', { name: 'Изменить', exact: true }).click()
    const editProgram = page.getByRole('region', { name: 'Изменение упражнения' })
    await expect(editProgram).toBeVisible()
    await expect(editProgram.getByRole('button', { name: 'Проверить изменение' })).toHaveCSS('border-radius', '999px')
    await editProgram.locator('input').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('assistant-program-fields.png') })
    await expect(editProgram.locator('input').first()).toHaveCSS('border-radius', '16px')
    await expect(editProgram.getByRole('combobox', { name: 'Область изменения' })).toHaveCSS('min-height', '48px')
    await page.getByRole('button', { name: 'Закрыть правку' }).click()
    if (process.env.VITE_ASSISTANT_PROGRAM_ENABLED === 'true') {
      await page.getByRole('button', { name: 'Оставить обратную связь', exact: true }).click()
      await page.getByRole('button', { name: 'Что-то не так', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Отправить отзыв', exact: true })).toBeDisabled()
      await page.getByRole('textbox', { name: 'Комментарий к программе' }).fill('Тестовая проверка формы')
      await expect(page.getByRole('button', { name: 'Отправить отзыв', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Отправить отзыв', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: 'Отправить отзыв', exact: true })).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath('program-feedback.png') })
      await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    const summaryResult = {
      status: 'applied', summaryId: '10000000-0000-4000-8000-000000000094', clientId, clientName: 'Тестовый клиент',
      periodStart: '2026-09-01', periodEnd: '2026-09-30', periodLabel: 'Последний месяц',
      trainer: { headline: 'Темп стал стабильнее', progress: ['Жим растёт'], consistency: 'Две тренировки в неделю', attention: ['Следить за плечом'] },
      metrics: { completedWorkouts: 6, workoutsPerWeek: 1.5, activeWeeks: 4 },
    }
    await page.route('**/v1/assistant/turn', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Готова сводка прогресса.', action: { tool: 'summarize_progress', status: 'proposed', lifecycleStatus: 'applied', title: 'Сводка прогресса', description: 'Проверенная тестовая сводка', payload: {}, result: summaryResult } }) }))
    await composer.fill('Покажи сводку прогресса')
    await page.getByRole('button', { name: 'Отправить сообщение' }).click()
    const saveSummary = page.getByRole('button', { name: 'Сохранить в прогресс', exact: true })
    await saveSummary.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('assistant-summary.png') })
    await expect(saveSummary).toHaveCSS('border-radius', '999px')

    await page.route(`**/v1/chat/conversations/${conversationId}/messages*`, (route) => route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ messages: [{ id: messageId, conversationId, senderId: trainerId, body: 'Тестовое фото', createdAt: '2026-10-06T09:00:00.000Z', editedAt: null, replyTo: null, image: { url: 'http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg', mimeType: 'image/jpeg', width: 600, height: 800, sizeBytes: 10000 } }], nextCursor: null }) })
      : route.fallback())
    await page.goto(`/chat/${conversationId}`)
    await page.getByRole('button', { name: 'Открыть фото', exact: true }).click()
    await expect(page.locator('.fullscreen-image-viewer')).toBeVisible()
    await expect(page.locator('.fullscreen-image-viewer')).toHaveCSS('font-family', /YS Geo/)
    await expect(page.getByRole('button', { name: 'Закрыть фото', exact: true }).locator('svg[data-original-icon="close"]')).toHaveCSS('filter', theme === 'light' ? 'brightness(0)' : 'none')
    await page.screenshot({ path: testInfo.outputPath('chat-photo-portal.png') })
    await page.getByRole('button', { name: 'Закрыть фото', exact: true }).click()
    await expect(page.locator('.fullscreen-image-viewer')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [390, 430]) {
  test(`Client Lime assistant program choices remain visible on the real route at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId })
    await page.addInitScript((id) => localStorage.setItem(`fit.clientLime.theme.${id}`, 'dark'), clientId)
    await page.route('**/v1/assistant/turn', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      reply: 'Подготовлю рекомендованный черновик одной тренировки или программы на 1–4 недели. Что составить?',
      action: { tool: 'create_program_draft', status: 'needs_input', title: 'Программа тренировок',
        description: 'Уточняю условия', payload: { programPilot: true, step: 'brief', briefStatus: 'needs_answers',
          clientId, clientName: 'Тестовый клиент', answerSuggestions: ['Одна тренировка', 'Программа на 4 недели'], readyToGenerate: false } },
    }) }))
    await page.goto('/assistant')
    await page.getByRole('textbox', { name: 'Сообщение ассистенту' }).fill('Составь программу тренировок')
    await page.getByRole('button', { name: 'Отправить сообщение' }).click()
    const context = page.getByRole('region', { name: 'Текущий контекст ассистента' })
    const choices = context.locator('.assistant-choice-chips button')
    const cancel = context.getByRole('button', { name: 'Отменить' })
    await expect(choices).toHaveCount(2)
    await expect(cancel).toBeVisible()
    await expect(context).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const contextBox = await context.boundingBox()
    const cancelBox = await cancel.boundingBox()
    expect(contextBox!.height).toBeLessThanOrEqual(110)
    expect(cancelBox!.x).toBeGreaterThanOrEqual(contextBox!.x)
    expect(cancelBox!.y + cancelBox!.height).toBeLessThanOrEqual(contextBox!.y + contextBox!.height + 1)
    await expect(page.getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('client-program-choices-real-route.png') })
  })
}

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime filled progress analysis and compact goal ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    const checkedExercise: WorkoutExercise = {
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'strength', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, weightKg: 20, reps: 8, fact: { weightKg: 20, reps: 8 }, confirmedAt: '2026-09-24T08:00:00.000Z', version: 2 }],
    }
    await mockPilot(page, { role: 'client', profileId: clientId, clientGender: 'male', withGoal: true, withMeasurements: true, workouts: [
      { ...workout, workoutDate: '2026-09-24', status: 'done', completedAt: '2026-09-24T08:00:00.000Z', exercises: [checkedExercise] },
      { ...workout, id: newWorkoutId, workoutDate: '2026-08-01', status: 'done', completedAt: '2026-08-01T08:00:00.000Z', exercises: [{ ...checkedExercise, sets: [{ ...checkedExercise.sets[0]!, weightKg: 15, fact: { weightKg: 15, reps: 8 }, confirmedAt: '2026-08-01T08:00:00.000Z' }] }] },
    ] })
    await page.route(`http://127.0.0.1:4100/v1/clients/${clientId}/training-summaries`, (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ summaries: [{
        id: '10000000-0000-4000-8000-000000000090', source_summary_id: '10000000-0000-4000-8000-000000000091', client_id: clientId,
        period_start: '2026-08-24', period_end: '2026-09-23', generated_at: '2026-09-23T08:00:00.000Z', published_at: '2026-09-23T08:05:00.000Z',
        summary: { headline: 'Тренировки стали регулярнее.', achievements: [], consistency: 'За период завершено 12 тренировок; средний ритм — 2,7 в неделю.', encouragement: 'Продолжай в том же ритме.' },
        display_metrics: { completed_workouts: 12, workouts_per_week: 2.7, active_weeks: 4, longest_gap_days: 3 },
      }] }),
    }))
    await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
    await page.goto('/me/progress')
    await expect(page.locator('.period-exercise-result h4').first()).toHaveCSS('font-weight', '500')
    const analysis = page.locator('.progress-analysis-preview')
    const goal = page.locator('.progress-overview-panel .client-progress-goal-story')
    await expect(analysis).toContainText('Предыдущий ИИ-анализ')
    await expect(analysis).toContainText('Есть новые тренировки')
    await goal.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`filled-progress-${theme}-${width}.png`) })
    await expect(analysis).toHaveCSS('border-radius', '32px')
    await expect(goal).toHaveCSS('border-radius', '32px')
    await expect(analysis.getByRole('button', { name: 'Обновить анализ' })).toHaveCSS('font-size', '14px')
    await expect(goal.getByRole('link', { name: 'Изменить цель' })).toHaveCSS('min-height', '44px')
    const styles = await page.locator('.progress-analysis-preview, .progress-analysis-actions button, .client-progress-goal-story.compact, .client-progress-goal-story.compact .link').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      return { element: element.getAttribute('class'), text: element.textContent?.slice(0, 40), radius: style.borderRadius, height: style.minHeight, font: style.fontFamily, weight: style.fontWeight, size: style.fontSize, background: style.backgroundColor }
    }))
    await testInfo.attach('filled-progress-styles', { body: JSON.stringify(styles, null, 2), contentType: 'application/json' })
    await analysis.getByRole('button', { name: 'Открыть анализ' }).click()
    await expect(page.getByRole('dialog')).toContainText('Подробный анализ')
    await expect(page.getByRole('dialog')).toHaveCSS('border-top-left-radius', '40px')
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true })).toHaveCSS('border-radius', '50%')
    await page.screenshot({ path: testInfo.outputPath(`filled-analysis-dialog-${theme}-${width}.png`) })
    await testInfo.attach('filled-analysis-sheet-styles', { body: JSON.stringify(await page.locator('.ai-progress-sheet, .ai-progress-sheet .picker-close').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      return { element: element.getAttribute('class'), radius: style.borderRadius, height: style.minHeight, font: style.fontFamily, size: style.fontSize }
    }))), contentType: 'application/json' })
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    let releaseGeneration: () => void = () => undefined
    let generationRequests = 0
    const pendingGeneration = new Promise<void>((resolve) => { releaseGeneration = resolve })
    await page.route(`http://127.0.0.1:4100/v1/clients/${clientId}/training-summaries/generate`, async (route) => {
      generationRequests += 1
      await pendingGeneration
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    })
    const refresh = analysis.getByRole('button', { name: 'Обновить анализ' })
    await refresh.click()
    await expect(refresh).toBeDisabled()
    await expect(analysis.getByRole('status')).toHaveText('Формируем ИИ-анализ…')
    releaseGeneration()
    await expect(analysis.getByRole('alert')).toBeVisible()
    await expect(analysis.getByRole('alert')).toHaveCSS('border-radius', '32px')
    await expect(refresh).toBeEnabled()
    await expect(analysis.getByRole('alert').getByRole('button', { name: 'Повторить' })).toBeVisible()
    await analysis.getByRole('alert').getByRole('button', { name: 'Повторить' }).click()
    await expect.poll(() => generationRequests).toBe(2)
    await expect(analysis.getByRole('alert')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`filled-progress-error-${theme}-${width}.png`) })
    await goal.getByRole('link', { name: 'Подробнее в ПРО' }).click()
    await expect(page.getByRole('tab', { name: 'ПРО' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#goal-details')).toHaveAttribute('open', '')
    const summaries = page.locator('.progress-pro-list > details > summary.progress-details-toggle')
    await expect(summaries).toHaveCount(7)
    for (const summary of await summaries.all()) await expect(summary).toHaveCSS('border-radius', '32px')
    for (const [index, summary] of (await summaries.all()).entries()) {
      const panel = summary.locator('..')
      if (!(await panel.evaluate((element) => element.hasAttribute('open')))) await summary.click()
      await expect(panel).toHaveAttribute('open', '')
      await summary.scrollIntoViewIfNeeded()
      await page.locator('.content').evaluate((element) => { element.scrollTop = Math.max(0, element.scrollTop - 12) })
      const figureSources = await panel.locator('.body-progress-figure-image').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')!).filter(Boolean))
      await page.evaluate(async (sources) => { for (const source of sources) { const picture = new Image(); picture.src = source; await picture.decode() } }, figureSources)
      await page.screenshot({ path: testInfo.outputPath(`pro-section-${index + 1}-${theme}-${width}.png`) })
      let scrollSteps = 0
      while (await panel.evaluate((element) => {
        const content = document.querySelector('.content')!.getBoundingClientRect()
        const nav = document.querySelector('.client-tab-bar')!.getBoundingClientRect()
        return element.getBoundingClientRect().bottom > Math.min(content.bottom, nav.top) - 4
      })) {
        expect(scrollSteps).toBeLessThan(20)
        const moved = await page.locator('.content').evaluate((element) => {
          const content = element.getBoundingClientRect()
          const nav = document.querySelector('.client-tab-bar')!.getBoundingClientRect()
          const before = element.scrollTop
          element.scrollTop += Math.max(100, Math.floor((Math.min(content.bottom, nav.top) - Math.max(0, content.top)) * 0.7))
          return element.scrollTop > before
        })
        expect(moved).toBe(true)
        scrollSteps += 1
        await page.screenshot({ path: testInfo.outputPath(`pro-section-${index + 1}-scroll-${scrollSteps}-${theme}-${width}.png`) })
      }
      await testInfo.attach(`pro-section-${index + 1}-coverage`, { body: JSON.stringify({ title: await summary.innerText(), scrollSteps, bottomShown: true }), contentType: 'application/json' })
    }
    const results = page.locator('.client-results-center')
    const exerciseFilter = results.getByRole('combobox', { name: 'Упражнение', exact: true })
    const metricFilter = results.getByRole('combobox', { name: 'Показатель', exact: true })
    for (const field of [exerciseFilter, metricFilter]) {
      await expect(field).toHaveCSS('border-radius', '16px')
      await expect(field).toHaveCSS('min-height', '48px')
      await expect(field).toHaveCSS('font-family', /YS Geo/)
      await expect(field).toHaveCSS('background-color', await page.locator('.phone-frame').evaluate((element) => (() => { const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--lime-surface-raised)'; element.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color })()))
    }
    await expect(results.locator('.center-result-row')).toHaveCount(3)
    await exerciseFilter.selectOption({ label: 'Приседания' })
    await metricFilter.selectOption('weight')
    await expect(results.locator('.center-result-row')).toHaveCount(1)
    await expect(results.locator('.center-result-row')).toContainText('Максимальный вес: 20 кг')
    expect(new URL(page.url()).searchParams.get('resultMetric')).toBe('weight')
    expect(new URL(page.url()).searchParams.get('resultExercise')).toBeTruthy()
    await metricFilter.selectOption('distance')
    await expect(results).toContainText('Нет результатов.')
    await exerciseFilter.selectOption('')
    await metricFilter.selectOption('')
    await expect(results.locator('.center-result-row')).toHaveCount(3)
    expect(new URL(page.url()).searchParams.has('resultExercise')).toBe(false)
    expect(new URL(page.url()).searchParams.has('resultMetric')).toBe(false)
    await results.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`results-fields-${theme}-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const modes = page.locator('.client-body-map-disclosure .body-progress-modes')
    await modes.scrollIntoViewIfNeeded()
    await testInfo.attach('body-mode-styles', { body: JSON.stringify(await modes.evaluate((element) => ({
      radius: getComputedStyle(element).borderRadius,
      oldSurface: getComputedStyle(element, '::before').content,
      oldSurfaceRadius: getComputedStyle(element, '::before').borderRadius,
      selectedRadius: getComputedStyle(element.querySelector('[aria-pressed="true"]')!, '::before').borderRadius,
    }))), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath(`body-modes-${theme}-${width}.png`) })
    await expect(modes).toHaveCSS('border-radius', '28px')
    expect(await modes.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none')
    for (const name of ['Прогресс', 'Нагрузка']) {
      const button = modes.getByRole('button', { name, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(button).toHaveCSS('min-height', '44px')
      await expect(button).toHaveCSS('border-radius', '24px')
      await expect(button).toHaveCSS('background-color', await page.locator('.ai-progress-periods button.active').evaluate((element) => getComputedStyle(element).backgroundColor))
      expect(await button.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none')
    }
    await expect(page.locator('.progress-pro-panel .client-progress-goal-story')).toHaveCSS('border-radius', '0px')
    await page.screenshot({ path: testInfo.outputPath(`filled-progress-pro-${theme}-${width}.png`) })
    await testInfo.attach('filled-pro-surfaces', { body: JSON.stringify(await page.locator('.progress-pro-list > details > summary, .progress-pro-panel .client-progress-goal-story').evaluateAll((elements) => elements.map((element) => ({ element: element.getAttribute('class'), radius: getComputedStyle(element).borderRadius })))), contentType: 'application/json' })
    await page.locator('.content').evaluate((element) => { element.scrollTop = element.scrollHeight })
    const clearance = await page.locator('.weekly-training-load').evaluate((element) => {
      const nav = document.querySelector('.client-tab-bar')!.getBoundingClientRect()
      return nav.top - element.getBoundingClientRect().bottom
    })
    expect(clearance).toBeGreaterThanOrEqual(16)
  })
}

test('Client progress outside the Lime pilot retains its original surfaces', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: '10000000-0000-4000-8000-000000000009', withGoal: true })
  await page.goto('/me/progress')
  await expect(page.locator('.fit-client-lime')).toHaveCount(0)
  await expect(page.locator('.progress-analysis-preview')).toHaveCSS('border-radius', '18px')
  await expect(page.locator('.progress-overview-panel .client-progress-goal-story')).toHaveCSS('border-radius', '18px')
  await page.getByRole('tab', { name: 'ПРО' }).click()
  await page.locator('.client-results-center > summary').click()
  for (const field of await page.locator('.results-center-filters select').all()) {
    await expect(field).toHaveCSS('min-height', '44px')
    await expect(field).not.toHaveCSS('border-radius', '16px')
  }
  await page.locator('.client-body-map-disclosure > summary').click()
  await expect(page.locator('.body-progress-modes')).toBeVisible()
  expect(await page.locator('.body-progress-modes').evaluate((element) => getComputedStyle(element, '::before').borderRadius)).toBe('9px')
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime segments keep one geometry and visible body-map selection ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'))
    const source = restTimerWorkout()
    source.exercises[0]!.sets[0]!.fact = { weightKg: 20, reps: 10 }
    source.exercises[0]!.sets[0]!.confirmedAt = '2026-10-08T08:30:00Z'
    await mockPilot(page, { role: 'client', profileId: clientId, clientGender: 'male', workouts: [{ ...source, status: 'done', workoutDate: '2026-10-08', completedAt: '2026-10-08T09:00:00Z' }] })
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem(`fit.today-draft.${id}.plan.client-segments`, JSON.stringify({ screen: 'save', text: 'Приседания 2×10', choices: {}, clientId: id,
        items: [{ line: 'Приседания', exercise: { ref: 'squat', name: 'Приседания', inputKind: 'strength' }, sets: [{ position: 0, reps: 10 }], hasValues: true }], recordMode: 'planned', workoutDate: '2026-10-08' }))
    }, { id: clientId, theme })
    await page.goto('/me/settings')
    const options = page.locator('.body-map-appearance-options')
    await expect(options.getByRole('radio')).toHaveCount(2)
    for (const name of ['Список', 'Фигура']) {
      await options.getByRole('radio', { name, exact: true }).click()
      await page.getByRole('heading').first().click()
      await expect(options.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true')
      const metrics = await options.evaluate((element) => {
        const selected = element.querySelector('[aria-checked="true"]')!
        return { background: getComputedStyle(element).backgroundColor, selected: getComputedStyle(selected).backgroundColor, outer: getComputedStyle(element).borderRadius, inner: getComputedStyle(selected).borderRadius }
      })
      await info.attach(`body-selection-${name}`, { body: JSON.stringify(metrics), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath(`body-selection-${name}.png`), fullPage: true })
      expect(metrics.selected).not.toBe(metrics.background)
      expect(metrics.outer).toBe('28px'); expect(metrics.inner).toBe('24px')
      await page.reload()
      await expect(options.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true')
      await page.goto('/me/progress')
      await page.getByRole('tab', { name: 'ПРО', exact: true }).click()
      await page.locator('.client-body-map-disclosure > summary').click()
      const panel = page.locator('.client-body-map-disclosure .body-progress-panel')
      await expect(panel).toBeVisible()
      if (name === 'Список') await expect(panel).toHaveClass(/is-list/)
      else await expect(panel.locator('.body-progress-figure-shell')).toBeVisible()
      await page.goto('/me/settings')
      await expect(options.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true')
    }
    await page.goto('/me/workouts')
    const history = page.locator('.client-history-view-toggle')
    await expect(history).toHaveCSS('border-radius', '28px')
    for (const name of ['Календарь', 'Список']) {
      const button = history.getByRole('button', { name, exact: true })
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(button).toHaveCSS('border-radius', '24px')
    }
    await page.screenshot({ path: info.outputPath('history-segments.png') })
    await page.goto('/me?draft=segments&view=save')
    const mode = page.locator('.today-record-mode')
    await expect(mode).toHaveCSS('border-radius', '28px')
    for (const name of ['Записать выполненную', 'Запланировать']) {
      const button = mode.getByRole('button', { name, exact: true })
      await button.click(); await expect(button).toHaveClass(/active/)
      await expect(button).toHaveCSS('border-radius', '24px')
    }
    await page.screenshot({ path: info.outputPath('save-segments.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const theme of ['light', 'dark']) for (const role of ['client', 'trainer'] as const) {
  if (role === 'trainer' && theme === 'light') continue
  test(`Filled body-map modes preserve client and trainer scope ${role} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 430, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    const exercise: WorkoutExercise = {
      id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'strength', position: 0,
      blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, weightKg: 20, reps: 8, fact: { weightKg: 20, reps: 8 }, confirmedAt: '2026-09-24T08:00:00.000Z', version: 2 }],
    }
    await mockPilot(page, { role, profileId: role === 'client' ? clientId : trainerId, clientGender: 'male', fitLime: true,
      workouts: [{ ...workout, status: 'done', startedAt: '2026-09-24T07:00:00.000Z', completedAt: '2026-09-24T08:00:00.000Z', exercises: [exercise] }] })
    await page.route(`http://127.0.0.1:4100/v1/clients/${clientId}/training-summaries*`, (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ summaries: [{
        id: '10000000-0000-4000-8000-000000000090', source_summary_id: '10000000-0000-4000-8000-000000000091', client_id: clientId,
        period_start: '2026-08-25', period_end: '2026-09-24', generated_at: '2026-09-24T09:00:00.000Z', published_at: '2026-09-24T09:00:00.000Z',
        summary: { headline: 'Тренировка сохранена.', achievements: [], consistency: 'Одна тренировка.', encouragement: 'Продолжай.' },
        trainer_summary: { headline: 'Тренировка сохранена.', progress: [], consistency: 'Одна тренировка.', attention: [] },
        client_summary: { headline: 'Тренировка сохранена.', achievements: [], consistency: 'Одна тренировка.', encouragement: 'Продолжай.' },
        version: 1, published: true,
        display_metrics: { completed_workouts: 1, workouts_per_week: 1, active_weeks: 1, longest_gap_days: 0 },
      }] }),
    }))
    await page.addInitScript(({ id, theme, role }) => localStorage.setItem(role === 'client' ? `fit.clientLime.theme.${id}` : 'fit.appTheme', theme), { id: role === 'client' ? clientId : trainerId, theme, role })
    await page.goto(role === 'client' ? '/me/progress' : `/progress/${clientId}`)
    if (role === 'client') {
      await page.getByRole('tab', { name: 'ПРО' }).click()
      await page.locator('.client-body-map-disclosure > summary').click()
    }
    const modes = page.locator('.body-progress-modes')
    await expect(modes).toBeVisible()
    if (theme === 'light') await expect(page.locator('.phone-frame')).toHaveClass(/theme-light/)
    else await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
    const load = modes.getByRole('button', { name: 'Нагрузка', exact: true })
    await load.click()
    await expect(load).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.body-progress-region-load').first()).toBeVisible()
    if (role === 'client') {
      await expect(modes).toHaveCSS('border-radius', '28px')
      await expect(load).toHaveCSS('border-radius', '24px')
      expect(await modes.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none')
    } else {
      await expect(page.locator('.fit-client-lime')).toHaveCount(0)
      expect(await modes.evaluate((element) => getComputedStyle(element, '::before').borderRadius)).toBe('9px')
      expect(await load.evaluate((element) => getComputedStyle(element, '::before').borderRadius)).toBe('7px')
    }
    await modes.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`body-modes-filled-${role}-${theme}.png`) })
  })
}

for(const theme of ['light','dark']) for(const width of [390,430]) test('Client Lime InBody disclosures preserve review and retry '+theme+' '+width,async({page},testInfo)=>{
 await page.setViewportSize({width,height:844});
 await mockPilot(page,{role:'client',profileId:clientId,withMeasurements:true});
 await page.addInitScript(({id,theme})=>localStorage.setItem('fit.clientLime.theme.'+id,theme),{id:clientId,theme});
 let attempt=0, release:()=>void=()=>{}; let hold=false;
 await page.route('https://functions.yandexcloud.net/d4eerma5vk3fqtahbbea',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,authorization'}});return;}
  attempt++; if(hold) await new Promise<void>(r=>{release=r});
  await route.fulfill({status:attempt===1?422:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:attempt===1?'{}':JSON.stringify({recordedOn:'2026-09-24',weightKg:70,inBody:{schemaVersion:1,bodyFatPercent:18,skeletalMuscleMassKg:32,deviceModel:'Test InBody',waistHipRatio:0.85,phaseAngleDeg:5.1},recognizedFieldCount:5,warnings:['Проверьте значения перед сохранением.']})});
 });
 await page.goto('/me/progress'); await expect(page.locator('.inbody-import')).toBeVisible();
 const upload=()=>page.locator('.inbody-import input[type=file]').setInputFiles({name:'inbody-test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAAG4CAIAAAC7M6mJAAAFEUlEQVR4nO3TMQ0AIBDAQMC/3d/xwEKa3Cno0j0zC2g6vwOAdwaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCsrgtMLQZPVLE0hgAAAABJRU5ErkJggg==','base64')});
 await upload();await expect(page.locator('.inbody-import-error')).toBeVisible();await page.screenshot({path:testInfo.outputPath('inbody-error.png')});
 hold=true;await upload();await expect(page.getByRole('button',{name:'Распознаём отчёт…'})).toBeDisabled();await page.screenshot({path:testInfo.outputPath('inbody-loading.png')});release();
 await expect(page.locator('.inbody-import-result')).toBeVisible();await page.screenshot({path:testInfo.outputPath('inbody-result.png')});
 await page.getByRole('button',{name:'Проверить и сохранить'}).click();const toggle=page.locator('.client-progress-form .inbody-details summary');await expect(toggle).toHaveClass('progress-details-toggle');await expect(toggle).toHaveCSS('min-height','48px');await toggle.focus();await expect(toggle).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('.client-progress-form .inbody-details')).toHaveAttribute('open','');await page.screenshot({path:testInfo.outputPath('inbody-review-details.png')});
 const form=page.locator('.client-progress-form');await form.getByRole('button',{name:'Отмена'}).click();
 await page.getByRole('button',{name:'Настроить показатели'}).click();await page.screenshot({path:testInfo.outputPath('metrics-form.png')});
});


for(const pilot of [true,false]) test(`Client InBody card and history scope ${pilot ? 'lime' : 'original'}`,async({page})=>{
 await mockPilot(page,{role:'client',profileId:clientId,clientLime:pilot,withMeasurements:true});
 const entries=[24,23].map((day,i)=>({id:`10000000-0000-4000-8000-00000000005${i}`,clientId,createdBy:clientId,recordedOn:`2026-09-${day}`,weightKg:70-i,chestCm:null,waistCm:null,hipCm:null,notes:null,customMetrics:[],version:1,inBody:{schemaVersion:1,skeletalMuscleMassKg:32,bodyFatPercent:18}}));
 await page.route(`http://127.0.0.1:4100/v1/clients/${clientId}/progress`,r=>r.fulfill({contentType:'application/json',body:JSON.stringify({entries,customMetrics:[],goal:null})}));
 await page.goto('/me/progress');
 const card=page.locator('.inbody-progress-card .inbody-details summary');await expect(card).toBeVisible();
 if(pilot){await expect(card).toHaveClass('progress-details-toggle');await expect(card).toHaveCSS('min-height','48px');}else{await expect(card).not.toHaveClass('progress-details-toggle');await expect(card.locator('svg')).toHaveCount(0);}
 await card.click();await expect(page.locator('.inbody-progress-card .inbody-details')).toHaveAttribute('open','');
 await page.getByRole('button',{name:/История замеров/}).click();
 for(const summary of await page.locator('.client-progress-history .inbody-details summary').all()){
  if(pilot)await expect(summary).toHaveCSS('min-height','48px');else await expect(summary).not.toHaveClass('progress-details-toggle');
  await summary.click();await expect(summary.locator('..')).toHaveAttribute('open','');
 }
});

for(const theme of ['light','dark'])for(const width of [390,430])test(`Client Lime short home actions ${theme} ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:844});await mockPilot(page,{role:'client',profileId:clientId,withGoal:true,workouts:[{...workout,workoutDate:'2026-08-01',status:'planned',exercises:[]}]});
 await page.addInitScript(({id,theme})=>localStorage.setItem(`fit.clientLime.theme.${id}`,theme),{id:clientId,theme});
 await page.goto('/me');
 for(const link of [page.locator('.client-home-past-plan > a'),page.locator('.client-home-highlight > a')]){
  await expect(link).toBeVisible();await link.scrollIntoViewIfNeeded();expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.focus();await expect(link).toBeFocused();
 }
 await page.screenshot({path:testInfo.outputPath(`short-home-actions-${theme}-${width}.png`)});
 await page.locator('.client-home-past-plan > a').click();await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`));
});

for (const theme of ['light', 'dark'] as const) test(`Client Lime exported PNG follows ${theme} identity in every variant`, async ({ page }, testInfo) => {
  type Paint = { text: string; font: string; left: number; right: number; top: number; bottom: number }
  type ShareAudit = Window & { limeShared?: File; limePaint?: Paint[] }
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await page.addInitScript(() => {
    const audit = window as ShareAudit
    // eslint-disable-next-line @typescript-eslint/unbound-method -- replayed with the original canvas receiver below
    const original = CanvasRenderingContext2D.prototype.fillText
    audit.limePaint = []
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const measured = this.measureText(text)
      const left = this.textAlign === 'right' ? x - measured.width : x
      audit.limePaint!.push({ text, font: this.font, left, right: left + measured.width, top: y - measured.actualBoundingBoxAscent, bottom: y + measured.actualBoundingBoxDescent })
      if (maxWidth === undefined) original.call(this, text, x, y)
      else original.call(this, text, x, y, maxWidth)
    }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => { audit.limeShared = data.files?.[0]; return Promise.resolve() } })
  })
  const exercise: WorkoutExercise = { id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: 'fedb-barbell-squat', name: 'Приседания со штангой и очень длинным названием упражнения', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0, sets: [{ id: '10000000-0000-4000-8000-000000000082', position: 0, reps: 10, weightKg: 20, fact: {}, confirmedAt: null, version: 1 }] }
  const previous = { ...workout, id: '10000000-0000-4000-8000-000000000083', workoutDate: '2026-09-20', status: 'done', completedAt: '2026-09-20T10:00:00Z', exercises: [{ ...exercise, sets: [{ ...exercise.sets[0]!, weightKg: 10, fact: { reps: 10, weightKg: 10 }, confirmedAt: '2026-09-20T10:00:00Z' }] }] }
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, actualDurationSec: 3600, activeCaloriesKcal: 210, exercises: [exercise] }, previous] })
  await page.addInitScript(({ id, theme }) => localStorage.setItem('fit.clientLime.theme.' + id, theme), { id: clientId, theme })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  const finish = page.getByRole('button', { name: 'Завершить', exact: true })
  if (await finish.isVisible()) await finish.click()
  await expect(page.getByRole('region', { name: 'Тренировка завершена', exact: true })).toBeVisible()
  for (const [variant, label] of [['summary', 'Итог'], ['achievement', 'Достижение'], ['progress', 'Прогресс']] as const) {
    await page.getByRole('button', { name: 'Поделиться', exact: true }).click()
    const option = page.getByRole('radio', { name: new RegExp('^' + label) })
    await expect(option).toBeEnabled()
    await option.click()
    await page.evaluate(() => { const audit = window as ShareAudit; audit.limeShared = undefined; audit.limePaint = [] })
    await page.getByRole('button', { name: 'Поделиться карточкой', exact: true }).click()
    await page.waitForFunction(() => Boolean((window as ShareAudit).limeShared))
    const result = await page.evaluate(async () => {
      const audit = window as ShareAudit
      const file = audit.limeShared!
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const image = await createImageBitmap(file)
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
      const hasInk = (left: number, top: number, width: number, height: number) => {
        const pixels = context.getImageData(left, top, width, height).data
        const paper = context.getImageData(0, 0, 1, 1).data
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i]! - paper[0]!) + Math.abs(pixels[i + 1]! - paper[1]!) + Math.abs(pixels[i + 2]! - paper[2]!) > 80) return true
        return false
      }
      return { ink: { brand: hasInk(80, 65, 150, 55), date: hasInk(650, 65, 350, 55), footer: hasInk(80, 1210, 400, 70) }, base64: btoa(binary), name: file.name, width: image.width, height: image.height, paper: Array.from(context.getImageData(0, 0, 1, 1).data), painted: audit.limePaint! }
    })
    expect(result.ink).toEqual({ brand: true, date: true, footer: true })
    expect(result.name).toBe(`fit-workout-${variant}.png`)
    expect([result.width, result.height]).toEqual([1080, 1350])
    expect(result.paper).toEqual(theme === 'dark' ? [0, 0, 0, 255] : [246, 247, 242, 255])
    expect(result.painted.every((paint) => !paint.font.includes('Onest'))).toBe(true)
    expect(result.painted.every((paint) => paint.left >= 0 && paint.right <= 1080 && paint.top >= 0 && paint.bottom <= 1350)).toBe(true)
    expect(result.painted.some((paint) => paint.font.includes('YS Geo'))).toBe(true)
    if (variant === 'summary') {
      expect(result.painted.some((paint) => paint.text === '≈ 210 ккал')).toBe(true)
      expect(result.painted.some((paint) => paint.text === '1 ч 00 мин')).toBe(true)
    }
    if (variant === 'progress') expect(result.painted.some((paint) => paint.font.includes('REM'))).toBe(true)
    await writeFile(testInfo.outputPath(`client-lime-${variant}-${theme}.png`), Buffer.from(result.base64, 'base64'))
    await writeFile(testInfo.outputPath(`client-lime-${variant}-${theme}.json`), JSON.stringify(result.painted, null, 2))
  }
})


for (const theme of ['light', 'dark']) for (const width of [390, 430]) test(`Client Lime rest picker follows the text contract ${theme} ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 })
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.addInitScript(({ id, theme }) => localStorage.setItem('fit.clientLime.theme.' + id, theme), { id: clientId, theme })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Таймер отдыха', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })
  const selected = picker.locator('.rest-time-wheel [aria-selected=true]')
  for (const value of await selected.all()) await expect(value).toHaveCSS('font-weight', '500')
  await expect(picker.locator('.rest-time-separator')).toHaveCSS('font-weight', '500')
  await picker.getByRole('button', { name: '3:00', exact: true }).click()
  await expect(selected.first()).toHaveText('03')
  await expect(selected.last()).toHaveText('00')
  await page.screenshot({ path: testInfo.outputPath(`rest-picker-${theme}-${width}.png`) })
  await picker.getByRole('button', { name: /Начать отдых/ }).click()
  await expect(picker).toHaveCount(0)
  await page.getByRole('button', { name: /Таймер отдыха:/ }).click()
  for (const value of await selected.all()) await expect(value).toHaveCSS('font-weight', '500')
})

for (const pilot of [true, false]) test(`Client chat portal preserves font scope ${pilot ? 'lime' : 'original'}`, async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId, clientLime: pilot })
  await page.goto(`/chat/${conversationId}`)
  await page.locator('.chat-message').last().click()
  const sheet = page.getByRole('dialog', { name: 'Действия с сообщением', exact: true })
  await expect(sheet).toBeVisible()
  for (const action of await sheet.getByRole('button').all()) {
    await expect(action).toHaveCSS('font-weight', pilot ? '500' : '600')
    if (pilot) await expect(action).toHaveCSS('font-family', /YS Geo Symbols.*YS Geo/)
  }
  await sheet.getByRole('button', { name: 'Ответить', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Отменить ответ', exact: true })).toBeVisible()
})

// Global admission is assigned by the server, not a hard-coded browser ID list.
for (const role of ['client', 'trainer'] as const) test(`Lime rollout honors server admission and rollback for a previously non-pilot ${role}`, async ({ page }) => {
  const profileId = '10000000-0000-4000-8000-000000000099'
  const route = role === 'client' ? '/me' : '/clients'
  const scope = role === 'client' ? 'fit-client-lime' : 'fit-lime-shell'
  await mockPilot(page, { role, profileId, clientLime: role === 'client', fitLime: role === 'trainer' })
  await page.goto(route)
  await expect(page.locator('.phone-frame')).toHaveClass(new RegExp(scope))
  await page.reload()
  await expect(page.locator('.phone-frame')).toHaveClass(new RegExp(scope))
  // A fresh actor refresh must respect a server rollback for the same identity.
  await mockPilot(page, { role, profileId, clientLime: false, fitLime: false })
  await page.reload()
  await expect(page.locator('.phone-frame')).not.toHaveClass(new RegExp(scope))
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) {
  test(`Client Lime nested coachmark action follows the primary control geometry ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { role: 'client', profileId: clientId, workouts: [{ ...workout, createdBy: clientId }] })
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      const key = `fit.coachmarks-seen.${id}`
      const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      localStorage.setItem(key, JSON.stringify(seen.filter((item) => item !== 'missed-workout-actions-2026-08')))
    }, { id: clientId, theme })
    await page.goto(`/workouts/${workoutId}`)
    const notice = page.locator('.coachmark-bubble').filter({ hasText: 'План можно закрыть спокойно' })
    const action = notice.getByRole('button', { name: 'Понятно', exact: true })
    await expect(action).toHaveCSS('border-radius', '999px')
    await expect(action).toHaveCSS('min-height', '48px')
    await expect(action).toHaveCSS('font-size', '16px')
    await expect(action).toHaveCSS('font-weight', '500')
    await page.screenshot({ path: info.outputPath('client-coachmark-action.png') })
    await action.click()
    await expect(notice).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
