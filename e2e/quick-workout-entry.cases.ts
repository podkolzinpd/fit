import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

export function quickWorkoutEntryCases() {
  test.skip(process.env.FIT_QUICK_WORKOUT_ENTRY_ACCEPTANCE !== '1', 'Dedicated native quick-entry harness')
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
    await viewport.evaluate(el => { el.scrollTop = el.querySelector<HTMLElement>('.day-grid')!.offsetHeight / 24 * 13 })
    await page.waitForTimeout(250)
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
    })
  }
}
