import { expect, test, type Page } from '@playwright/test'
import { coachGestureWorkout, restTimerWorkout, holdClientLiveCard, mockClientStreamingVoice, mockPilot, newWorkoutId, workoutId } from './fit-lime-fixtures'

test.skip(process.env.FIT_CLIENT_WORKOUT_ACCEPTANCE !== '1', 'Dedicated native client-workout harness')

const pilotId = 'c11e0000-6010-4000-8000-000000000001'

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const animation of [false, true]) test(`client completed cards stay compact ${theme} ${density} animation-${animation}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density, animation }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, String(animation))
  }, { id: pilotId, theme, density, animation })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.exercises[0]!.ref = 'barbell-squat'
  source.exercises[1]!.name = 'Жим гантелей на наклонной скамье с длинным названием упражнения'
  for (const exercise of source.exercises) for (const set of exercise.sets) {
    set.confirmedAt = new Date(Date.now() - 60000).toISOString(); set.fact = { weightKg: 30, reps: 10 }
  }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.workout-exercise-compact')).toHaveCount(3)
    const geometry = await page.locator('.live-completed-gesture-head').first().evaluate(card => {
      const button = card.querySelector('.workout-exercise-compact')!, copy = card.querySelector('.workout-exercise-compact-copy')!
      const thumb = card.querySelector('.exercise-thumbnail'), menu = card.querySelector('.overflow-trigger')!
      const b = button.getBoundingClientRect(), c = copy.getBoundingClientRect(), m = menu.getBoundingClientRect(), t = thumb?.getBoundingClientRect()
      return { height: card.getBoundingClientRect().height, copyX: c.x, buttonX: b.x, copyRight: c.right, menuX: m.x, thumbRight: t?.right }
    })
    expect(geometry.height).toBeLessThan(140)
    expect(geometry.copyRight).toBeLessThanOrEqual(geometry.menuX)
    if (animation) expect(geometry.thumbRight).toBeLessThan(geometry.copyX)
    else expect(geometry.copyX).toBe(geometry.buttonX)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`completed-${width}.png`) })
  }
})

for (const density of ['original', 'compact']) test(`client folds completed exercise without stopping overdue rest ${density}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
  const source = coachGestureWorkout()
  source.startedAt = '2026-10-21T08:58:00Z'
  const exercise = source.exercises[0]!
  exercise.restBetweenExercisesSec = 2
  exercise.restBetweenSetsSec = 2
  exercise.sets[0]!.confirmedAt = '2026-10-21T08:59:00Z'
  exercise.sets[0]!.fact = { weightKg: 20, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('form[data-live-set-id]').nth(1).getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  const compact = page.locator('.workout-exercise-compact').first()
  await expect(compact).toBeVisible()
  await page.clock.fastForward(4000)
  await expect(compact).toBeVisible()
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /Отдых превышен/)
  await compact.click()
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  await row.getByLabel('Фактический вес', { exact: true }).fill('35')
  await row.getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(35)
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /Отдых превышен/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe('2026-10-21T08:59:00Z')
})

async function modelKeyboard(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & { fitTestKeyboardHeight?: number }
    if (visualViewport) Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => state.fitTestKeyboardHeight ?? innerHeight })
  })
}

