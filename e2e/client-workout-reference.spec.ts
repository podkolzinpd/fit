import { expect, test, type Page } from '@playwright/test'
import { beginClientGesture, coachGestureWorkout, restTimerWorkout, holdClientLiveCard, mockClientStreamingVoice, mockPilot, newWorkoutId, workoutId, conversationId, messageId, clientId } from './fit-lime-fixtures'

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

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client folds completed exercise without stopping overdue rest ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLiveDensity.${id}`, density); localStorage.setItem(`fit.clientLime.theme.${id}`, theme) }, { id: pilotId, theme, density })
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
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const card = page.locator('.live-exercise').filter({ has: row })
    await card.locator('.overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Свернуть', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(compact).toBeVisible()
    await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /Отдых превышен/)
    await page.screenshot({ path: info.outputPath(`folded-again-${width}.png`) })
    await compact.click()
    await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('35')
    await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe('2026-10-21T08:59:00Z')
  }
})

for (const theme of ['light', 'dark']) test(`client completed collapse waits for pending and failed edits ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = coachGestureWorkout(), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  exercise.sets.forEach(set => { set.confirmedAt = '2026-10-21T08:59:00Z'; set.fact = { weightKg: 30, reps: 10 } })
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let release!: () => void, mode: 'pending' | 'error' | 'success' = 'pending', attempts = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/workout-sets/*/draft', async route => {
    attempts += 1
    if (mode === 'pending') await gate
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.workout-exercise-compact').first().click()
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  const field = row.getByLabel('Фактический вес', { exact: true })
  const card = page.locator('.live-exercise').filter({ has: row })
  await field.fill('35'); await field.blur()
  await expect.poll(() => attempts).toBeGreaterThan(0)
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeDisabled()
  mode = 'success'; release()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(35)
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  mode = 'error'
  await field.fill('37.5'); await field.blur()
  await expect(row.locator('.save-status-error')).toBeVisible()
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  mode = 'success'
  await field.focus(); await field.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(37.5)
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Свернуть', exact: true }).click()
  await expect(row).toHaveCount(0)
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
    await expect(page.locator('.coach-live-digits')).toHaveCSS('font-family', /Doto/)
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
  const clock = page.locator('.client-reference-pause')
  await expect(clock).toHaveCount(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500)
  const cardTop = await page.locator('.live-exercise').first().evaluate(el => el.getBoundingClientRect().top)
  await clock.click()
  // The test clock is frozen; deliver the existing query notification timer.
  await page.clock.runFor(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'true')
  await expect(clock).toHaveText('Продолжить')
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
  const clock = page.locator('.client-reference-pause')
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  await expect(clock).toHaveText('Продолжить')
  await page.clock.fastForward(10_000)
  await page.reload()
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  expect(pauses).toEqual([])
  await page.getByRole('button', { name: 'Старт подхода' }).first().click()
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await expect(clock).toHaveText('Пауза')
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
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
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
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
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

test('client plan requires the current profile and preserves dictated drafts across profile and save failures', async ({ page }, info) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true,
    workouts: [], failClients: true, failFirstSave: true })
  const transcript = 'Приседания один подход десять повторений'
  await page.addInitScript(({ id, transcript }) => {
    const draft = { screen: 'save', text: transcript, reviewedText: transcript, lastLlmText: transcript,
      choices: {}, clientId: '10000000-0000-4000-8000-000000000099', recordMode: 'planned',
      workoutDate: '2026-10-22', startTime: '', items: [{
        line: transcript, hasValues: true, exercise: { source: 'system', ref: 'squat',
          name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength' },
        sets: [{ position: 0, weightKg: 22.5, reps: 10 }],
      }] }
    for (const draftId of ['access-probe', 'independent']) {
      const key = 'fit.today-draft.' + id + '.plan.client-' + draftId
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(draft))
    }
    localStorage.setItem('fit.client-today-drafts.' + id, JSON.stringify(['access-probe', 'independent']))
  }, { id: pilotId, transcript })
  await page.goto('/me?view=save&draft=access-probe')
  const save = page.getByRole('button', { name: 'Запланировать тренировку', exact: true })
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeVisible()
  await expect(save).toHaveCount(0)
  expect(backend.getSaveAttempts()).toBe(0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(({ id, theme }) => {
      localStorage.setItem('fit.clientLime.theme.' + id, theme)
      window.dispatchEvent(new Event('fit-client-lime-theme-change'))
    }, { id: pilotId, theme })
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('plan-profile-error-' + theme + '-' + width + '.png'), fullPage: true })
    }
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeVisible()
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).first().click()
  await expect(save).toBeEnabled()
  // The form is now mounted. A failed background profile refresh must not
  // fall back to the obsolete card embedded in this restored draft.
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await picker.getByLabel('Поиск упражнения').fill('Synthetic new movement 643')
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  await picker.getByLabel('Название', { exact: true }).fill('Synthetic new movement 643')
  await picker.locator('.picker-categories').getByRole('button', { name: 'Ноги', exact: true }).click()
  await picker.getByRole('button', { name: 'Сохранить упражнение', exact: true }).click()
  await picker.getByRole('button', { name: /^Добавить.*1/ }).click()
  await expect(picker).toHaveCount(0)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  backend.setClientsFailure(true)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Не удалось открыть профиль спортсмена.', { exact: false })).toBeVisible()
  await expect(save).toBeDisabled()
  await page.screenshot({ path: info.outputPath('profile-refresh-error.png'), fullPage: true })
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).first().click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page.locator('.error').filter({ hasText: 'временно недоступен' }).first()).toBeVisible()
  const draftKey = 'fit.today-draft.' + pilotId + '.plan.client-access-probe'
  await expect.poll(() => page.evaluate(key => {
    const draft = JSON.parse(localStorage.getItem(key) ?? '{}') as { text?: string }
    return draft.text
  }, draftKey)).toBe(transcript)
  const retained = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}') as { lastLlmText?: string; items?: { sets?: { weightKg?: number }[] }[] }, draftKey)
  expect(retained.lastLlmText).toBe(transcript)
  expect(retained.items?.[0]?.sets?.[0]?.weightKg).toBe(22.5)
  await page.reload()
  await expect(save).toBeEnabled()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await save.click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(2)
  await expect(page).toHaveURL(new RegExp('/workouts/' + newWorkoutId))
  expect(backend.getWorkouts()[0]?.clientId).toBe(clientId)
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull()
  expect(await page.evaluate(id => localStorage.getItem('fit.today-draft.' + id + '.plan.client-independent'), pilotId)).not.toBeNull()
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
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
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
  await expect(picker.locator('.coach-catalog-add')).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true })).toBeDisabled()
  for (const name of ['Жим гантелей сидя', 'Планка', 'Присед со штангой']) {
    await picker.getByLabel('Поиск упражнения').fill(name)
    await picker.getByRole('button', { name: `Выбрать: ${name}`, exact: true }).click()
  }
  expect(backend.getAppendCommands()).toHaveLength(0)
  await picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true }).click()
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
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
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
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
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


for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client swipe set cancel delete protects facts ${theme} ${density}`, async ({ page, browserName }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = restTimerWorkout(), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  exercise.sets[0]!.confirmedAt = new Date().toISOString()
  exercise.sets[0]!.fact = { weightKg: 30, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let attempts = 0
  await page.route('**/v1/workout-sets/*', route => { if (route.request().method() === 'DELETE') attempts += 1; return route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  const second = page.locator(`form[data-live-set-id="${exercise.sets[1]!.id}"]`)
  const gesture = await beginClientGesture(page, second, browserName, second.getByLabel('Фактический вес', { exact: true }))
  await gesture.move(60); await gesture.end()
  const remove = second.getByRole('button', { name: /Удалить подход 2:/ })
  await expect(remove).toBeVisible()
  await expect(second.getByLabel('Фактический вес', { exact: true })).not.toBeFocused()
  await expect(first.locator('.workout-swipe-action')).toBeHidden()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(attempts).toBe(0)
  const again = await beginClientGesture(page, second, browserName, second.locator('.live-set-number'))
  await again.move(36); await again.end()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(second).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
  await page.locator('.workout-exercise-compact').click()
  await expect(first.getByLabel('Фактический вес', { exact: true })).toHaveValue('30')
  const protectedGesture = await beginClientGesture(page, first, browserName, first.locator('.live-set-number'))
  await protectedGesture.move(36); await protectedGesture.end()
  await expect(first.locator('.workout-swipe-action')).toHaveCount(0)
  await first.getByLabel('Фактический вес', { exact: true }).fill('32')
  await first.getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(32)
  await expect(first).toHaveClass(/confirmed/)
  await page.screenshot({ path: info.outputPath('client-set-swipe.png') })
})

for (const withTrainer of [true, false]) for (const animation of [true, false]) test(`client swipe exercise preserves unrelated rest trainer-${withTrainer} animation-${animation}`, async ({ page, browserName }, info) => {
  await page.addInitScript(({ id, animation }) => localStorage.setItem(`fit.liveExerciseAnimation.${id}`, String(animation)), { id: pilotId, animation })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  if (!withTrainer) { source.trainerId = pilotId; source.createdBy = pilotId; source.trainingFormat = 'self' }
  const exercise = source.exercises[0]!, target = source.exercises[1]!
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source], ...(withTrainer ? {} : { clientTrainerId: pilotId }) })
  let attempts = 0
  await page.route('**/v1/workouts/*/exercises/*', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    attempts += 1
    const current = backend.getWorkouts()[0]!
    current.exercises = current.exercises.filter(item => item.id !== target.id).map((item, position) => ({ ...item, position }))
    current.version += 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: current.version } }) })
  })
  await page.route('**/v1/workout-sets/*/draft', async route => {
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  await first.getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await first.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(first).toHaveClass(/confirmed/)
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /отдыха/)
  // An unsaved field must not blur-disable the already enabled rail between
  // pointerdown and click. Opening confirmation may blur; deleting waits for it.
  await page.locator(`form[data-live-set-id="${exercise.sets[1]!.id}"]`).getByLabel('Фактический вес', { exact: true }).fill('32')
  const card = page.locator(`[data-workout-block="${target.blockId}"]`)
  const title = page.getByRole('heading', { name: target.name, exact: true })
  // The heading is a button in the client composition; short taps and full-card
  // holds remain available while a horizontal gesture can reveal deletion.
  const surface = page.locator('[data-workout-swipe]').filter({ has: title }).first()
  const gesture = await beginClientGesture(page, surface, browserName, title)
  await gesture.move(100); await gesture.end()
  const remove = surface.getByRole('button', { name: 'Удалить', exact: true })
  await expect(remove).toBeVisible()
  await remove.click()
  await expect(page.getByRole('alertdialog')).toContainText('включая выполненные')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(attempts).toBe(0)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(32)
  const again = await beginClientGesture(page, surface, browserName, title)
  await again.move(100); await again.end()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(title).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(backend.getWorkouts()[0]!.exercises.map(item => item.name)).toEqual([source.exercises[0]!.name, source.exercises[2]!.name])
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(32)
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /отдыха/)
  await expect(first).toHaveClass(/confirmed/)
  await expect(card).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('client-exercise-swipe.png') })
})

for (const conflict of [false, true]) test(`client swipe retry protects concurrent result conflict-${conflict}`, async ({ page, browserName }) => {
  const source = restTimerWorkout(), target = source.exercises[0]!.sets[1]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let attempts = 0
  await page.route('**/v1/workout-sets/*', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    attempts += 1
    if (conflict) {
      const current = backend.getWorkouts()[0]!, set = current.exercises[0]!.sets[1]!
      current.version += 1; set.version += 1; set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 42.5, reps: 8 }
      return route.fulfill({ status: 409, json: { error: 'workout_conflict' } })
    }
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`form[data-live-set-id="${target.id}"]`)
  const gesture = await beginClientGesture(page, row, browserName, row.getByLabel('Фактический вес', { exact: true }))
  await gesture.move(60); await gesture.end()
  await row.getByRole('button', { name: /Удалить подход 2:/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Повторить удаление подхода', exact: true })
  if (conflict) {
    await expect(row).toHaveClass(/confirmed/)
    await expect(retry).toBeDisabled()
    await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('42.5')
    expect(attempts).toBe(1)
  } else {
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(row).toHaveCount(0)
    expect(attempts).toBe(2)
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
  }
})

test('client compact card trusted tap swipe and full-card hold remain distinct', async ({ page, browserName }) => {
  const source = coachGestureWorkout(), target = source.exercises[1]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  target.sets.forEach(set => { set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 25, reps: 10 } })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const card = page.locator(`[data-workout-block="${target.blockId}"]`)
  const compact = card.locator('.workout-exercise-compact')
  await compact.tap()
  await expect(card.locator('form[data-live-set-id]')).toHaveCount(2)
  // Reload returns to the saved completed-card representation.
  await page.reload()
  const gesture = await beginClientGesture(page, card, browserName, compact)
  await gesture.move(100); await gesture.end()
  await expect(card.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible()
  await expect(card.locator('form[data-live-set-id]')).toHaveCount(0)
  await card.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await holdClientLiveCard(page, target.blockId)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/dragging/)
  await expect(compact).toBeVisible()
})

test('client swipe last added superset round uses existing atomic removal', async ({ page, browserName }) => {
  const source = coachGestureWorkout(true, 2), first = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const commands: string[] = []
  await page.route('**/blocks/*/rounds', async route => {
    const current = backend.getWorkouts()[0]!
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
    current.exercises.forEach((exercise, index) => { exercise.sets.push({ ...exercise.sets.at(-1)!, id: `c11e0000-6010-4000-8000-0000000008${index}2`, position: 2, fact: {}, confirmedAt: null }); exercise.blockRounds = 3 })
    current.version += 1; commands.push('append')
    await route.fulfill({ json: { block: { id: first.blockId, version: current.version, replayed: false } } })
  })
  await page.route('**/blocks/*/rounds/2', async route => {
    const current = backend.getWorkouts()[0]!
    expect(route.request().method()).toBe('DELETE')
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
    expect(current.exercises.every(exercise => exercise.sets.at(-1)?.position === 2 && !exercise.sets.at(-1)?.confirmedAt && Object.keys(exercise.sets.at(-1)!.fact).length === 0)).toBe(true)
    current.exercises.forEach(exercise => { exercise.sets = exercise.sets.filter(set => set.position !== 2); exercise.blockRounds = 2 })
    current.version += 1; commands.push('remove')
    await route.fulfill({ json: { block: { id: first.blockId, version: current.version, replayed: false } } })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const group = page.locator('.exercise-block.live')
  await group.getByRole('button', { name: 'Круг', exact: true }).click()
  await expect(group.locator('.circuit-round')).toHaveCount(3)
  const round = group.locator('.circuit-round').last()
  await round.getByRole('button', { name: /Круг 3/ }).click()
  const row = round.locator('[data-live-set-id]').first()
  const swipe = async () => { const gesture = await beginClientGesture(page, row, browserName, row.getByLabel('Фактический вес', { exact: true })); await gesture.move(60); await gesture.end() }
  await swipe()
  await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(commands).toEqual(['append'])
  await swipe()
  await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Убрать', exact: true }).click()
  await expect(group.locator('.circuit-round')).toHaveCount(2)
  expect(commands).toEqual(['append', 'remove'])
  expect(backend.getWorkouts()[0]!.exercises.map(exercise => exercise.sets.length)).toEqual([2, 2])
})


for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client header SVG paired actions preserve overdue rest ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-21T08:58:00Z'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('button.coach-live-clock')).toHaveCount(0)
  const actions = page.locator('.client-reference-timer-actions'), pause = actions.locator('.client-reference-pause'), rest = actions.locator('.live-rest-trigger')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const a = (await pause.boundingBox())!, b = (await rest.boundingBox())!
    expect(a.height).toBe(density === 'compact' ? 48 : 60); expect(b.height).toBe(a.height)
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1)
    expect(b.x - (a.x + a.width)).toBe(2)
    expect(a.y).toBe(b.y)
    await expect(pause).toHaveCSS('border-radius', '20px')
    await expect(rest).toHaveCSS('border-radius', '20px')
    await page.screenshot({ path: info.outputPath(`header-${width}.png`) })
  }
  await page.locator('form[data-live-set-id]').first().getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(page.locator('.coach-live-digits')).toHaveAttribute('aria-label', /Отдых:/)
  await page.clock.fastForward(4000)
  await expect(rest).toHaveAttribute('aria-label', /Отдых превышен/)
  await expect(page.locator('.coach-live-digits')).toHaveAttribute('aria-label', /Тренировка:/)
  await expect(page.locator('.coach-live-status')).toContainText('Live')
  await expect(page.locator('.coach-live-digits')).toHaveCSS('font-family', /Doto/)
})

for (const entry of ['live', 'new', 'today']) for (const theme of ['light', 'dark']) for (const width of [390, 430]) test(`client catalog actions SVG state and header ${entry} ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(entry === 'live' ? `/workouts/${workoutId}/live` : entry === 'new' ? '/workouts/new' : '/me?entry=workout')
  await page.getByRole('button', { name: entry === 'live' ? 'Ещё упражнение' : entry === 'new' ? 'Выбрать упражнения' : 'Выбрать упражнения вручную', exact: true }).click()
  const picker = page.locator('.client-reference-catalog'), headerAdd = picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true })
  await expect(headerAdd).toBeDisabled()
  await expect(picker.locator('.coach-catalog-add, .coach-catalog-clear')).toHaveCount(0)
  await expect(picker.locator('.coach-catalog-create-bar')).toHaveCSS('position', 'absolute')
  await expect(picker.getByRole('button', { name: 'Создать упражнение', exact: true })).toBeVisible()
  const zeroListHeight = (await picker.locator('.picker-list').boundingBox())!.height
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('Жим')
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await expect(headerAdd).toBeEnabled()
  await expect(picker.locator('.coach-catalog-add')).toContainText('(2)')
  await picker.getByRole('button', { name: /^Фильтровать/ }).click()
  await expect(picker.getByLabel('Поиск упражнения', { exact: true })).toHaveValue('Жим')
  await picker.getByRole('button', { name: 'Применить фильтры', exact: true }).click()
  await expect(picker.locator('.picker-filter-panel')).toHaveCount(0)
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  await picker.getByRole('button', { name: 'Очистить', exact: true }).click()
  await expect(headerAdd).toBeDisabled()
  await expect(picker.locator('.coach-catalog-add')).toHaveCount(0)
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('')
  expect((await picker.locator('.picker-list').boundingBox())!.height).toBeGreaterThanOrEqual(zeroListHeight - 1)
  await page.screenshot({ path: info.outputPath('catalog-zero.png') })
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await page.screenshot({ path: info.outputPath('catalog-selected.png') })
  await headerAdd.click()
  await expect(picker).toHaveCount(0)
  if (entry === 'live') await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(source.exercises.length + 2)
  else await expect(page.locator('.planned-exercise')).toHaveCount(2)
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) test(`client time sheets keep draft seconds cancel and rest ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = restTimerWorkout(0, true, 'manual'); source.startedAt = '2026-10-21T08:58:00Z'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const trigger = page.getByRole('button', { name: /Фактическое время:/ }).first()
  await trigger.click()
  const duration = page.getByRole('dialog', { name: 'Фактическое время', exact: true })
  await expect(duration).toHaveClass(/client-reference-time-sheet/)
  await expect(duration).toHaveCSS('border-top-left-radius', '40px')
  await expect(duration.locator('.client-lime-sheet-header h1')).toHaveCSS('font-family', /YS Geo/)
  await duration.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '10 секунды', exact: true }).click()
  await duration.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
  await expect(trigger).toHaveAttribute('aria-label', 'Фактическое время: 0:03')
  await trigger.click()
  await expect(duration.getByRole('option', { name: '03 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
  await duration.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '10 секунды', exact: true }).click()
  await page.screenshot({ path: info.outputPath('duration-sheet.png') })
  await duration.getByRole('button', { name: 'Применить · 0:10', exact: true }).click()
  await page.clock.runFor(800)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(10)
  await trigger.click()
  await duration.getByRole('button', { name: 'Убрать время', exact: true }).click()
  await expect(duration).toHaveCount(0)
  const restTrigger = page.locator('.live-rest-trigger')
  await restTrigger.click()
  const rest = page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })
  await expect(rest).toHaveClass(/client-reference-time-sheet/)
  await expect(rest.locator('.client-lime-sheet-header')).toBeVisible()
  const mode = rest.getByRole('group', { name: 'Кто ведёт тренировку', exact: true })
  await expect(mode).toHaveCSS('border-radius', '20px')
  for (const button of await mode.getByRole('button').all()) {
    await expect(button).toHaveCSS('border-radius', '16px')
    await expect(button).toHaveCSS('min-height', '48px')
    await expect(button).toHaveCSS('font-weight', '500')
  }
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await rest.getByRole('listbox', { name: 'минуты', exact: true }).getByRole('option', { name: '00 минуты', exact: true }).click()
  await rest.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '00 секунды', exact: true }).click()
  await expect(rest.getByRole('button', { name: 'Начать отдых · 0:00', exact: true })).toBeDisabled()
  await rest.getByRole('button', { name: '1:00', exact: true }).click()
  await page.screenshot({ path: info.outputPath('rest-sheet.png') })
  await rest.getByRole('button', { name: 'Начать отдых · 1:00', exact: true }).click()
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:00')
  await restTrigger.click()
  await rest.getByRole('button', { name: 'Остановить отдых', exact: true }).click()
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const role of ['trainer', 'client']) test(`time sheet client adaptation stays gated ${role}`, async ({ page }) => {
  const source = restTimerWorkout(0, true, 'manual'); source.startedAt = new Date(Date.now() - 120000).toISOString()
  await mockPilot(page, { role: role as 'trainer' | 'client', profileId: role === 'client' ? 'c11e0000-6010-4000-8000-000000000002' : 'c0ac0000-6010-4000-8000-000000000001', clientLime: true, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: /Фактическое время:/ }).first().click()
  await expect(page.locator('.workout-duration-sheet')).toBeVisible()
  await expect(page.locator('.client-reference-time-sheet')).toHaveCount(0)
})

test('client rest mode selection survives close and reload without recording strength facts', async ({ page }) => {
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const initial = JSON.stringify(backend.getWorkouts()[0]!.exercises)
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.live-rest-trigger').click()
  const mode = page.getByRole('group', { name: 'Кто ведёт тренировку', exact: true })
  await mode.getByRole('button', { name: 'Ведёт таймер', exact: true }).click()
  await expect(mode.getByRole('button', { name: 'Ведёт таймер', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await mode.getByRole('button', { name: 'Веду сам', exact: true }).click()
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await page.reload()
  await page.locator('.live-rest-trigger').click()
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initial)
})

test.describe('assistant duration consumers', () => {
  test.skip(process.env.FIT_ASSISTANT_TIME_ACCEPTANCE !== '1', 'Requires isolated Assistant program fixture, never a live generation')
  for (const entry of ['history', 'pilot']) for (const theme of ['light', 'dark']) test(`client assistant time sheet ${entry} ${theme}`, async ({ page }, info) => {
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem('fit.workoutTimeWheel', 'true')
    }, { id: pilotId, theme })
    await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
    const createdAt = new Date().toISOString()
    const payload = entry === 'pilot'
      ? { programPilot: true, step: 'confirm', briefState: { scope: 'single_workout' }, editableCatalog: [{ ref: 'plank', name: 'Планка', inputKind: 'duration' }],
          canonicalWorkouts: [{ requestId: newWorkoutId, clientId, workoutDate: createdAt.slice(0, 10), exercises: [{ name: 'Планка', restBetweenSetsSec: 60, sets: [{ durationSec: 45, rpe: 6 }] }] }] }
      : { step: 'confirm', clientId, clientName: 'Тестовый спортсмен', sessions: [{ day: 'Пн', title: 'Тестовая тренировка', exercises: [{ name: 'Планка', exerciseRef: 'plank', sets: 3, durationSec: 45 }] }] }
    const action = { tool: 'create_program_draft', status: 'proposed', title: 'Тестовая тренировка', description: 'Черновик из тестовой фикстуры', payload }
    const writes: string[] = []
    await page.route('**/v1/assistant/**', route => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') { writes.push(path); return route.abort() }
      if (path.endsWith('/messages')) return route.fulfill({ json: { messages: [{ id: messageId, conversationId, turnId: null, author: 'assistant', content: 'Тестовый черновик', action, createdAt }] } })
      if (path.endsWith('/conversations')) return route.fulfill({ json: { conversations: [{ id: conversationId, title: 'Тестовая беседа', createdAt }] } })
      return route.fulfill({ json: { actions: [] } })
    })
    await page.goto('/assistant')
    const session = page.locator('.assistant-program-sessions details').first()
    await session.locator('summary').click()
    if (entry === 'pilot') await session.getByRole('button', { name: 'Изменить', exact: true }).click()
    const label = entry === 'pilot' ? 'Время упражнения' : 'Планка: время'
    const trigger = page.getByRole('button', { name: `${label}: 0:45`, exact: true })
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await expect(dialog).toHaveClass(/client-reference-time-sheet/)
      await expect(dialog).toHaveCSS('border-top-left-radius', '40px')
      await expect(dialog.locator('.client-lime-sheet-header h1')).toHaveCSS('font-family', /YS Geo/)
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '50 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
      await expect(trigger).toHaveAttribute('aria-label', `${label}: 0:45`)
      await trigger.click()
      await expect(dialog.getByRole('option', { name: '45 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.screenshot({ path: info.outputPath(`assistant-${entry}-${theme}-${width}.png`) })
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '50 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Применить · 0:50', exact: true }).click()
      await expect(page.getByRole('button', { name: `${label}: 0:50`, exact: true })).toBeVisible()
      await page.getByRole('button', { name: `${label}: 0:50`, exact: true }).click()
      await expect(dialog.getByRole('option', { name: '50 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '45 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Применить · 0:45', exact: true }).click()
      await expect(trigger).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect(writes).toEqual([])
  })
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client inline save feedback stays clear and stable ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/workout-sets/*/draft', async route => { await waiting; await route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first()
  const before = (await row.boundingBox())!.height
  await row.getByLabel('Фактический вес', { exact: true }).fill('25')
  await row.getByLabel('Фактические повторы', { exact: true }).click()
  await expect(row.locator('.save-status-saving')).toBeVisible()
  expect((await row.boundingBox())!.height).toBe(before)
  release()
  await expect(row.locator('.save-status-saved')).toHaveCount(0)
  await expect(row.locator('.save-status-saving')).toHaveCount(0)
  expect((await row.boundingBox())!.height).toBe(before)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(25)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const status = row.locator('.save-status')
    if (await status.count()) {
      await expect(status).toHaveCSS('position', 'static')
      const a = (await status.boundingBox())!, b = (await row.locator('.live-set-grid').boundingBox())!
      expect(a.y).toBeGreaterThanOrEqual(b.y + b.height)
    }
    await page.screenshot({ path: info.outputPath(`save-feedback-${width}.png`) })
  }
  await expect(row.getByRole('button', { name: 'Готово, отдых', exact: true })).toBeEnabled()
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeNull()
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client confirmation error readable and retry keeps facts ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source], failFirstSetConfirm: true })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first(), confirm = row.getByRole('button', { name: 'Готово, отдых', exact: true })
  await row.getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await confirm.click()
  await expect(row.locator('.save-status-error')).toContainText('Не удалось подтвердить')
  const a = (await row.locator('.save-status-error').boundingBox())!, b = (await row.locator('.live-set-grid').boundingBox())!
  expect(a.y).toBeGreaterThanOrEqual(b.y + b.height)
  const sync = page.locator('.live-sync-state.error')
  await expect(sync).toHaveCSS('border-radius', '20px')
  await expect(sync.locator('strong')).toHaveCSS('font-weight', '500')
  await page.screenshot({ path: info.outputPath('confirmation-error.png') })
  if (density === 'compact') {
    // A blur autosave after a failed confirmation must not acknowledge away
    // the pending command that the existing bottom retry needs.
    await row.getByLabel('Фактический вес', { exact: true }).focus()
    await row.getByLabel('Фактический вес', { exact: true }).blur()
    await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
    await expect(sync.getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled()
    await sync.getByRole('button', { name: 'Повторить', exact: true }).click()
  }
  else await confirm.click()
  await expect(row).toHaveClass(/confirmed/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client phase feedback correction and rest undo keep semantics ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(0, true, 'timer'); source.startedAt = '2026-10-21T08:58:00Z'; source.exercises[0]!.restBetweenSetsSec = 30
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.clock.fastForward(3500)
  const notice = page.locator('.live-phase-notice')
  await expect(notice).toContainText('Подход засчитан')
  await expect(notice).toHaveCSS('border-radius', '20px')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const a = (await notice.locator('span').boundingBox())!, b = (await notice.getByRole('button').boundingBox())!
    expect(a.x + a.width).toBeLessThanOrEqual(b.x)
    await page.screenshot({ path: info.outputPath(`phase-notice-${width}.png`) })
  }
  const confirmed = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await notice.getByRole('button', { name: 'Исправить', exact: true }).click()
  await expect(notice).toHaveCount(0)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmed)
  await page.locator('.live-rest-trigger').click()
  await expect(notice).toContainText('Отдых остановлен')
  await notice.getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label', /Таймер отдыха:/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.confirmedAt).toBeNull()
})

function liveContrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / (color.startsWith('color(srgb') ? 1 : 255))
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live metric readability ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(false, 1), exercise = source.exercises[0]!
  exercise.inputKind = 'distance'; exercise.ref = 'running'; exercise.name = 'Бег'; exercise.muscleGroup = 'cardio'
  exercise.sets = exercise.sets.map(set => ({ ...set, weightKg: undefined, reps: undefined, distanceKm: 1.5, durationSec: 600, fact: {} }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const row = page.locator('.live-set.current').first()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const metrics = await row.locator('.run-distance-unit').evaluate(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect()
      return { color: style.color, background: getComputedStyle(element.closest('.run-distance-control')!).backgroundColor, size: parseFloat(style.fontSize), height: box.height, width: box.width }
    })
    expect(liveContrast(metrics.color, metrics.background)).toBeGreaterThanOrEqual(4.5)
    expect(metrics.size).toBeGreaterThanOrEqual(16)
    expect(metrics.height).toBe(density === 'original' ? 54 : 48)
    expect(metrics.width).toBeGreaterThanOrEqual(44)
    const unit = row.locator('.coach-live-field-unit').first()
    expect(await unit.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`readable-metrics-${width}.png`) })
  }
  await row.locator('.workout-duration-trigger').click()
  const wheel = page.getByRole('listbox', { name: 'минуты', exact: true })
  await wheel.focus()
  const focus = await wheel.evaluate(element => {
    const style = getComputedStyle(element)
    return { color: style.outlineColor, background: getComputedStyle(element.closest('[role="dialog"]')!).backgroundColor, width: parseFloat(style.outlineWidth) }
  })
  expect(focus.width).toBeGreaterThanOrEqual(2)
  expect(liveContrast(focus.color, focus.background)).toBeGreaterThanOrEqual(3)
  await page.screenshot({ path: info.outputPath('readable-wheel.png') })
})

