import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

export function planEditorStabilityCases() {
  test('one sticky plan header saves from the bottom and preserves input on failure', async ({ page }, info) => {
    const actor = 'c0ac0000-6010-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-11-08T09:00:00Z'))
    const source = coachGestureWorkout(false, 6)
    source.status = 'planned'; source.startedAt = null; source.createdBy = actor; source.workoutDate = '2026-11-08'
    const backend = await mockPilot(page, { role: 'trainer', profileId: actor, fitLime: true, workouts: [source] })
    let release: (() => void) | undefined
    let attempts = 0
    const writes: Array<{ exercises: Array<{ sets: Array<{ weightKg: number }> }> }> = []
    await page.route(`**/v1/workouts/${workoutId}`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback()
      attempts += 1
      const draft = route.request().postDataJSON() as typeof writes[number]
      writes.push(draft)
      if (attempts === 1) {
        await new Promise<void>(resolve => { release = resolve })
        return route.fulfill({ status: 503, json: { error: 'unavailable' } })
      }
      backend.getWorkouts()[0]!.exercises.at(-1)!.sets[0]!.weightKg = draft.exercises.at(-1)!.sets[0]!.weightKg
      backend.getWorkouts()[0]!.version += 1
      await route.fulfill({ json: { workout: { id: workoutId } } })
    })
    await page.goto('/today?date=2026-11-08')
    const timeline = page.locator('.schedule-v2-timeline')
    await expect(timeline).toBeVisible()
    const calendarTop = await timeline.evaluate(node => node.getBoundingClientRect().top)
    await page.locator(`a[href="/workouts/${workoutId}"]`).first().click()
    await page.locator(`a[href="/workouts/${workoutId}/edit"]`).click()
    const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
    const header = page.locator('.coach-reference-form > .page-header')
    await expect(save).toBeVisible()
    const initial = await save.boundingBox()
    const last = page.locator('.planned-exercise').last().getByLabel('Вес, подход 1', { exact: true })
    await last.fill('37.5')
    await page.locator('.content').evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect(header).toHaveCSS('position', 'sticky')
    const bottom = await save.boundingBox()
    expect(Math.abs(bottom!.y - initial!.y)).toBeLessThanOrEqual(1)
    expect(await save.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
    await expect(page.locator('.workout-action-row')).toHaveCount(0)
    const viewport = page.viewportSize()!
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: viewport.height })
      await page.locator('.content').evaluate(node => { node.scrollTop = node.scrollHeight })
      const geometry = await save.evaluate(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, inside: r.left >= 0 && r.right <= innerWidth, hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) } })
      expect(geometry).toEqual({ width: 44, height: 44, inside: true, hit: true })
    }
    await page.setViewportSize(viewport)
    await page.locator('.content').evaluate(node => { node.scrollTop = node.scrollHeight })
    await page.screenshot({ path: info.outputPath('plan-sticky-header-at-bottom.png') })
    const setFields = page.locator('.planned-exercise').last().locator('.planned-set-input')
    const fieldGeometry = () => setFields.evaluateAll(fields => fields.map(field => { const r = field.getBoundingClientRect(); return { x: r.x, width: r.width } }))
    const beforeSave = await fieldGeometry()
    await save.tap()
    await expect(save).toHaveAttribute('aria-busy', 'true')
    await expect(save.locator('.coach-plan-save-progress')).toBeVisible()
    await expect(save).toBeDisabled()
    expect(await fieldGeometry()).toEqual(beforeSave)
    await page.screenshot({ path: info.outputPath('plan-sticky-save-pending.png') })
    await page.touchscreen.tap(bottom!.x + bottom!.width / 2, bottom!.y + bottom!.height / 2)
    expect(attempts).toBe(1)
    await expect.poll(() => Boolean(release)).toBe(true)
    release!()
    await expect(header.getByRole('alert')).toBeVisible()
    await expect(last).toHaveValue('37.5')
    await expect(save).toBeEnabled()
    await page.screenshot({ path: info.outputPath('plan-sticky-save-error.png') })
    await save.tap()
    await expect(page).toHaveURL(/\/today\?date=2026-11-08$/)
    await expect(page.locator('.fit-lime-plan-saved')).toBeVisible()
    await expect(page.locator('.fit-lime-plan-saved')).toHaveCSS('position', 'fixed')
    expect(await timeline.evaluate(node => node.getBoundingClientRect().top)).toBe(calendarTop)
    expect(writes).toHaveLength(2)
    expect(writes[1]!.exercises.at(-1)!.sets[0]!.weightKg).toBe(37.5)
    await page.screenshot({ path: info.outputPath('calendar-save-receipt-no-layout-shift.png') })
    await page.locator(`a[href="/workouts/${workoutId}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await expect(page.locator('.workout-detail-page')).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/today\?date=2026-11-08$/)
    await expect(timeline).toBeVisible()
    await expect(page.locator('.fit-lime-plan-saved')).toHaveCount(0)
  })

  test('exercise notes remain readable through plan copy and athlete history and Live', async ({ page }, info) => {
    const actor = 'c0ac0000-6010-4000-8000-000000000001'
    const athlete = 'c11e0000-6010-4000-8000-000000000001'
    await page.addInitScript(id => localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10'])), athlete)
    await page.clock.setFixedTime(new Date('2026-11-08T09:00:00Z'))
    const note = ['Темп контролируем.', 'Пауза в нижней точке — две секунды.', 'Сохраняйте положение корпуса и дышите равномерно.', 'Следующий подход выполняем с тем же весом.'].join('\n')
    const source = coachGestureWorkout(false, 1)
    source.status = 'planned'; source.startedAt = null; source.createdBy = actor; source.workoutDate = '2026-11-08'
    source.exercises[0]!.trainerComment = note
    source.exercises[0]!.clientNote = 'Личная заметка спортсмена'
    const backend = await mockPilot(page, { role: 'trainer', profileId: actor, fitLime: true, workouts: [source] })
    const writes: string[] = []
    await page.route(`**/v1/workouts/${workoutId}`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback()
      const draft = route.request().postDataJSON() as { exercises: Array<{ trainerComment: string }> }
      writes.push(draft.exercises[0]!.trainerComment)
      backend.getWorkouts()[0]!.exercises[0]!.trainerComment = draft.exercises[0]!.trainerComment
      backend.getWorkouts()[0]!.version += 1
      await route.fulfill({ json: { workout: { id: workoutId } } })
    })
    await page.goto(`/workouts/${workoutId}/edit`)
    const field = page.getByLabel('Комментарий к упражнению', { exact: true })
    await expect(field).toHaveValue(note)
    const readable = async () => expect.poll(() => field.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
    await readable()
    const loaded = await field.evaluate(node => node.getBoundingClientRect().height)
    await field.fill('Коротко')
    await expect.poll(() => field.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(loaded)
    await field.fill(note + '\nДобавленная строка.')
    await readable()
    await page.screenshot({ path: info.outputPath('plan-full-exercise-note.png') })
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0]).toBe(note + '\nДобавленная строка.')
    await page.goto(`/workouts/new?copy=${workoutId}`)
    await page.locator('.planned-exercise').first().locator('.compact-editor-exercise-toggle').click()
    await expect(field).toHaveValue(writes[0]!)
    await readable()
    const saved = structuredClone(backend.getWorkouts()[0]!)
    saved.status = 'done'; saved.completedAt = '2026-11-08T09:00:00Z'
    await mockPilot(page, { role: 'client', profileId: athlete, fitLime: true, clientLime: true, workouts: [saved] })
    await page.goto(`/workouts/${workoutId}`)
    const historyNote = page.locator('.exercise-comment-note').first()
    await expect(historyNote).toHaveCSS('white-space', 'pre-wrap')
    expect(await historyNote.textContent()).toBe(writes[0])
    const live = coachGestureWorkout(false, 1)
    live.createdBy = actor; live.startedAt = '2026-11-08T08:59:00Z'
    live.exercises[0]!.trainerComment = writes[0]!
    live.exercises[0]!.clientNote = source.exercises[0]!.clientNote
    await mockPilot(page, { role: 'client', profileId: athlete, fitLime: true, clientLime: true, workouts: [live] })
    await page.goto(`/workouts/${workoutId}/live`)
    // The generic browser lane retains Mono; the dedicated Lime lane enables
    // its existing read-only fold. Verify each lane's actual contract.
    if (process.env.VITE_CLIENT_LIME_ENABLED === 'true') {
      await page.locator('.live-trainer-note summary').click()
      await expect(page.locator('.live-trainer-note p')).toHaveText(writes[0]!)
    } else {
      await expect(page.locator('.live-trainer-cue')).toHaveText(`Тренер: ${writes[0]!}`)
    }
    await page.locator('.live-exercise-note summary').click()
    await expect(page.locator('.live-exercise-note textarea')).toHaveValue('Личная заметка спортсмена')
    expect(writes).toHaveLength(1)
    await page.screenshot({ path: info.outputPath('athlete-separate-full-notes.png') })
  })

  test('plan keyboard closing follows intermediate geometry without counter-scrolling', async ({ page }, info) => {
    const actor = 'c0ac0000-6010-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-11-08T09:00:00Z'))
    await page.addInitScript(id => localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'), actor)
    const source = coachGestureWorkout(false, 5)
    source.status = 'planned'; source.startedAt = null; source.createdBy = actor; source.workoutDate = '2026-11-08'
    await mockPilot(page, { role: 'trainer', profileId: actor, fitLime: true, workouts: [source] })
    await page.goto(`/workouts/${workoutId}/edit`)
    const card = page.locator('.planned-exercise').nth(1)
    const weight = card.getByLabel('Вес, подход 1', { exact: true })
    await weight.tap()
    await weight.fill('27.5')
    await weight.press('Enter')
    await expect(card.getByLabel('Повторы, подход 1', { exact: true })).toBeFocused()
    const content = page.locator('.content')
    // Explicit visualViewport phases model geometry, not a physical keyboard.
    const phase = async (height: number, offsetTop: number) => {
      await page.evaluate(async ({ height, offsetTop }) => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: height })
        Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: offsetTop })
        window.visualViewport!.dispatchEvent(new Event('resize'))
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
      }, { height, offsetTop })
    }
    const fullHeight = await page.evaluate(() => innerHeight)
    await phase(400, 70)
    await expect(card.getByLabel('Повторы, подход 1', { exact: true })).toBeInViewport()
    await card.getByLabel('Целевой RPE, подход 1', { exact: true }).selectOption('7.5')
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    const before = await content.evaluate(node => node.scrollTop)
    for (const [height, offset] of [[fullHeight - 145, 65], [fullHeight - 65, 20], [fullHeight - 4, 0], [fullHeight, 8]]) {
      await phase(height!, offset!)
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-visible-height'))).toBe(`${height}px`)
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-offset-top'))).toBe(`${offset}px`)
      expect(Math.abs(await content.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    }
    await phase(fullHeight, 0)
    await expect(weight).toHaveValue('27.5')
    await expect(card.getByLabel('Целевой RPE, подход 1', { exact: true })).toHaveValue('7.5')
    expect(Math.abs(await content.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('plan-after-keyboard-close.png') })
  })
}