async function showModeledKeyboard(page: Page) {
  await page.evaluate(() => {
    ;(window as typeof window & { fitTestKeyboardHeight?: number }).fitTestKeyboardHeight = 420
    visualViewport?.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
}

async function tapVisible(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('Action is not visible')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

for (const entry of ['live', 'new', 'today']) for (const action of ['create', 'add']) test(`client keyboard picker first tap ${entry} ${action}`, async ({ page }) => {
  await modelKeyboard(page)
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(entry === 'live' ? `/workouts/${workoutId}/live` : entry === 'new' ? '/workouts/new' : '/me?entry=workout')
  await page.getByRole('button', { name: entry === 'live' ? 'Ещё упражнение' : entry === 'new' ? 'Выбрать упражнения' : 'Выбрать упражнения вручную', exact: true }).click()
  const picker = page.locator('.client-reference-catalog')
  const search = picker.getByLabel('Поиск упражнения', { exact: true })
  await search.fill(action === 'create' ? 'zzzaudit-no-exercise' : 'план')
  if (action === 'add') await picker.locator('.picker-select-mark').first().tap()
  await search.focus()
  await showModeledKeyboard(page)
  await tapVisible(page, picker.locator(action === 'create' ? '.coach-catalog-create-floating' : '.coach-catalog-add'))
  if (action === 'create') await expect(picker.getByRole('heading', { name: 'Своё упражнение' })).toBeVisible()
  else if (entry === 'live') await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(source.exercises.length + 1)
  else await expect(picker).toHaveCount(0)
})

for (const density of ['original', 'compact']) for (const action of ['confirm', 'note', 'menu', 'append']) test(`client keyboard Live first tap ${density} ${action}`, async ({ page }) => {
  await modelKeyboard(page)
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, density })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  // Complete this scenario's append contract without extending the protected
  // global fixture inventory. All writes remain in memory.
  await page.route('**/v1/workout-exercises/*/sets', async route => {
    const workout = backend.getWorkouts()[0]!
    const exercise = workout.exercises.find(item => item.id === new URL(route.request().url()).pathname.split('/').at(-2))!
    exercise.sets.push({ ...exercise.sets.at(-1)!, id: 'c11e0000-6010-4000-8000-000000000999', position: exercise.sets.length, fact: {}, confirmedAt: null })
    workout.version += 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: workout.version } }) })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first()
  await row.getByLabel('Фактический вес', { exact: true }).fill('25')
  await showModeledKeyboard(page)
  const target = action === 'confirm' ? row.getByRole('button', { name: 'Готово, отдых', exact: true })
    : page.locator(action === 'note' ? '.live-exercise-note summary' : action === 'menu' ? '.live-exercise .overflow-trigger' : '.live-add-set').first()
  await tapVisible(page, target)
  if (action === 'confirm') await expect(row).toHaveClass(/confirmed/)
  if (action === 'note') await expect(page.locator('.live-exercise-note').first()).toHaveAttribute('open', '')
  if (action === 'menu') await expect(page.getByRole('menu')).toBeVisible()
  if (action === 'append') await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets.length).toBe(3)
})