for (const theme of ['light', 'dark']) test(`client Live phase text contrast ${theme}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(5, true, 'timer')] })
  await page.goto(`/workouts/${workoutId}/live`)
  const phase = page.locator('.live-rest-trigger')
  for (const label of ['Подготовка', 'Подход']) {
    await expect(phase).toContainText(label)
    const colors = await phase.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
    expect(liveContrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5)
    if (label === 'Подготовка') await page.clock.fastForward(5000)
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live three visible set states ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(false, 1), exercise = source.exercises[0]!
  exercise.sets.push({ ...exercise.sets[1]!, id: '10000000-0000-4000-8000-000000000099', position: 2, fact: {} })
  const confirmedAt = new Date(Date.now() - 60000).toISOString()
  exercise.sets[0]!.confirmedAt = confirmedAt
  exercise.sets[0]!.fact = { weightKg: 20, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const rows = page.locator('form[data-live-set-id]')
  await expect(rows).toHaveCount(3)
  await expect(rows.first().getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(rows.nth(1)).toHaveClass(/current/)
  await expect(rows.nth(2).getByRole('button', { name: 'Готово, отдых', exact: true })).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const states = await rows.locator('.live-set-check').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color, mark: style.boxShadow, height: element.getBoundingClientRect().height }
    }))
    expect(states[0]!.color).not.toBe(states[2]!.color)
    expect(states[0]!.background).not.toBe(states[2]!.background)
    expect(states[1]!.background).not.toBe(states[2]!.background)
    expect(states[0]!.mark).not.toBe('none')
    expect(liveContrast(states[0]!.color, states[0]!.background)).toBeGreaterThanOrEqual(3)
    for (const state of states) expect(state.height).toBe(density === 'original' ? 54 : 48)
    await page.screenshot({ path: info.outputPath(`three-states-${width}.png`) })
  }
  await rows.first().getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await rows.first().getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmedAt)
  await expect(rows.first().getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(page.locator('.live-rest-trigger')).not.toHaveAttribute('aria-label', /Отдых идёт/)
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live media-off header and group menu ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10']))
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(true)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.exercises[0]!.ref = 'barbell-squat'
  source.exercises[1]!.name = 'Жим гантелей на наклонной скамье с длинным названием упражнения'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const header = page.locator('.live-exercise-head').first()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.live-header-animation, .live-exercise-head .exercise-thumbnail')).toHaveCount(0)
    expect((await header.boundingBox())!.height).toBeLessThan(density === 'original' ? 100 : 80)
    const geometry = await page.locator('.live-exercise-head').evaluateAll(headers => headers.map(element => {
      const title = element.querySelector('h2, h3')!.getBoundingClientRect(), menu = element.querySelector('.overflow-trigger')?.getBoundingClientRect()
      return { height: element.getBoundingClientRect().height, titleRight: title.right, menuLeft: menu?.left }
    }))
    for (const item of geometry) {
      expect(item.height).toBeGreaterThanOrEqual(44)
      if (item.menuLeft !== undefined) expect(item.titleRight).toBeLessThanOrEqual(item.menuLeft)
    }
    const menu = page.locator('.circuit-head .overflow-trigger').first()
    await expect(menu).toHaveCSS('border-radius', '0px')
    await expect(menu).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const box = (await menu.boundingBox())!
    expect(box.width).toBe(44); expect(box.height).toBe(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`media-off-${width}.png`) })
  }
  const weight = page.getByLabel('Фактический вес', { exact: true }).first()
  await weight.fill('31.5')
  const original = await weight.elementHandle()
  if (!original) throw new Error('Live field missing')
  await page.evaluate(id => { localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'true'); dispatchEvent(new Event('fit-live-exercise-animation-change')) }, pilotId)
  await expect(header.locator('.live-header-animation, .exercise-thumbnail')).toBeVisible()
  expect(await original.evaluate(element => element.isConnected)).toBe(true)
  expect(await weight.evaluate((element, previous) => element === previous, original)).toBe(true)
  await expect(weight).toHaveValue('31.5')
  await expect(weight).toBeFocused()
  await page.evaluate(id => { localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false'); dispatchEvent(new Event('fit-live-exercise-animation-change')) }, pilotId)
  await expect(header.locator('.live-header-animation, .exercise-thumbnail')).toHaveCount(0)
  await expect(weight).toHaveValue('31.5')
  await weight.blur()
  await page.locator('.circuit-head .overflow-trigger').first().click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

for (const theme of ['light', 'dark']) test(`client Live contextual 503 retains diagnostics and recovers ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { sessionStorage.setItem('test.live.diagnostic', text); return Promise.resolve() } } })
  }, { id: pilotId, theme })
  const source = restTimerWorkout()
  const set = source.exercises[0]!.sets[0]!
  set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 27.5, reps: 9 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let fail = true, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/**', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.includes('/training-data')) return route.fallback()
    await held
    if (fail) return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.getByRole('status', { name: 'Загрузка', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toContainText('Сервис временно недоступен. Попробуйте ещё раз.', { timeout: 25000 })
  await expect(page.getByRole('alert')).not.toContainText('Пилот')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скопировать диагностику', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`error-503-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Скопировать диагностику', exact: true }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test.live.diagnostic'))).toContain('HTTP: 503')
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test.live.diagnostic'))).toContain('Request ID:')
  fail = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  const row = page.locator(`form[data-live-set-id="${set.id}"]`)
  await expect(row).toHaveClass(/confirmed/)
  await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('27.5')
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(set.confirmedAt)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact).toEqual(set.fact)
  await page.screenshot({ path: info.outputPath('retry-restored.png'), fullPage: true })
})

for (const role of ['trainer', 'client'] as const) test(`Live outside client pilot retains 503 fallback ${role}`, async ({ page }) => {
  await mockPilot(page, { role, profileId: role === 'client' ? 'c11e0000-6010-4000-8000-000000000002' : 'c0ac0000-6010-4000-8000-000000000001', clientLime: true, fitLime: true, workouts: [restTimerWorkout()] })
  await page.route('**/v1/**', route => route.request().method() === 'GET' && new URL(route.request().url()).pathname.includes('/training-data') ? route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) : route.fallback())
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.getByRole('alert')).toContainText('Пилот временно недоступен', { timeout: 25000 })
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
})


for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client pilot dense cardio grid and title ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = restTimerWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const exercise = source.exercises[0]!
  exercise.ref = 'walking'; exercise.name = 'Ходьба с достаточно длинным названием упражнения'; exercise.inputKind = 'distance'
  exercise.sets = exercise.sets.map(set => ({ ...set, weightKg: undefined, reps: undefined, durationSec: 300, distanceKm: 1 }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const rows = page.locator('form[data-live-set-id]')
  await expect(rows).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await page.locator('.live-exercise').evaluate(card => {
      const rect = (selector: string) => card.querySelector(selector)!.getBoundingClientRect()
      const header = rect('.live-exercise-head'), title = rect('.exercise-technique-trigger h2'), trigger = rect('.exercise-technique-trigger')
      const time = rect('.workout-duration-trigger'), check = rect('.live-set-check')
      const grids = card.querySelectorAll('.live-set-grid'), first = grids[0]!.getBoundingClientRect(), second = grids[1]!.getBoundingClientRect()
      const style = getComputedStyle(card.querySelector('.live-exercise-head')!)
      const contentHeight = Math.max(trigger.height, card.querySelector('.exercise-thumbnail')?.getBoundingClientRect().height ?? 0, rect('.exercise-head-actions').height)
      return { headerHeight: header.height, contentHeight, paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom), border: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), minHeight: style.minHeight, titleInset: title.x - trigger.x, confirmOffset: check.y - time.y, checkHeight: check.height, timeHeight: time.height, rowGap: second.y - first.bottom }
    })
    await info.attach(`layout-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    expect(geometry.minHeight).toBe('0px')
    expect(geometry.paddingTop).toBe(density === 'original' ? 16 : 12)
    expect(geometry.paddingBottom).toBe(8)
    expect(Math.abs(geometry.headerHeight - geometry.contentHeight - geometry.paddingTop - geometry.paddingBottom - geometry.border)).toBeLessThan(1)
    expect(Math.abs(geometry.titleInset)).toBeLessThan(1)
    expect(Math.abs(geometry.confirmOffset)).toBeLessThan(1)
    expect(geometry.checkHeight).toBe(density === 'original' ? 54 : 48)
    expect(geometry.timeHeight).toBe(geometry.checkHeight)
    expect(geometry.rowGap).toBe(2)
    await expect(rows.first().locator('.live-set-save-feedback')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`dense-cardio-${width}.png`) })
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client matrix clock and rest sheet flow ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-19T09:00:00Z'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const digits = page.locator('.coach-live-digits')
  await expect(digits).toHaveClass(/coach-live-digits-long/)
  await expect(digits).toHaveCSS('font-family', /Doto/)
  expect(await page.evaluate(async () => {
    const loaded = await document.fonts.load('700 64px Doto', '0123456789−+:')
    return loaded.some(font => font.family.replace(/['"]/g, '') === 'Doto' && font.status === 'loaded')
  })).toBe(true)
  const restTrigger = page.locator('.live-rest-trigger')
  for (const height of [844, 568]) for (const width of [390, 430]) {
    await page.setViewportSize({ width, height })
    expect(await digits.evaluate(node => node.getBoundingClientRect().width <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`matrix-clock-${width}-${height}.png`) })
    await restTrigger.click()
    const sheet = page.locator('.live-rest-sheet'), apply = sheet.locator('.live-rest-apply')
    await expect(apply).toHaveCSS('position', 'static')
    await expect(apply).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(apply).toHaveCSS('padding-top', '0px')
    const boxes = await sheet.evaluate(node => {
      const wheels=node.querySelector('.rest-time-picker')!.getBoundingClientRect(), presets=node.querySelector('.rest-presets')!.getBoundingClientRect(), apply=node.querySelector('.live-rest-apply')!.getBoundingClientRect()
      return { wheelBottom:wheels.bottom, presetTop:presets.top, presetBottom:presets.bottom, applyTop:apply.top }
    })
    expect(boxes.presetTop).toBeGreaterThanOrEqual(boxes.wheelBottom)
    expect(boxes.applyTop).toBeGreaterThanOrEqual(boxes.presetBottom)
    await sheet.getByRole('button', { name: '1:00', exact: true }).click()
    await apply.getByRole('button').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`rest-flow-${width}-${height}.png`) })
    await apply.getByRole('button').click()
    await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:00')
    await restTrigger.click()
    const activeFlow = await sheet.evaluate(node => {
      const wheels = node.querySelector('.rest-time-picker')!.getBoundingClientRect(), apply = node.querySelector('.live-rest-apply')!.getBoundingClientRect()
      return { wheelBottom: wheels.bottom, applyTop: apply.top }
    })
    expect(activeFlow.applyTop).toBeGreaterThanOrEqual(activeFlow.wheelBottom)
    await sheet.getByRole('button', { name: '3:00', exact: true }).scrollIntoViewIfNeeded()
    await expect(sheet.getByRole('button', { name: '3:00', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`rest-active-flow-${width}-${height}.png`) })
    await sheet.getByRole('button', { name: 'Плюс 15 секунд', exact: true }).click()
    await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:15')
    await sheet.getByRole('button', { name: 'Остановить отдых', exact: true }).click()
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const length of ['empty', 'short', 'long']) test(`client workout note disclosure ${theme} ${density} ${length}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.notes = length === 'empty' ? '  ' : length === 'short' ? 'Спокойный темп.' : ('Полный текст из Ассистента, без сокращения содержимого.\n').repeat(30)
  source.exercises[0]!.trainerComment = 'Сохраняй технику'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const initial = JSON.stringify(backend.getWorkouts()[0])
  await page.goto(`/workouts/${workoutId}/live`)
  // The empty-note branch must prove the real pilot Live mounted before
  // asserting absence; an unmounted/welcome page is not empty-state proof.
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  await expect(page.locator('form[data-live-set-id]').first()).toBeVisible()
  const note = page.locator('.client-live-workout-note')
  if (length === 'empty') { await expect(note).toHaveCount(0); return }
  await expect(note.locator('summary')).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => {
    const faces = await Promise.all([400, 500].map((weight) => document.fonts.load(weight + ' 16px "YS Geo"', 'Заметка 12')))
    return faces.every((group) => group.length > 0 && group.every((face) => face.status === 'loaded'))
  })).toBe(true)
  await expect(note).not.toHaveAttribute('open', '')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    expect((await note.boundingBox())!.height).toBeLessThanOrEqual(60)
    await note.locator('summary').click()
    await expect(note.locator('p')).toBeVisible()
    expect(await note.locator('p').textContent()).toBe(source.notes)
    await expect(note.locator('p')).toHaveCSS('white-space', 'pre-wrap')
    await expect(note.locator('.live-workout-note-hide')).toBeVisible()
    await note.locator('summary').click()
    await expect(note.locator('p')).toBeHidden()
    await page.screenshot({ path: info.outputPath(`workout-note-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(page.locator('.live-trainer-note')).toContainText('От тренера')
  await expect(page.locator('.live-exercise-note').first()).toContainText('Моя заметка')
  expect(JSON.stringify(backend.getWorkouts()[0])).toBe(initial)
  await page.reload()
  await expect(note.locator('p')).toBeHidden()
  await note.locator('summary').click()
  expect(await note.locator('p').textContent()).toBe(source.notes)
})

// These axes affect touch hitboxes, selected-row colors and keyboard/focus
// geometry. Both engines exercise real swipe events, not a duplicated API test.
for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const width of [390, 430]) test(`client confirmed swipe explicit cancel delete and reload ${theme} ${density} ${width}`, async ({ page, browserName }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-21T08:58:00Z'
  const exercise = source.exercises[0]!, target = exercise.sets[0]!, other = exercise.sets[1]!
  const backend = await mockPilot(page, { role:'client', profileId:pilotId, clientLime:true, workouts:[source] })
  const commands: { expectedSetVersion: number; operationId: string }[] = []
  let releaseDelete!: () => void
  const deleteGate = new Promise<void>(resolve => { releaseDelete = resolve })
  await page.route('**/v1/workout-sets/*', async route => { if(route.request().method()==='DELETE') { commands.push(route.request().postDataJSON() as { operationId: string; expectedSetVersion: number }); await deleteGate } return route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${target.id}"]`), second = page.locator(`form[data-live-set-id="${other.id}"]`)
  await first.getByLabel('Фактический вес', { exact:true }).fill('35')
  await first.getByRole('button', { name:'Готово, отдых', exact:true }).click()
  await expect(first).toHaveClass(/confirmed/)
  const stamp = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await first.getByLabel('Фактический вес', { exact:true }).fill('37.5')
  await first.getByLabel('Фактический вес', { exact:true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(37.5)
  // Editing a confirmed row selects a removal target, never the active work set.
  await expect(second).toHaveClass(/current/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(stamp)
  await second.getByLabel('Фактический вес', { exact:true }).fill('40')
  await second.getByLabel('Фактический вес', { exact:true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(40)
  const version = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.version
  const sibling = JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact)
  const deadline = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  expect(deadline).not.toBeNull()
  const swipe = async () => { const gesture=await beginClientGesture(page,first,browserName,first.locator('.live-set-number')); await gesture.move(60); await gesture.end(); await first.getByRole('button',{name:/Удалить подход 1:/}).click() }
  await swipe()
  await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
  await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click()
  expect(commands).toHaveLength(0); await expect(first).toHaveClass(/confirmed/)
  await swipe()
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(first).toHaveAttribute('aria-busy','true')
  await expect(first).toHaveAttribute('inert','')
  releaseDelete()
  await expect(first).toHaveCount(0)
  expect(commands).toHaveLength(1); expect(commands[0]!.expectedSetVersion).toBe(version)
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact)).toBe(sibling)
  await expect(second.getByLabel('Фактический вес',{exact:true})).toHaveValue('40')
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(deadline)
  await page.clock.fastForward(3000)
  await expect(page.locator('.live-rest-trigger')).toHaveAttribute('aria-label',/Отдых превышен/)
  await expect(page.locator('.coach-live-digits')).toHaveAttribute('aria-label',/Тренировка:/)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 1')
  await expect(second.locator('.workout-swipe-action')).toHaveCount(0)
  await page.reload()
  await expect(first).toHaveCount(0)
  await expect(second.getByLabel('Фактический вес',{exact:true})).toHaveValue('40')
  await page.screenshot({path:info.outputPath('confirmed-delete.png')})
})

for (const theme of ['light','dark']) for (const failure of ['lost','retry','changed']) test(`client confirmed removal response recovery ${theme} ${failure}`, async ({page,browserName}) => {
  await page.clock.install({ time:new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({id,theme})=>localStorage.setItem(`fit.clientLime.theme.${id}`,theme),{id:pilotId,theme})
  const source=restTimerWorkout(); source.startedAt='2026-10-21T08:58:00Z'
  const target=source.exercises[0]!.sets[0]!
  target.confirmedAt='2026-10-21T08:59:00Z';target.fact={weightKg:30,reps:10}
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  const commands: {operationId:string;expectedSetVersion:number}[]=[]
  await page.route('**/v1/workout-sets/*',async route=>{
    if(route.request().method()!=='DELETE')return route.fallback()
    commands.push(route.request().postDataJSON() as { operationId: string; expectedSetVersion: number })
    if(commands.length===1){
      const current=backend.getWorkouts()[0]!, exercise=current.exercises[0]!
      if(failure==='lost'){
        exercise.sets=exercise.sets.filter(set=>set.id!==target.id).map((set,position)=>({...set,position}));current.version+=1
        return route.abort('connectionreset')
      }
      if(failure==='retry')return route.fulfill({status:503,json:{error:'unavailable'}})
      const changed=exercise.sets.find(set=>set.id===target.id)!;changed.version+=1;changed.fact={weightKg:42.5,reps:8}
      // root.version deliberately unchanged, just like a real fact save.
    }
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end()
  await row.getByRole('button',{name:/Удалить подход 1:/}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  const retry=page.getByRole('button',{name:'Повторить удаление подхода',exact:true})
  if(failure==='changed'){
    await expect(row.getByLabel('Фактический вес',{exact:true})).toHaveValue('42.5')
    await expect(retry).toBeDisabled();expect(commands).toHaveLength(1)
    await expect(row).toHaveClass(/confirmed/)
    // A stale approval must stop, but a fresh explicit approval can recover.
    const freshVersion=backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.version
    const again=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await again.move(60);await again.end()
    await row.getByRole('button',{name:/Удалить подход 1:/}).click()
    await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
    await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
    await expect(row).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]!.expectedSetVersion).toBe(freshVersion)
    expect(commands[1]!.operationId).not.toBe(commands[0]!.operationId)
  }else{
    if(failure==='retry'){
      await expect(retry).toBeEnabled();await retry.click()
      expect(commands).toHaveLength(2);expect(commands[1]!.operationId).toBe(commands[0]!.operationId)
      expect(commands[1]!.expectedSetVersion).toBe(commands[0]!.expectedSetVersion)
    }
    await expect(row).toHaveCount(0);await expect(retry).toHaveCount(0)
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
    await page.reload();await expect(row).toHaveCount(0)
    expect(commands).toHaveLength(failure==='lost'?1:2)
  }
})

// Duration uses a focusable time picker; distance adds an editable unit field.
// Their different widths/focus targets caused the WebKit phantom-save race.
for (const theme of ['light','dark']) for (const density of ['original','compact']) for (const kind of ['duration','distance'] as const) for (const width of [390,430]) test(`client confirmed cardio swipe preserves sibling facts ${theme} ${density} ${kind} ${width}`, async ({page,browserName}) => {
  await page.clock.install({time:new Date('2026-10-21T09:00:00Z')})
  await page.setViewportSize({width,height:844})
  await page.addInitScript(({id,theme,density})=>{localStorage.setItem(`fit.clientLime.theme.${id}`,theme);localStorage.setItem(`fit.clientLiveDensity.${id}`,density)}, {id:pilotId,theme,density})
  const source=restTimerWorkout(0,true);source.startedAt='2026-10-21T08:58:00Z'
  const exercise=source.exercises[0]!
  exercise.inputKind=kind;exercise.ref=kind==='distance'?'walking':'plank';exercise.name=kind==='distance'?'Ходьба':'Планка'
  exercise.sets=exercise.sets.map((set,index)=>({...set,durationMin:0,durationSec:30,...(kind==='distance'?{distanceKm:1}:{}),fact:{durationMin:0,durationSec:index===0?45:20,...(kind==='distance'?{distanceKm:index===0?1.2:0.8}:{})},confirmedAt:index===0?'2026-10-21T08:59:00Z':null}))
  const target=exercise.sets[0]!,other=exercise.sets[1]!,sibling=JSON.stringify(other.fact)
  const writes:string[]=[]
  page.on('request',request=>{if(request.url().includes('workout-sets')&&request.method()!=='GET')writes.push(request.method())})
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  await expect(row).toHaveClass(/confirmed/)
  const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end()
  await row.getByRole('button',{name:/Удалить подход 1:/}).click()
  await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(row).toHaveCount(0)
  expect(writes).toEqual(['DELETE'])
  const remaining=backend.getWorkouts()[0]!.exercises[0]!.sets
  expect(remaining).toHaveLength(1);expect(remaining[0]!.id).toBe(other.id);expect(JSON.stringify(remaining[0]!.fact)).toBe(sibling)
  await expect(page.locator(`form[data-live-set-id="${other.id}"] .workout-swipe-action`)).toHaveCount(0)
  await page.reload();await expect(row).toHaveCount(0)
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact)).toBe(sibling)
})

for(const theme of ['light','dark']) for(const kind of ['duration','distance'] as const) test(`client cardio swipe cancel never records planned facts ${theme} ${kind}`,async({page,browserName})=>{
  await page.clock.install({time:new Date('2026-10-21T09:00:00Z')})
  await page.setViewportSize({width:theme==='light'?390:430,height:844})
  await page.addInitScript(({id,theme})=>{localStorage.setItem(`fit.clientLime.theme.${id}`,theme);localStorage.setItem(`fit.clientLiveDensity.${id}`,'compact')},{id:pilotId,theme})
  const source=restTimerWorkout(0,true);source.startedAt='2026-10-21T08:58:00Z'
  const exercise=source.exercises[0]!
  exercise.inputKind=kind;exercise.ref=kind==='distance'?'walking':'plank';exercise.name=kind==='distance'?'Ходьба':'Планка'
  exercise.sets=exercise.sets.map(set=>({...set,durationSec:30,...(kind==='distance'?{distanceKm:1}:{}),fact:{},confirmedAt:null}))
  const target=exercise.sets[0]!,writes:string[]=[]
  page.on('request',request=>{if(request.url().includes('workout-sets')&&request.method()!=='GET')writes.push(request.method())})
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  const swipe=async()=>{const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end();await row.getByRole('button',{name:/Удалить подход 1:/}).click()}
  await swipe();await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click()
  expect(writes).toEqual([]);expect(backend.getWorkouts()[0]!.exercises[0]!.sets.map(set=>set.fact)).toEqual([{},{}])
  await swipe();await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(row).toHaveCount(0);expect(writes).toEqual(['DELETE'])
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact).toEqual({})
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeNull()
})

for (const theme of ['light', 'dark']) test(`client priority controls retain standard geometry and resume behavior ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const active = coachGestureWorkout()
  active.startedAt = new Date(Date.now() - 90000).toISOString()
  const planned = { ...structuredClone(active), id: newWorkoutId, status: 'planned', startedAt: null, createdBy: pilotId,
    stageId: '10000000-0000-4000-8000-000000000041' }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [active, planned] })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/workouts/${workoutId}`)
    const resume = page.getByRole('link', { name: 'Продолжить тренировку', exact: true })
    await expect(resume).toBeVisible()
    await page.evaluate(async () => { await document.fonts.ready })
    const geometry = await resume.evaluate(button => {
      const rect = button.getBoundingClientRect(), page = button.closest('main')!, parent = page.getBoundingClientRect(), styles = getComputedStyle(page)
      return { height: rect.height, width: rect.width, available: parent.width - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) }
    })
    await page.screenshot({ path: info.outputPath(`resume-${width}.png`) })
    expect.soft(geometry.height).toBeGreaterThanOrEqual(48)
    expect.soft(Math.abs(geometry.width - geometry.available)).toBeLessThan(1)
    await resume.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
    expect(backend.getWorkouts()[0]!.startedAt).toBe(active.startedAt)
    expect(backend.getWorkouts()[0]!.status).toBe('in_progress')
    await page.goto(`/workouts/${newWorkoutId}/edit`)
    const stage = page.locator('select[name="stageId"]')
    await expect(stage).toHaveValue(planned.stageId)
    await expect(stage).toHaveCSS('border-radius', '16px')
    await expect(stage).toHaveCSS('appearance', 'none')
    const stageBox = await stage.boundingBox()
    expect.soft(stageBox!.height).toBeGreaterThanOrEqual(48)
    expect.soft(stageBox!.height).toBeLessThanOrEqual(49)
    await stage.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`stage-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const theme of ['light', 'dark']) test(`client goal stage clear persists through save failure and reload ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const stageA = '10000000-0000-4000-8000-000000000041', stageB = '10000000-0000-4000-8000-000000000042'
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: stageA as string | null }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  await page.route(`**/v1/clients/${clientId}/progress`, route => route.fulfill({ json: { entries: [], customMetrics: [], goal: {
    id: '10000000-0000-4000-8000-000000000040', clientId, title: 'Цель', targetDate: '2026-12-31', status: 'active', version: 1, criteria: [],
    stages: [{ id: stageA, goalId: '10000000-0000-4000-8000-000000000040', title: 'База', startsOn: '2026-09-01', endsOn: '2026-11-01', position: 0, version: 1 },
      { id: stageB, goalId: '10000000-0000-4000-8000-000000000040', title: 'Развитие', startsOn: '2026-11-02', endsOn: '2026-12-31', position: 1, version: 1 }],
  } } }))
  const writes: Array<string | null> = []
  let failSave = true
  await page.route(`**/v1/workouts/${workoutId}`, route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    const draft = route.request().postDataJSON() as { stageId: string | null }
    writes.push(draft.stageId)
    if (failSave) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    const stored = backend.getWorkouts()[0]! as typeof source
    stored.stageId = draft.stageId; stored.version += 1
    return route.fulfill({ json: { workout: { id: workoutId } } })
  })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/workouts/${workoutId}/edit`)
    const stage = page.locator('select[name="stageId"]'), save = page.getByRole('button', { name: 'Сохранить план', exact: true })
    await expect(stage).toHaveValue(width === 390 ? stageA : stageB)
    await stage.selectOption('')
    await expect(stage).toHaveValue('')
    failSave = true; await save.click()
    await expect(page.locator('.request-error-inline')).toContainText('Введённые данные остались в форме')
    await expect(stage).toHaveValue('')
    expect(writes.at(-1)).toBeNull()
    await stage.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: info.outputPath(`stage-clear-failure-${width}.png`) })
    failSave = false; await save.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    expect((backend.getWorkouts()[0]! as typeof source).stageId).toBeNull()
    await page.goto(`/workouts/${workoutId}/edit`); await page.reload()
    await expect(stage).toHaveValue('')
    await stage.selectOption(stageB); await save.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await page.goto(`/workouts/${workoutId}/edit`); await page.reload()
    await expect(stage).toHaveValue(stageB)
  }
})

