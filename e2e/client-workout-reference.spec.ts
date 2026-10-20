import { expect, test, type Page } from '@playwright/test'
import { coachGestureWorkout, restTimerWorkout, holdClientLiveCard, mockClientStreamingVoice, mockPilot, newWorkoutId, workoutId } from './fit-lime-fixtures'

test.skip(process.env.FIT_CLIENT_WORKOUT_ACCEPTANCE !== '1', 'Dedicated native client-workout harness')

const pilotId = 'c11e0000-6010-4000-8000-000000000001'

test.beforeEach(async ({ page }) => {
  // Only app GETs may reach the local server; every API write is fixture-bound.
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === new URL(test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`).origin
      && route.request().method() === 'GET' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort()
  })
  await page.addInitScript(id => {
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify([...seen, 'client-live-reference-timer-2026-10']))
  }, pilotId)
  await page.routeWebSocket('**', socket => socket.close())
})

test('client reference settings preserve animation independently of density and reload', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  const original = page.getByRole('radio', { name: 'Оригинальный', exact: true })
  const compact = page.getByRole('radio', { name: 'Компактный', exact: true })
  const animation = page.getByRole('switch', { name: 'Анимация в Live', exact: true })
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).toBeChecked()
  await compact.click()
  await expect(animation).toBeChecked()
  await animation.uncheck()
  await original.click()
  await expect(animation).not.toBeChecked()
  await page.reload()
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).not.toBeChecked()
  await compact.click()
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-live-density-compact')).toBeVisible()
  await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', '48px')
  await expect(page.locator('.live-header-animation, .exercise-thumbnail')).toHaveCount(0)
})

test('another client cannot enter the pilot from settings or a direct Live link', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  await expect(page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })).toHaveCount(0)
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

test('a trainer in the client allowlist retains trainer presentation', async ({ page }) => {
  await mockPilot(page, { profileId: pilotId, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

// Each visual axis has a distinct risk: theme contrast, narrow wrapping and row density.
for (const theme of ['dark', 'light']) for (const width of [390, 430]) for (const density of ['original', 'compact']) for (const animation of [true, false]) {
  test(`client reference geometry ${theme} ${width} ${density} animation-${animation}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(({ id, theme, density, animation }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
      localStorage.setItem(`fit.liveExerciseAnimation.${id}`, JSON.stringify(animation))
    }, { id: pilotId, theme, density, animation })
    const source = coachGestureWorkout()
    source.startedAt = new Date(Date.now() - 120000).toISOString()
    source.exercises[0] = { ...source.exercises[0]!, ref: 'barbell-squat', name: 'Присед со штангой на плечах' }
    await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
    await page.goto('/me/settings')
    await expect(page.getByRole('switch', { name: 'Анимация в Live', exact: true })).toBeChecked({ checked: animation })
    const options = page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await page.screenshot({ path: info.outputPath('settings.png') })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.client-live-density-${density}`)).toBeVisible()
    await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', density === 'original' ? '54px' : '48px')
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', theme === 'light' ? 'rgb(246, 247, 242)' : 'rgb(0, 0, 0)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('.coach-live-clock')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Завершить тренировку', exact: true })).toHaveCount(1)
    await expect(page.locator('.coach-live-metric').first()).toBeVisible()
    await expect(page.locator('.coach-live-digits')).toHaveCSS('font-family', /REM/)
    await expect(page.locator('.live-exercise-head .exercise-thumbnail')).toHaveCount(animation ? source.exercises.length : 0)
    await expect(page.locator('.live-header-animation')).toHaveCount(animation ? 1 : 0)
    const title = page.locator('.live-exercise-head h2').first()
    expect(await title.evaluate(el => { const r=el.getBoundingClientRect(); return r.width > 80 && r.left >= 0 && r.right <= innerWidth })).toBe(true)
    await page.screenshot({ path: info.outputPath('live.png') })
  })
}

for (const density of ['original', 'compact']) test(`client reference input and confirmed edits ${density}`, async ({ page }) => {
  await page.addInitScript(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
  const source = restTimerWorkout()
  source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const drafts: Array<{ weightKg?: number; reps?: number }> = []
  let confirmations = 0
  page.on('request', (request) => {
    if (/\/workout-sets\/[^/]+\/draft$/.test(request.url())) drafts.push((request.postDataJSON() as { draft: typeof drafts[number] }).draft)
    if (/\/workout-sets\/[^/]+\/confirm$/.test(request.url())) confirmations += 1
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator('form[data-live-set-id]').first()
  const second = page.locator('form[data-live-set-id]').nth(1)
  const weight = first.getByLabel('Фактический вес', { exact: true })
  const reps = first.getByLabel('Фактические повторы', { exact: true })
  await weight.click()
  await expect.poll(() => weight.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, 2])
  await page.keyboard.type('22,5')
  await page.keyboard.press('Enter')
  await expect(reps).toBeFocused()
  await page.keyboard.type('8')
  await reps.evaluate(el => { el.dataset.stableInput = 'before-density' })
  await page.evaluate(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density === 'original' ? 'compact' : 'original')
    window.dispatchEvent(new Event('fit-client-live-density-change'))
  }, { id: pilotId, density })
  await expect(reps).toBeFocused()
  await expect(reps).toHaveValue('8')
  await expect(reps).toHaveAttribute('data-stable-input', 'before-density')
  await first.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(first.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(second.getByLabel('Фактический вес', { exact: true })).toBeFocused()
  await expect(weight).toBeEnabled()
  await expect(weight).toHaveValue('22,5')
  const deadline = await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))
  expect(deadline).not.toBeNull()
  const savedEdit = page.waitForResponse((response) => /\/workout-sets\/[^/]+\/draft$/.test(response.url()) && response.ok()
    && (response.request().postDataJSON() as { draft: { reps?: number } }).draft.reps === 9)
  await weight.click()
  await page.keyboard.type('25')
  await page.keyboard.press('Enter')
  await expect(reps).toBeFocused()
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await expect(second.getByLabel('Фактический вес', { exact: true })).toBeFocused()
  await expect.poll(() => drafts.some((draft) => draft.weightKg === 25 && draft.reps === 9)).toBe(true)
  await savedEdit
  await expect(first).toHaveClass(/confirmed/)
  await expect(first.getByRole('button', { name: 'Редактировать подход' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))).toBe(deadline)
  expect(confirmations).toBe(1)
  await page.reload()
  await expect(weight).toHaveValue('25')
  await expect(reps).toHaveValue('9')
  await expect(first).toHaveClass(/confirmed/)
  let failedSave = false
  await page.route(`**/workout-sets/${source.exercises[0]!.sets[0]!.id}/draft`, async (route) => {
    if (!failedSave) { failedSave = true; await route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) }
    else await route.fallback()
  })
  await weight.fill('30')
  await weight.blur()
  await expect(page.locator('.live-sync-state[role="alert"]')).toBeVisible()
  await expect(weight).toHaveValue('30')
  await expect(first).toHaveClass(/confirmed/)
  await page.locator('.live-sync-state').getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.live-sync-state')).toHaveCount(0)
  expect(confirmations).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))).toBe(deadline)
  await page.reload()
  await expect(weight).toHaveValue('30')
  await expect(first).toHaveClass(/confirmed/)
})

test('client reference preserves full-card drag cancellation and stored results', async ({ page }) => {
  const source = coachGestureWorkout()
  const first = source.exercises[0]!
  first.sets[0]!.confirmedAt = '2026-10-20T08:00:00Z'
  first.sets[0]!.fact = { weightKg: 25, reps: 9 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let moves = 0
  page.on('request', request => { if (/\/blocks\/[^/]+\/move$/.test(request.url())) moves += 1 })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('[data-workout-swipe], .workout-drag-handle')).toHaveCount(0)
  const card = await holdClientLiveCard(page, first.blockId)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/dragging/)
  expect(moves).toBe(0)
  await holdClientLiveCard(page, first.blockId)
  await page.mouse.move(24, 820, { steps: 12 })
  await expect(page.locator('.workout-drag-preview')).toContainText('Позиция 3 из 3')
  await page.mouse.up()
  await expect(page.locator('[data-workout-block]').last()).toHaveAttribute('data-workout-block', first.blockId)
  expect(moves).toBe(1)
  await expect(page.locator(`form[data-live-set-id="${first.sets[0]!.id}"]`)).toHaveClass(/confirmed/)
  await expect(card.getByLabel('Фактический вес', { exact: true }).first()).toHaveValue('25')
})

test('client reference top finish retains missing cardio time warning', async ({ page }) => {
  const source = restTimerWorkout(), exercise = source.exercises[0]!
  exercise.inputKind = 'distance'; exercise.ref = 'running'; exercise.muscleGroup = 'cardio'; exercise.name = 'Бег'
  exercise.sets = [ { ...exercise.sets[0]!, confirmedAt: '2026-10-08T09:01:00Z', fact: { distanceKm: 1 }, distanceKm: 1 } ]
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let finishes = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/finish')) finishes++ })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toContainText('нет фактического времени')
  await page.getByRole('button', { name: 'Внести время', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Фактическое время:/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /^Фактическое время:/ })).toBeFocused()
  expect(finishes).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить без оценки', exact: true }).click()
  await expect(page).not.toHaveURL(/\/live$/)
  expect(finishes).toBe(1)
})

function timedRepsWorkout() {
  const source = restTimerWorkout(0, true, 'timer')
  const exercise = source.exercises[0]!
  source.exercises[0] = { ...exercise, ref: 'squat', name: 'Приседания', inputKind: 'reps', sets: exercise.sets.map((set) => ({ ...set, reps: 10 })) }
  return source
}

async function runTwoTimedSets(page: Page, waitForServer: boolean) {
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  if (waitForServer) await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 0:02')
  await page.clock.fastForward(2_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
}

function recordSetDrafts(page: Page) {
  const drafts: Array<{ timerConfirmed?: true }> = []
  page.on('request', (request) => {
    if (/\/v1\/workout-sets\/[^/]+\/draft$/.test(new URL(request.url()).pathname)) drafts.push((request.postDataJSON() as { draft: { timerConfirmed?: true } }).draft)
  })
  return drafts
}


test('client reference Live manual mode keeps timed sets manual', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toHaveText('Отдых')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await page.clock.fastForward(4_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

test('client reference Live timer mode asks to confirm planned reps before finishing', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [timedRepsWorkout()] })
  const drafts = recordSetDrafts(page)
  await page.goto(`/workouts/${workoutId}/live`)
  await runTwoTimedSets(page, true)
  expect(drafts.filter((draft) => draft.timerConfirmed)).toHaveLength(2)
  await expect(page.getByRole('button', { name: 'Подтвердить подходы: Приседания', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.timer-review')).toContainText('Таймер засчитал подходов: 2. Всё верно?')
  const finish = page.waitForRequest((request) => new URL(request.url()).pathname === `/v1/workouts/${workoutId}/finish`)
  await page.getByRole('button', { name: 'Всё верно, завершить', exact: true }).click()
  await finish
  expect(drafts.slice(-2).every((draft) => !draft.timerConfirmed)).toBe(true)
})

test('client reference Live mode switch in the timer settings stops the timer flow for this session', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true, 'timer')] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.locator('.live-rest-trigger').click({ button: 'right' })
  const mode = page.getByRole('dialog').getByRole('group', { name: 'Кто ведёт тренировку' })
  await expect(mode.getByRole('button', { name: 'Ведёт таймер' })).toHaveAttribute('aria-pressed', 'true')
  await mode.getByRole('button', { name: 'Веду сам', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть таймер' }).click()
  await expect(page.locator('.live-rest-trigger')).toHaveText('Отдых')
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
})

test('client reference Live manual mode times a set from Start and records the time past zero', async ({ page }) => {
  // Часы стоят и двигаются только fastForward: записанное время точное и в медленном CI.
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true)] })
  const drafts: Array<{ durationSec?: number; timerConfirmed?: true }> = []
  page.on('request', (request) => {
    if (/\/v1\/workout-sets\/[^/]+\/draft$/.test(new URL(request.url()).pathname)) drafts.push((request.postDataJSON() as { draft: { durationSec?: number; timerConfirmed?: true } }).draft)
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toHaveText('Отдых')
  await page.clock.pauseAt(new Date('2026-10-08T09:01:00Z'))
  await page.getByRole('button', { name: 'Старт подхода' }).first().click()
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход +0:02')
  await expect(page.locator('.coach-live-digits')).toHaveAttribute('aria-label', 'Подход: +00:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await expect(page.getByRole('button', { name: /^Засчитать подход:/ })).toHaveCSS('border-radius', '16px')
  await expect(page.getByRole('button', { name: /^Засчитать подход:/ })).toHaveCSS('min-height', '54px')
  await page.getByRole('button', { name: /^Засчитать подход:/ }).click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  expect(drafts.at(-1)).toMatchObject({ durationSec: 5 })
  expect(drafts.at(-1)?.timerConfirmed).toBeUndefined()
})


async function expectClientEditorFits(page: Page) {
  const overflow = await page.locator('.content').evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const outside = await page.locator('.planned-set, .workout-editor-footer, .today-exercise-title').evaluateAll((nodes: Element[]): string[] => nodes.filter(el => {
    const r = el.getBoundingClientRect()
    return el.getClientRects().length > 0 && (r.left < -1 || r.right > innerWidth + 1)
  }).map(el => el.getAttribute('class') ?? ''))
  expect(outside).toEqual([])
}

for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client editor reference geometry ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId
  plan.exercises[0] = { ...plan.exercises[0]!, ref: 'barbell-squat', name: 'Присед со штангой на плечах' }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.locator('.client-reference-form')).toBeVisible()
  const field = page.getByLabel('Вес, подход 1', { exact: true }).first()
  await expect(field).toHaveCSS('height', '48px')
  await expect(field).toHaveCSS('border-radius', '16px')
  await expect(field).toHaveCSS('font-family', /YS Geo/)
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('editor-top.png') })
  await page.locator('.content').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(page.getByRole('button', { name: 'Действия с планом', exact: true })).toBeVisible()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('editor-bottom.png') })
  await page.goto('/me?entry=workout')
  await page.getByLabel('Тренировка', { exact: true }).fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  await expect(page.locator('.client-reference-flow .coach-plan-metric').first()).toBeVisible()
  await expect(page.locator('.client-reference-flow .planned-set-input').first()).toHaveCSS('height', '48px')
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('review.png') })
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Запланировать тренировку', exact: true })).toBeVisible()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('save.png') })
})

test('client reference voice cancel, review edits and failed save retain the draft', async ({ page }) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], failFirstSave: true })
  await mockClientStreamingVoice(page, 'Приседания один подход десять повторений')
  await page.goto('/me?entry=workout')
  const text = page.getByLabel('Тренировка', { exact: true })
  await text.fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(text).toHaveValue('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  const weight = page.getByRole('spinbutton', { name: /: вес, подход 1$/ }).first()
  await weight.fill('22.5')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  await expect(weight).toHaveValue('22.5')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(2)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
})

test('another client and a trainer never receive client editor geometry', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [] })
  await page.goto('/workouts/new')
  await expect(page.locator('.workout-form')).toBeVisible()
  await expect(page.locator('.client-reference-form, .client-reference-flow')).toHaveCount(0)
  await mockPilot(page, { profileId: pilotId, fitLime: true, workouts: [] })
  await page.goto('/workouts/new')
  await expect(page.locator('.workout-form')).toBeVisible()
  await expect(page.locator('.client-reference-form, .client-reference-flow')).toHaveCount(0)
})


test('client reference cannot edit an assigned trainer plan', async ({ page }) => {
  const plan = coachGestureWorkout(); plan.status = 'planned'; plan.startedAt = null
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.getByText('Редактирование недоступно', { exact: true })).toBeVisible()
  await expect(page.locator('.workout-form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toHaveCount(0)
})