test('client keyboard date confirmation applies the edited draft on first tap', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 844 })
  await modelKeyboard(page)
  const source = coachGestureWorkout()
  source.createdBy = pilotId; source.status = 'planned'; source.startedAt = null
  source.workoutDate = '2026-12-20'; source.startTime = '10:00'; source.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/edit`)
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  await dialog.getByRole('button', { name: '1 декабря 2026 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).focus()
  await showModeledKeyboard(page)
  await tapVisible(page, dialog.getByRole('button', { name: 'Применить дату', exact: true }))
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toContainText('1 декабря 2026 г.')
})

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

for (const density of ['original', 'compact']) test(`client reference pause clock freezes and resumes the existing timer ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.clientLime.theme.${id}`, density === 'original' ? 'dark' : 'light')
  }, { id: pilotId, density })
  await page.setViewportSize({ width: density === 'original' ? 390 : 430, height: 844 })
  const source = Object.assign(restTimerWorkout(0, true, 'timer'), { startedAt: '2026-10-08T08:59:00Z', pausedSeconds: 20 })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const pauses: boolean[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pause')) pauses.push((request.postDataJSON() as { paused: boolean }).paused) })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  const clock = page.locator('button.coach-live-clock.live-timer-toggle')
  await expect(clock).toHaveCount(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500)
  const cardTop = await page.locator('.live-exercise').first().evaluate(el => el.getBoundingClientRect().top)
  await clock.click()
  // The test clock is frozen; deliver the existing query notification timer.
  await page.clock.runFor(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'true')
  await expect(clock).toHaveText('Пауза')
  const elapsed = (await clock.getAttribute('aria-label'))!.split(', прошло ')[1]!
  const frozen = await page.locator('.live-rest-trigger').innerText()
  await page.screenshot({ path: info.outputPath('paused-clock.png'), animations: 'disabled' })
  expect(await page.locator('.live-exercise').first().locator('.live-set-check,.live-add-set,.live-exercise-note summary').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth }))).toBe(true)
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-rest-trigger')).toHaveText(frozen)
  await expect(clock).toHaveAttribute('aria-label', `Продолжить тренировку, прошло ${elapsed}`)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  expect(Math.abs((await page.locator('.live-exercise').first().evaluate(el => el.getBoundingClientRect().top)) - cardTop)).toBeLessThanOrEqual(1)
  await clock.click()
  await page.clock.runFor(1)
  await expect(clock).toHaveAttribute('aria-label', `Поставить тренировку на паузу, прошло ${elapsed}`)
  await expect.poll(() => pauses).toEqual([true, false])
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

for (const density of ['original', 'compact']) test(`client reference pause restores existing server state and set action resumes ${density}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:02:00Z') })
  await page.addInitScript(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
  const source = Object.assign(restTimerWorkout(0, true), { startedAt: '2026-10-08T09:00:00Z', pausedAt: '2026-10-08T09:01:00Z', pausedSeconds: 20 })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const pauses: boolean[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pause')) pauses.push((request.postDataJSON() as { paused: boolean }).paused) })
  await page.goto(`/workouts/${workoutId}/live`)
  const clock = page.locator('button.coach-live-clock.live-timer-toggle')
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  await expect(clock).toHaveText('Пауза')
  await page.clock.fastForward(10_000)
  await page.reload()
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  expect(pauses).toEqual([])
  await page.getByRole('button', { name: 'Старт подхода' }).first().click()
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await expect(clock).not.toHaveText('Пауза')
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await expect.poll(() => pauses).toEqual([false])
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


for (const mode of ['planned', 'done'] as const) for (const wheel of [false, true]) test(`client editor reference metric kinds preserve ${mode} wheel-${wheel}`, async ({ page }, info) => {
  await page.setViewportSize({ width: mode === 'planned' ? 390 : 430, height: 844 })
  await page.addInitScript(({ id, wheel, mode }) => { localStorage.setItem('fit.workoutTimeWheel', String(wheel)); localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'); localStorage.setItem(`fit.clientLime.theme.${id}`, mode === 'planned' ? 'dark' : 'light') }, { id: pilotId, wheel, mode })
  const source = coachGestureWorkout()
  source.createdBy = pilotId; source.trainingFormat = 'self'; source.status = mode
  source.startedAt = mode === 'done' ? '2026-10-20T09:00:00Z' : null
  source.completedAt = mode === 'done' ? '2026-10-20T10:00:00Z' : null
  source.exercises = source.exercises.map((exercise, index) => ({ ...exercise,
    name: ['Планка', 'Бег с длинным названием тренировки', 'Упражнение на повторы'][index]!,
    ref: ['plank', 'running', 'push-ups'][index]!, inputKind: (['duration', 'distance', 'reps'] as const)[index]!,
    sets: [{ ...exercise.sets[0]!, weightKg: undefined, durationSec: index === 1 ? 600 : index === 2 && mode === 'planned' ? undefined : 90, distanceKm: index === 1 ? 1.5 : undefined, reps: index === 2 ? 12 : undefined, rpe: 7,
      confirmedAt: mode === 'done' ? '2026-10-20T09:10:00Z' : null,
      fact: mode === 'done' ? { durationSec: index === 1 ? 500 : 45, distanceKm: index === 1 ? 2 : undefined, reps: index === 2 ? 10 : undefined, rpe: 6 } : {} }] }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const writes: Array<{ exercises: Array<{ sets: Array<{ durationSec?: number; distanceKm?: number; reps?: number }> }> }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  // Completed edits use the existing separate endpoint; the common fixture covers plan PUT.
  await page.route(`**/v1/workouts/${workoutId}/completed`, route => { if (route.request().method() !== 'PUT') return route.fallback(); writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fulfill({ json: { workout: { id: workoutId } } }) })
  await page.goto(`/workouts/${workoutId}/edit`)
  const plank = page.locator('.planned-exercise').nth(0)
  const run = page.locator('.planned-exercise').nth(1)
  const reps = page.locator('.planned-exercise').nth(2)
  if (wheel) {
    const clock = plank.getByRole('button', { name: mode === 'done' ? 'Время, подход 1: 0:45' : 'Время, подход 1: 1:30', exact: true })
    await expect(clock).toBeVisible()
    await clock.click()
    const picker = page.getByRole('dialog', { name: 'Время, подход 1', exact: true })
    await expect(picker).toBeVisible()
    await page.screenshot({ path: info.outputPath('duration-picker.png') })
    await picker.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
  } else {
    await expect(plank.locator('.workout-duration-trigger')).toHaveCount(0)
    await expect(plank.getByLabel('Время, подход 1: секунды', { exact: true })).toHaveValue(mode === 'done' ? '45' : '30')
  }
  const distance = run.getByLabel('Расстояние, подход 1', { exact: true })
  await expect(distance).toHaveValue(mode === 'done' ? '2' : '1.5')
  await distance.fill('2.75'); await distance.press('Tab')
  await run.getByLabel('Единица расстояния, подход 1', { exact: true }).selectOption('m')
  await expect(distance).toHaveValue('2750')
  await run.getByLabel('Единица расстояния, подход 1', { exact: true }).selectOption('km')
  await expect(distance).toHaveValue('2.75')
  await expect(reps.getByLabel('Повторы, подход 1', { exact: true })).toHaveValue(mode === 'done' ? '10' : '12')
  if (mode === 'planned' && wheel) await expect(reps.getByRole('button', { name: 'Время, подход 1: не указано', exact: true })).toHaveText('—')
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('mixed-metrics.png') })
  await reps.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('mixed-metrics-last.png') })
  await page.getByRole('button', { name: mode === 'done' ? 'Сохранить изменения' : 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.exercises[0]!.sets[0]!.durationSec).toBe(mode === 'done' ? 45 : 90)
  expect(writes[0]!.exercises[1]!.sets[0]!.distanceKm).toBe(2.75)
  expect(writes[0]!.exercises[2]!.sets[0]!.reps).toBe(mode === 'done' ? 10 : 12)
})

for (const [theme, width] of [['dark', 390], ['light', 430]] as const) test(`client editor reference copy edits and saves a new plan ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = coachGestureWorkout(false, 1)
  source.createdBy = pilotId; source.status = 'done'; source.workoutDate = '2026-10-20'; source.completedAt = '2026-10-20T09:10:00Z'
  source.exercises[0]!.sets[0]!.confirmedAt = source.completedAt
  source.exercises[0]!.sets[0]!.fact = { weightKg: 25, reps: 9 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const copies: Array<{ exercises: Array<{ blockId?: string; sets: Array<{ weightKg?: number; reps?: number; fact?: unknown; confirmedAt?: unknown }> }> }> = []
  const originalWrites: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/v1/workouts' && request.method() === 'POST') copies.push(request.postDataJSON() as typeof copies[number])
    if (path === `/v1/workouts/${workoutId}` && ['PUT', 'DELETE'].includes(request.method())) originalWrites.push(request.method())
  })
  await page.goto('/me/workouts')
  await page.getByRole('tab', { name: 'История', exact: true }).click()
  await page.getByRole('link', { name: /^Скопировать тренировку за/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?copy=${workoutId}`))
  await expect(page.locator('.client-reference-form')).toBeVisible()
  await expect(page.getByText(/Скопировано/).first()).toBeVisible()
  const exercise = page.locator('.planned-exercise').first()
  await exercise.locator('.compact-editor-exercise-toggle').click()
  const weight = exercise.getByLabel('Вес, подход 1', { exact: true })
  await expect(weight).toHaveValue('25')
  await expect(exercise.getByLabel('Повторы, подход 1', { exact: true })).toHaveValue('9')
  await expect(exercise.getByLabel('Вес, подход 2', { exact: true })).toHaveValue('20')
  await weight.fill('27.5')
  await exercise.getByLabel('Повторы, подход 1', { exact: true }).fill('8')
  await expectClientEditorFits(page)
  await weight.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('copy-edit.png') })
  const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('copy-save.png') })
  await save.click()
  await expect.poll(() => copies.length).toBe(1)
  expect(copies[0]!.exercises[0]!.sets[0]).toMatchObject({ weightKg: 27.5, reps: 8 })
  expect(copies[0]!.exercises[0]!.sets[1]).toMatchObject({ weightKg: 20, reps: 10 })
  expect(copies[0]!.exercises[0]!.sets[0]!.fact).toBeUndefined()
  expect(copies[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeUndefined()
  expect(copies[0]!.exercises[0]!.blockId).not.toBe(source.exercises[0]!.blockId)
  expect(originalWrites).toEqual([])
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
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


async function openClientReferenceCatalog(page: Page) {
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: /^Выбрать упражнения$/ }).click()
  return page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
}
for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client catalog reference geometry and retained filter search ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], withCustomExercise: true })
  const picker = await openClientReferenceCatalog(page)
  await expect(picker).toHaveClass(/client-reference-catalog/)
  const card = picker.locator('.picker-item').first()
  await expect(card).toHaveCSS('border-radius', '32px')
  await expect(card.locator('.picker-item-name')).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => { const faces = await document.fonts.load('16px "YS Geo"', 'Жим'); return faces.length > 0 && faces.every(face => face.status === 'loaded') })).toBe(true)
  await expect(card.locator('.picker-select-mark')).toHaveCSS('width', '44px')
  const preview = card.locator('.picker-item-technique')
  await preview.click()
  await expect(card).not.toHaveClass(/selected/)
  if (await card.locator('video').count()) await preview.click()
  else if (!await picker.getByRole('button', { name: 'Назад к выбору', exact: true }).count()) await preview.click()
  await expect(picker.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('technique.png') })
  await picker.getByRole('button', { name: 'Назад к выбору', exact: true }).click()
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('Жим')
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('catalog-selected.png') })
  await picker.getByRole('button', { name: /^Фильтровать/ }).click()
  const search = picker.getByLabel('Поиск упражнения', { exact: true })
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('Жим')
  await search.fill('Присед')
  await picker.getByRole('group', { name: 'Группа мышц', exact: true }).getByRole('button', { name: 'Ноги', exact: true }).click()
  const equipment = picker.getByRole('combobox', { name: 'Оборудование', exact: true })
  await equipment.selectOption('Штанга')
  await equipment.scrollIntoViewIfNeeded()
  await expect(equipment).toBeInViewport()
  const apply = picker.getByRole('button', { name: 'Показать упражнения', exact: true })
  await apply.scrollIntoViewIfNeeded()
  await expect(apply).toBeInViewport()
  await page.screenshot({ path: info.outputPath('filters-bottom.png') })
  await apply.click()
  await expect(search).toHaveValue('Присед')
  const add = picker.getByRole('button', { name: /^Добавить.*2/ })
  await expect(add).toBeEnabled()
  const overflow = await picker.evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await add.click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.planned-exercise')).toHaveCount(2)
})

