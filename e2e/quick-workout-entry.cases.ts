import type { WorkoutDraft } from '../src/shared/domain'
import { expect, test, type Locator } from '@playwright/test'
import { clientId, mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

/** Prepare a deliberate tap only after real scroll delivery and the existing quiet period. */
async function scrollDayForBooking(viewport: Locator) {
  await viewport.evaluate(async element => {
    await document.fonts.ready
    await new Promise<void>(resolve => {
      const top = element.querySelector<HTMLElement>('.day-grid')!.offsetHeight / 24 * 13
      let observed = Math.abs(element.scrollTop - top) < 1
      let previous = element.scrollTop
      let changedAt = performance.now()
      const scroll = () => { observed = true; previous = element.scrollTop; changedAt = performance.now() }
      element.addEventListener('scroll', scroll)
      element.scrollTop = top
      const frame = () => {
        if (element.scrollTop !== previous) { observed = false; previous = element.scrollTop; changedAt = performance.now() }
        if (observed && performance.now() - changedAt >= 200) {
          element.removeEventListener('scroll', scroll)
          resolve()
        } else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  })
}

export function quickWorkoutEntryCases() {
  test.skip(process.env.FIT_QUICK_WORKOUT_ENTRY_ACCEPTANCE !== '1', 'Dedicated native quick-entry harness')
  for (const role of ['trainer', 'client'] as const) test(`quick-entry explicit running format keeps its existing path ${role}`, async ({ page }) => {
    const profileId = `c0ac0000-6010-4000-8000-00000000000${role === 'trainer' ? 1 : 2}`
    const backend = await mockPilot(page, { role, profileId, fitLime: true, clientLime: true, workouts: [{ ...restTimerWorkout(), createdBy: profileId, exercises: [] }] })
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
    await picker.locator('.picker-filter-trigger').click()
    await picker.getByRole('group', { name: 'Тип упражнения', exact: true }).getByRole('button', { name: 'Бег', exact: true }).click()
    await picker.getByRole('button', { name: /^(Применить фильтры|Показать упражнения)$/ }).first().click()
    await picker.locator('.running-format-option[data-running-format="easy"]').click()
    await expect(picker).toHaveCount(0)
    await expect.poll(() => backend.getAppendCommands().length).toBe(1)
    const command = backend.getAppendCommands()[0] as { exercise: { prefillFromHistory?: boolean } }
    expect(command.exercise.prefillFromHistory).toBeUndefined()
  })
  for (const hasPlan of [false, true]) test(`quick-entry booking history preserves appointment and requires replacement ${hasPlan}`, async ({ page }, info) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const base = restTimerWorkout()
    const target = { ...base, createdBy: profileId, status: 'planned' as const, workoutDate: '2026-11-02', startTime: '14:00', endTime: '15:00', startedAt: null, exercises: hasPlan ? base.exercises : [] }
    const source = { ...base, id: '67500000-0000-4000-8000-000000000030', title: 'История суперсет', status: 'done' as const, workoutDate: '2026-10-02', completedAt: '2026-10-02T10:00:00Z', exercises: [0, 1].map(position => ({ ...base.exercises[0]!, id: `67500000-0000-4000-8000-00000000004${position}`, position, blockType: 'group' as const, blockRounds: 2, trainerComment: 'Держать корпус', sets: base.exercises[0]!.sets.map(set => ({ ...set, fact: { weightKg: 35, reps: 8 }, confirmedAt: '2026-10-02T10:00:00Z' })) })) }
    const original = JSON.stringify(source)
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [target, source, { ...source, id: '67500000-0000-4000-8000-000000000050', clientId: '67500000-0000-4000-8000-000000000051', title: 'Другой клиент' }] })
    const commands: WorkoutDraft[] = []
    await page.route(`**/v1/workouts/${workoutId}`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback()
      const draft = route.request().postDataJSON() as WorkoutDraft & { expectedVersion: number }
      commands.push(draft)
      const actual = backend.getWorkouts().find(item => item.id === workoutId)!
      expect(draft.expectedVersion).toBe(actual.version)
      Object.assign(actual, { workoutDate: draft.workoutDate, startTime: draft.startTime, endTime: draft.endTime, version: actual.version + 1,
        exercises: draft.exercises.map((exercise, position) => ({ ...exercise, id: `67500000-0000-4000-8000-00000000006${position}`, sets: exercise.sets.map((set, index) => ({ ...set, id: `67500000-0000-4000-8000-0000000000${7 + position}${index}`, fact: {}, confirmedAt: null, version: 1 })) })) })
      await route.fulfill({ status: 200, json: { workout: { id: workoutId } } })
    })
    await page.goto(`/workouts/${workoutId}`)
    const historyAction = page.locator('.booking-history-open')
    await expect(historyAction).toBeVisible()
    expect(await historyAction.locator('svg').first().evaluate(icon => ({ width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height }))).toEqual({ width: 24, height: 24 })
    expect((await historyAction.boundingBox())!.height).toBe(54)
    const startAction = page.locator('.workout-detail-primary-actions').getByRole('button').first()
    await expect(startAction).toBeEnabled()
    const startBox = (await startAction.boundingBox())!
    expect((await historyAction.boundingBox())!.y).toBeGreaterThanOrEqual(startBox.y + startBox.height)
    await expect(page.getByRole('link', { name: hasPlan ? 'Изменить план' : 'Добавить упражнения', exact: true })).toHaveAttribute('href', `/workouts/${workoutId}/edit`)
    await expect(page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true })).toBeVisible()
    if (!hasPlan) {
      await expect(page.getByText('Упражнения ещё не добавлены', { exact: true })).toBeVisible()
      await expect(page.locator('.workout-detail-exercise-overview')).not.toContainText('0 упражнений')
    }
    await historyAction.click()
    const sheet = page.getByRole('dialog', { name: 'История тренировок клиента' })
    await sheet.getByRole('button', { name: 'Закрыть историю', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(commands).toHaveLength(0)
    await historyAction.click()
    await expect(sheet.getByText('Другой клиент')).toHaveCount(0)
    await sheet.getByRole('button', { name: /История суперсет/ }).click()
    await expect(sheet).toContainText('Держать корпус')
    const footer = sheet.locator('footer')
    const availableFooterWidth = await footer.evaluate(element => element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft) - parseFloat(getComputedStyle(element).paddingRight))
    expect((await sheet.getByRole('button', { name: 'Использовать план', exact: true }).boundingBox())!.width).toBeCloseTo(availableFooterWidth, 0)
    await sheet.screenshot({ path: info.outputPath(`booking-history-${hasPlan}.png`) })
    await sheet.getByRole('button', { name: 'Использовать план', exact: true }).click()
    if (hasPlan) {
      expect(commands).toHaveLength(0)
      await expect(sheet.getByRole('alert')).toContainText('уже есть план')
      await sheet.getByRole('button', { name: 'Отмена', exact: true }).click()
      await expect(sheet.getByRole('alert')).toHaveCount(0)
      expect(commands).toHaveLength(0)
      await sheet.getByRole('button', { name: 'Использовать план', exact: true }).click()
      await sheet.getByRole('button', { name: 'Заменить план', exact: true }).click()
    }
    await expect(sheet).toHaveCount(0)
    expect(commands).toHaveLength(1)
    await expect(page.getByRole('link', { name: 'Изменить план', exact: true })).toBeVisible()
    await expect(page.locator('.booking-plan-empty')).toHaveCount(0)
    const actual = backend.getWorkouts().find(item => item.id === workoutId)!
    expect([actual.clientId, actual.workoutDate, actual.startTime, actual.endTime, actual.status]).toEqual([target.clientId, '2026-11-02', '14:00', '15:00', 'planned'])
    expect(actual.exercises).toHaveLength(2)
    expect(actual.exercises.every(item => item.blockType === 'group' && item.blockRounds === 2 && item.sets.every(set => set.weightKg === 35 && set.reps === 8 && !set.confirmedAt))).toBe(true)
    expect(actual.exercises[0]!.blockId).toBe(actual.exercises[1]!.blockId)
    expect(JSON.stringify(backend.getWorkouts().find(item => item.id === source.id))).toBe(original)
    expect(backend.getWorkouts()).toHaveLength(3)
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await startAction.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
  })
  test('quick-entry day retains navigation and rejects moved or cancelled gestures', async ({ page }) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto('/today?date=2026-10-08')
    const grid = page.locator('.schedule-v2-timeline .day-grid')
    await expect(grid).toBeVisible()
    await page.waitForTimeout(250)
    await grid.evaluate(el => {
      const r = el.parentElement!.getBoundingClientRect(), x = r.left + 160, y = r.top + 50
      const target = document.elementFromPoint(x, y)!
      const emit = (type: string, dx = 0) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 12, button: 0, clientX: x + dx, clientY: y }))
      emit('pointerdown'); emit('pointermove', 20); emit('pointermove'); emit('pointerup')
      emit('pointerdown'); emit('pointercancel'); emit('pointerup')
    })
    await expect(page.getByRole('dialog', { name: 'Записать клиента' })).toHaveCount(0)
    const box = (await page.locator('.schedule-v2-timeline').boundingBox())!
    await page.mouse.move(box.x + 200, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x + 70, box.y + 50, { steps: 8 }); await page.mouse.up()
    await expect(page).toHaveURL(/date=2026-10-09/)
    await expect(page.getByRole('dialog', { name: 'Записать клиента' })).toHaveCount(0)
  })
  test('quick-entry restored booking requires a client still in the active list', async ({ page }, info) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const activeId = '10000000-0000-4000-8000-000000000088'
    const requestId = '67500000-0000-4000-8000-000000009001'
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [], clientRecords: [{ id: activeId, fullName: 'Борис Тестовый', archivedAt: null, version: 1 }] })
    await page.addInitScript(({ profileId, clientId, requestId }) => {
      localStorage.setItem(`fit.workout-form-draft.${profileId}.booking--2026-10-08--14:00`, JSON.stringify({ clientId, requestId, workoutDate: '2026-10-08', startTime: '14:00', endTime: '15:00', notes: '', stageId: '', recordCompleted: false, exercises: [] }))
    }, { profileId, clientId, requestId })
    const commands: Array<{ clientId: string; requestId: string }> = []
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/v1/workouts' && request.method() === 'POST') commands.push(request.postDataJSON() as typeof commands[number])
    })
    await page.goto('/today?date=2026-10-08')
    const viewport = page.locator('.schedule-v2-timeline'), grid = viewport.locator('.day-grid')
    await expect(grid).toBeVisible()
    await scrollDayForBooking(viewport)
    const point = await grid.evaluate(el => { const box = el.getBoundingClientRect(); return { x: box.left + 140, y: box.top + el.clientHeight / 24 * 14 + 2 } })
    await page.touchscreen.tap(point.x, point.y)
    const booking = page.getByRole('dialog', { name: 'Записать клиента', exact: true })
    await expect(booking.getByRole('button', { name: 'Выбрать клиента', exact: true })).toBeVisible()
    await expect(booking).toContainText('14:00–15:00')
    await booking.screenshot({ path: info.outputPath('restored-booking-range.png') })
    await booking.getByRole('button', { name: 'Записать', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента', exact: true })
    await expect(picker).toBeVisible()
    expect(commands).toHaveLength(0)
    await picker.locator(`[data-client-id="${activeId}"]`).click()
    await picker.getByRole('button', { name: 'Применить клиента' }).click()
    await booking.getByRole('button', { name: 'Записать', exact: true }).click()
    await expect(booking).toHaveCount(0)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ clientId: activeId, requestId, endTime: '15:00' })
    expect(backend.getWorkouts()).toHaveLength(1)
    expect(backend.getWorkouts()[0]!.clientId).toBe(activeId)
  })
  for (const density of ['comfortable', 'compact'] as const) test(`quick-entry day booking ${density}: completed tap, scroll priority and retry`, async ({ page }, info) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [], scheduleDensity: density, failFirstSave: true })
    const commands: Array<{ requestId: string; exercises: unknown[]; startTime: string }> = []
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/v1/workouts' && request.method() === 'POST') commands.push(request.postDataJSON() as typeof commands[number])
    })
    await page.goto('/today?date=2026-10-08')
    const viewport = page.locator('.schedule-v2-timeline'), grid = viewport.locator('.day-grid')
    await expect(grid).toBeVisible()
    await scrollDayForBooking(viewport)
    const position = await grid.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + 140, y: r.top + el.clientHeight / 24 * 14 + 2 } })
    const booking = page.getByRole('dialog', { name: 'Записать клиента', exact: true })
    // A scroll event invalidates contact, including a contact stopping inertia.
    await viewport.evaluate(el => { el.scrollTop += 1 })
    await page.touchscreen.tap(position.x, position.y)
    await expect(booking).toHaveCount(0)
    await page.waitForTimeout(250)
    const before = await viewport.evaluate(el => el.scrollTop)
    await page.touchscreen.tap(position.x, position.y)
    await expect(booking).toBeVisible()
    await expect(booking).toContainText('14:00')
    await expect(booking.locator('input:focus')).toHaveCount(0)
    await booking.getByRole('button', { name: 'Закрыть запись' }).click()
    await expect(booking).toHaveCount(0)
    expect(await viewport.evaluate(el => el.scrollTop)).toBe(before)
    await page.touchscreen.tap(position.x, position.y)
    await booking.getByRole('button', { name: 'Выбрать клиента', exact: true }).click()
    await page.locator('.client-picker-item').first().click()
    await page.getByRole('button', { name: 'Применить клиента' }).click()
    await booking.screenshot({ path: info.outputPath(`booking-${density}.png`) })
    await booking.getByRole('button', { name: 'Записать', exact: true }).click()
    await expect(booking.getByRole('alert')).toBeVisible()
    await booking.getByRole('button', { name: 'Записать', exact: true }).click()
    await expect(booking).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[0]!.requestId).toBeTruthy()
    expect(commands[1]!.requestId).toBe(commands[0]!.requestId)
    expect(commands[1]!.exercises).toEqual([])
    const created = backend.getWorkouts()[0]!
    expect(created.status).toBe('planned')
    expect(created.startTime).toBe('14:00')
    expect(created.workoutDate).toBe('2026-10-08')
    await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  })
  test('quick-entry catalogue ranks dumbbells ahead of a less relevant recent lunge', async ({ page }) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
    await mockPilot(page, { role: 'trainer', profileId, fitLime: true, workouts: [{ ...restTimerWorkout(), createdBy: profileId, exercises: [] }] })
    await page.addInitScript(() => localStorage.setItem('fit.recent-exercises', JSON.stringify(['vital-bulgarian-split-squat-ex242'])))
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
    await picker.getByLabel('Поиск упражнения').fill('Выпады с га')
    await expect(picker.locator('.picker-item-copy').first()).toContainText(/гантел/)
    await expect(picker.locator('.picker-item-copy').first()).not.toContainText(/собственн/)
  })
  for (const role of ['trainer', 'client'] as const) test(`quick-entry ${role} catalogue leaves results visible above the keyboard`, async ({ page }, info) => {
    const profileId = `c0ac0000-6010-4000-8000-00000000000${role === 'trainer' ? 1 : 2}`
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
    await mockPilot(page, { role, profileId, fitLime: true, clientLime: true, workouts: [{ ...restTimerWorkout(), createdBy: profileId, exercises: [] }] })
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
    await expect(picker).toHaveClass(/quick-entry-catalog/)
    const search = picker.getByLabel('Поиск упражнения')
    await search.fill('планка')
    await search.focus()
    // A visual-viewport simulation checks layout, not a physical iOS keyboard.
    await page.evaluate(() => {
      const viewport = window.visualViewport!
      Object.defineProperty(viewport, 'height', { configurable: true, value: 400 })
      viewport.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('.quick-entry-picker-overlay')).toHaveClass(/keyboard-open/)
    await expect(search).toHaveCSS('outline-style', 'none')
    const list = picker.locator('.picker-list')
    await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThan(120)
    const first = picker.locator('.picker-item').first()
    const listBox = (await list.boundingBox())!, rowBox = (await first.boundingBox())!
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height)
    if (role === 'trainer') await expect(picker.locator('.coach-catalog-create-bar')).toHaveCSS('position', 'absolute')
    await picker.screenshot({ path: info.outputPath(`${role}-catalogue-keyboard.png`) })
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    const last = picker.locator('.picker-item').last()
    await expect(last).toBeInViewport({ ratio: 1 })
    await list.evaluate(el => { el.scrollTop = 0 })
    if (role === 'client') {
      await picker.getByRole('button', { name: 'Выбрать: Планка', exact: true }).click()
      await expect(picker).toHaveClass(/has-selection/)
      await expect(picker.getByRole('button', { name: /^Добавить (?:1|\(1\))$/ })).toBeInViewport({ ratio: 1 })
    }
    await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')) })
    await expect(page.locator('.quick-entry-picker-overlay')).not.toHaveClass(/keyboard-open/)
    await expect(search).toHaveValue('планка')
    await picker.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(picker).toHaveCount(0)
  })

  for (const role of ['trainer', 'client'] as const) {
    test(`quick-entry pilot ${role} adds an exercise with atomic planned values`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
      const profileId = `c0ac0000-6010-4000-8000-00000000000${role === 'trainer' ? 1 : 2}`
      const current = { ...restTimerWorkout(), createdBy: profileId, trainerId: role === 'trainer' ? profileId : restTimerWorkout().trainerId, exercises: [] }
      const backend = await mockPilot(page, { role, profileId, fitLime: true, clientLime: true, workouts: [current] })
      await page.route('**/v1/workouts/*/exercises', async route => {
        const command = route.request().postDataJSON() as { exercise: { source: 'system'; ref: string; name: string; muscleGroup: 'core'; inputKind: 'duration'; prefillFromHistory?: boolean }; expectedVersion: number }
        expect(command.exercise.prefillFromHistory).toBe(true)
        const target = backend.getWorkouts()[0]!
        const id = '67500000-0000-4000-8000-000000000001'
        target.exercises.push({ ...command.exercise, id, position: 0, blockId: id, blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
          sets: [0, 1].map(position => ({ id: `67500000-0000-4000-8000-00000000001${position}`, position, durationSec: 45 + position * 15, fact: {}, confirmedAt: null, version: 1 })) })
        target.version++
        await route.fulfill({ status: 201, json: { exercise: { id, version: target.version, replayed: false } } })
      })
      await page.goto(`/workouts/${workoutId}/live`)
      await page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).click()
      const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
      await picker.getByLabel('Поиск упражнения').fill('планка')
      await picker.getByRole('button', { name: role === 'trainer' ? 'Добавить: Планка' : 'Выбрать: Планка', exact: true }).click()
      if (role === 'client') await picker.getByRole('button', { name: /^Добавить (?:1|\(1\))$/ }).click()
      await expect(picker).toHaveCount(0)
      await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(1)
      const added = backend.getWorkouts()[0]!.exercises[0]!
      expect(added.sets.map(set => set.durationSec)).toEqual([45, 60])
      expect(added.sets.every(set => set.confirmedAt === null && Object.keys(set.fact).length === 0)).toBe(true)
      await expect(page.getByText('Планка', { exact: true }).first()).toBeVisible()
      await expect(page.locator('input[name="durationSec"]').first()).toHaveValue('45')
      await expect(page.locator('input[name="durationSec"]').nth(1)).toHaveValue('60')
    })
  }
}
