import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

export function planEditorStabilityCases() {
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