test('client catalog reference Live batch retry keeps idempotent commands and confirmed facts', async ({ page }) => {
  const original = restTimerWorkout()
  original.exercises[0]!.sets[0]!.confirmedAt = '2026-10-08T09:00:00Z'
  original.exercises[0]!.sets[0]!.fact = { weightKg: 40, reps: 12 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [original], failAppendAfterCommitAt: 2 })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Ещё упражнение', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await expect(picker).toHaveClass(/client-reference-catalog/)
  await expect(picker.getByRole('button', { name: /^Добавить.*0/ })).toBeDisabled()
  for (const name of ['Жим гантелей сидя', 'Планка', 'Присед со штангой']) {
    await picker.getByLabel('Поиск упражнения').fill(name)
    await picker.getByRole('button', { name: `Выбрать: ${name}`, exact: true }).click()
  }
  expect(backend.getAppendCommands()).toHaveLength(0)
  await picker.getByRole('button', { name: /^Добавить.*3/ }).click()
  await expect(picker.getByRole('alert')).toContainText('повторите добавление остальных')
  await expect(picker.getByRole('button', { name: /^Добавить.*2/ })).toBeEnabled()
  const pending = backend.getAppendCommands()[1]
  await picker.getByRole('button', { name: /^Добавить.*2/ }).click()
  await expect(picker).toHaveCount(0)
  const commands = backend.getAppendCommands()
  expect(commands).toHaveLength(4)
  expect(commands[2]).toEqual(pending)
  expect(backend.getWorkouts()[0]!.exercises).toHaveLength(4)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]).toMatchObject({ confirmedAt: '2026-10-08T09:00:00Z', fact: { weightKg: 40, reps: 12 } })
})