for (const theme of ['light', 'dark']) test(`client goal stage intentional empty survives draft restore ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: '10000000-0000-4000-8000-000000000041' }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  await page.goto(`/workouts/new?copy=${workoutId}`)
  const stage = page.locator('select[name="stageId"]')
  await expect(stage).toHaveValue(source.stageId)
  await stage.selectOption(''); await expect(stage).toHaveValue('')
  const savedStage = () => page.evaluate(({ id, sourceId }) => {
    const draft: unknown = JSON.parse(localStorage.getItem(`fit.workout-form-draft.${id}.${sourceId}`) ?? '{}')
    return draft && typeof draft === 'object' && 'stageId' in draft ? draft.stageId : undefined
  }, { id: pilotId, sourceId: workoutId })
  await expect.poll(savedStage).toBe('')
  await page.reload(); await expect(stage).toHaveValue('')
  await stage.selectOption(source.stageId); await expect.poll(savedStage).toBe(source.stageId)
  await page.reload(); await expect(stage).toHaveValue(source.stageId)
})

for (const theme of ['light', 'dark']) test(`client goal stage awaits initial goal before writing a fresh draft ${theme}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/v1/clients/${clientId}/progress`, async route => { await gate; return route.fallback() })
  await page.goto('/workouts/new')
  const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await expect(save).toBeDisabled()
  const savedStage = () => page.evaluate(id => {
    const draft: unknown = JSON.parse(localStorage.getItem(`fit.workout-form-draft.${id}.new--`) ?? '{}')
    return draft && typeof draft === 'object' && 'stageId' in draft ? draft.stageId : undefined
  }, pilotId)
  expect(await savedStage()).toBeUndefined()
  release()
  const stage = page.locator('select[name="stageId"]')
  await expect(stage).toHaveValue('10000000-0000-4000-8000-000000000041')
  await expect(stage).toBeEnabled()
  await expect.poll(savedStage).toBe('10000000-0000-4000-8000-000000000041')
  await stage.selectOption(''); await expect(stage).toHaveValue('')
  await expect.poll(savedStage).toBe('')
  await page.reload(); await expect(stage).toHaveValue('')
})

for (const theme of ['light', 'dark']) test(`client goal delay never clears existing time and plan fields ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: '10000000-0000-4000-8000-000000000041', notes: 'План сохранить', prepSeconds: 15 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/v1/clients/${clientId}/progress`, async route => { await gate; return route.fallback() })
  const writes: Array<{ startTime: string; endTime: string; stageId: string; notes: string; prepSeconds: number; exercises: unknown[] }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    writes.push(route.request().postDataJSON() as typeof writes[number])
    return route.fulfill({ status: 503, json: { error: 'unavailable' } })
  })
  await page.goto(`/workouts/${workoutId}/edit`)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ startTime: '10:00', endTime: '11:00', notes: 'План сохранить', prepSeconds: 15, stageId: source.stageId })
  expect(writes[0]!.exercises).toHaveLength(source.exercises.length)
  release()
  await expect(page.locator('select[name="stageId"]')).toHaveValue(source.stageId)
})