test('client catalog reference also applies in Today and does not reach another client', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
  await page.goto('/me?entry=workout')
  await page.getByRole('button', { name: 'Выбрать упражнения вручную', exact: true }).click()
  await expect(page.locator('.client-reference-catalog')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [] })
  await openClientReferenceCatalog(page)
  await expect(page.locator('.client-reference-catalog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toBeVisible()
})


for (const theme of ['dark', 'light']) test(`client catalog reference empty search and own exercise retry ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], failFirstCustomExerciseSave: true })
  const picker = await openClientReferenceCatalog(page)
  await picker.getByLabel('Поиск упражнения').fill('Тестовое новое движение 641')
  await expect(picker.getByText('Ничего не найдено', { exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  await expect(picker.getByRole('heading', { name: 'Своё упражнение', exact: true })).toBeVisible()
  await picker.getByLabel('Название', { exact: true }).fill('Тестовое новое движение 641')
  await picker.locator('.picker-categories').getByRole('button', { name: 'Ноги', exact: true }).click()
  await picker.getByLabel('Описание', { exact: true }).fill('Проверка длинного описания и прокрутки формы. '.repeat(6))
  const save = picker.getByRole('button', { name: 'Сохранить упражнение', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  await save.click()
  await expect.poll(() => backend.getCustomExerciseSaveAttempts()).toBe(1)
  await expect(picker.getByLabel('Название', { exact: true })).toHaveValue('Тестовое новое движение 641')
  await expect(picker.locator('.error')).toBeVisible()
  await page.screenshot({ path: info.outputPath('own-exercise-error.png') })
  await save.click()
  await expect.poll(() => backend.getCustomExerciseSaveAttempts()).toBe(2)
  await expect(picker.getByRole('heading', { name: 'Выберите упражнения', exact: true })).toBeVisible()
  await expect(picker.getByRole('button', { name: /^Добавить.*1/ })).toBeEnabled()
  await picker.getByRole('button', { name: /^Добавить.*1/ }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.planned-exercise')).toHaveCount(1)
})


for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client date reference retains cancel apply clear Enter and year rollover ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'))
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId; plan.workoutDate = '2026-12-20'; plan.startTime = '10:00'; plan.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  const writes: Array<{ workoutDate: string; startTime?: string | null; endTime?: string | null }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  await page.goto(`/workouts/${workoutId}/edit`)
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await expect(trigger).toContainText('10:00')
  const before = await trigger.innerText()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  const selected = dialog.locator('.fit-lime-month-grid button[aria-pressed=true]')
  await expect(selected).toHaveAttribute('aria-current', 'date')
  const marker = selected.locator('.lime-calendar-day-marker')
  await expect(marker).toHaveCSS('width', '36px')
  await expect(marker).toHaveCSS('height', '36px')
  await expect(marker).toHaveCSS('border-radius', '50%')
  expect((await selected.boundingBox())!.width).toBeGreaterThanOrEqual(44)
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveCSS('min-height', '48px')
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveCSS('border-radius', '16px')
  await expect(dialog.getByRole('heading', { name: 'Дата и время', exact: true })).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => { const faces = await document.fonts.load('16px "YS Geo"', 'Дата'); return faces.length > 0 && faces.every(face => face.status === 'loaded') })).toBe(true)
  await page.screenshot({ path: info.outputPath('date-window.png') })
  await dialog.getByRole('button', { name: '21 декабря 2026 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).fill('12:30')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toHaveText(before, { useInnerText: true })
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(selected).toHaveAttribute('aria-label', '20 декабря 2026 г.')
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveValue('10:00')
  await dialog.getByRole('button', { name: 'Следующий месяц', exact: true }).click()
  await dialog.getByRole('button', { name: '1 января 2027 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).fill('23:30')
  await dialog.getByLabel('Окончание', { exact: true }).fill('00:15')
  await dialog.getByLabel('Окончание', { exact: true }).press('Enter')
  await expect(dialog).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await expect(trigger).toContainText('1 января 2027 г.')
  await expect(trigger).toContainText('23:30')
  await expect(trigger).toContainText('00:15')
  await trigger.click()
  await dialog.getByLabel('Начало', { exact: true }).fill('')
  await dialog.getByLabel('Окончание', { exact: true }).fill('')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await expect(trigger).toContainText('Без времени')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.workoutDate).toBe('2027-01-01')
  expect(writes[0]!.startTime ?? null).toBeNull()
  expect(writes[0]!.endTime ?? null).toBeNull()
})

test('client date reference preserves parent validation and midnight duration', async ({ page }) => {
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId; plan.startTime = null; plan.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  const writes: Array<{ startTime?: string; endTime?: string }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.getByRole('button', { name: 'Выбрать дату и время', exact: true })).toContainText('11:00')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Укажите время начала тренировки')
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Выбрать дату и время', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  await dialog.getByLabel('Начало', { exact: true }).fill('23:30')
  await dialog.getByLabel('Окончание', { exact: true }).fill('00:15')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ startTime: '23:30', endTime: '00:15' })
})

for (const mode of ['planned', 'completed']) test(`client date reference Today save keeps date and start across back ${mode}`, async ({ page }) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
  await page.goto('/me?entry=workout')
  await page.getByLabel('Тренировка', { exact: true }).fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  if (mode === 'completed') await page.getByRole('button', { name: 'Записать выполненную', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  const start = dialog.getByLabel(mode === 'planned' ? 'Время' : 'Время начала', { exact: true })
  await start.fill('12:30')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  const value = await trigger.innerText()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(trigger).toHaveText(value, { useInnerText: true })
  if (mode === 'completed') await page.getByLabel('Длительность тренировки, мин', { exact: true }).fill('45')
  await page.getByRole('button', { name: mode === 'planned' ? 'Запланировать тренировку' : 'Записать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  expect(backend.getWorkouts()[0]!.startTime).toBe('12:30')
})
