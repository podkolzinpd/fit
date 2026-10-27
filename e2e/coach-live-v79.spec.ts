// Gate-on coverage is isolated from the existing trainer/client suites.
// The existing workflow lane runs this on the actual production build in both engines.
import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'
import { coachGestureWorkout, beginClientGesture } from './fit-lime-fixtures'

// State fixtures isolate visual layout from the merge/split behavior scenario.
// Both densities are needed for the approved 54/48px fields and header geometry.
for (const density of ['original', 'compact'] as const) {
  for (const state of ['initial', 'middle', 'complete'] as const) {
    test(`v79 superset presentation ${density} ${state}`, async ({ page }, info) => {
      const profileId = 'c0ac0000-6010-4000-8000-000000000001'
      const source = coachGestureWorkout(true)
      source.exercises[0]!.ref = 'barbell-squat'
      for (const exercise of source.exercises.slice(0, 2)) {
        exercise.blockRounds = 3
        exercise.trainerComment = 'Контролировать темп'
        exercise.sets = Array.from({ length: 3 }, (_, position) => ({
          ...exercise.sets[0]!, id: `${exercise.id.slice(0, -1)}${position + 1}`, position,
          fact: state === 'complete' || state === 'middle' && position === 0 ? { weightKg: 20, reps: 10 } : {},
          confirmedAt: state === 'complete' || state === 'middle' && position === 0 ? '2026-10-08T09:00:30Z' : null,
        }))
      }
      await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
      await page.addInitScript(({ profileId, density }) => localStorage.setItem(`fit.coachLiveDensity.${profileId}`, density), { profileId, density })
      const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [source] })
      if (density === 'original' && state === 'middle') {
        await page.route('**/v1/workout-exercises/*/comment', async route => {
          const current = backend.getWorkouts()[0]!
          const command = route.request().postDataJSON() as { comment: string; expectedVersion: number }
          expect(command.expectedVersion).toBe(current.version)
          const exercise = current.exercises.find(item => route.request().url().endsWith(`/${item.id}/comment`))!
          exercise.trainerComment = command.comment
          current.version++
          await route.fulfill({ json: { exercise: { version: current.version } } })
        })
      }
      await page.goto(`/workouts/${workoutId}/live`)
      const group = page.locator('.coach-v79-circuit')
      await expect(group).toHaveCount(1)
      const head = group.locator(':scope > .circuit-head')
      await expect(head).toContainText('Суперсет')
      await expect(head).toContainText(state === 'complete' ? 'Завершено · 3/3' : `Круг ${state === 'middle' ? 2 : 1} из 3`)
      await expect(group.locator('.coach-v79-circuit-summary')).toHaveText('Приседания · Жим')
      await expect(head).toHaveCSS('flex-wrap', 'nowrap')
      const menu = head.getByRole('button', { name: 'Ещё действия', exact: true })
      const headBox = await head.boundingBox(), menuBox = await menu.boundingBox()
      expect(headBox && menuBox && menuBox.x > headBox.x + headBox.width / 2).toBeTruthy()
      const add = group.locator('.live-round-actions')
      expect(await add.evaluate(element => Boolean(element.previousElementSibling?.matches('.circuit-round')))).toBe(true)
      if (state !== 'complete') {
        const current = group.locator('.circuit-round.current')
        await expect(current.getByLabel('Фактический вес', { exact: true }).first()).toHaveCSS('height', density === 'original' ? '54px' : '48px')
        await expect(current.locator('.workout-exercise-header-summary').first()).toContainText('План на круг:')
        await expect(current.locator('.live-set-number').first()).toHaveText(state === 'middle' ? '2' : '1')
        await expect(group.locator('.circuit-round-toggle').last()).toContainText('Впереди')
      }
      const rounds = group.locator('.circuit-round')
      if (state === 'complete') {
        await expect(group.locator('.coach-v79-circuit-body')).toHaveAttribute('inert', '')
        expect((await group.boundingBox())!.height).toBeLessThan(180)
        await group.screenshot({ path: info.outputPath(`superset-${density}-completed-summary.png`) })
        await head.getByRole('button', { name: /^Результаты суперсета:/ }).click()
        for (const index of [0, 1]) {
          await rounds.nth(index).locator('.circuit-round-toggle').click()
          await expect(rounds.nth(index).locator('.live-exercise-note')).toHaveCount(2)
          await expect(rounds.nth(index).locator('.live-exercise-note').first()).toBeVisible()
          await expect(rounds.nth(index).locator('.coach-v79-circuit-tools .overflow-trigger')).toHaveCount(2)
          await expect(rounds.nth(index).locator('.live-exercise-note').first()).toContainText('Контролировать темп')
        }
      } else {
        await expect(rounds.filter({ has: page.locator('.circuit-round-label') }).locator('.coach-v79-circuit-tools .overflow-trigger')).toHaveCount(2)
      }
      // One mutation path; the other cases verify the density/state presentation.
      if (density === 'original' && state === 'middle') {
        const current = rounds.nth(1), note = current.locator('.live-exercise-note').first()
        await note.locator('summary').click()
        await note.locator('textarea').fill('Не торопиться на опускании')
        await note.locator('textarea').press('Tab')
        await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.trainerComment).toBe('Не торопиться на опускании')
        await rounds.first().locator('.circuit-round-toggle').click()
        await expect(rounds.first().locator('.live-exercise-note').first()).toContainText('Не торопиться на опускании')
        const title = current.locator('.exercise-technique-trigger').first()
        await title.click()
        await expect(current.locator('.coach-v79-card-body').first()).toHaveAttribute('inert', '')
        await expect(rounds.first().locator('.coach-v79-card-body').first()).not.toHaveAttribute('inert', '')
        await rounds.first().getByLabel('Фактические повторы', { exact: true }).last().press('Enter')
        await expect(current.locator(`[data-live-set-id="${source.exercises[1]!.sets[1]!.id}"]`).getByLabel('Фактический вес', { exact: true })).toBeFocused()
        await title.click()
        await expect(note.locator('textarea')).toHaveValue('Не торопиться на опускании')
        await current.locator('.coach-v79-circuit-tools .overflow-trigger').first().click()
        await expect(page.getByRole('menuitem', { name: 'Показать план', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await current.getByRole('button', { name: 'Инструкция', exact: true }).click()
        await expect(page.getByRole('dialog', { name: /^Техника:/ })).toBeVisible()
        await page.getByRole('button', { name: 'Закрыть технику', exact: true }).click()
        await expect(note.locator('textarea')).toHaveValue('Не торопиться на опускании')
      }
      await group.evaluate(element => element.scrollIntoView({ block: 'start' }))
      await page.locator('.content').evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 80) })
      await page.screenshot({ path: info.outputPath(`superset-${density}-${state}.png`) })
    })
  }
}

test.skip(process.env.FIT_COACH_LIVE_V79_ACCEPTANCE !== '1', 'Dedicated coach-v79 production-build harness')

for (const profileId of ['c0ac0000-6010-4000-8000-000000000001', 'c0ac0000-6010-4000-8000-000000000002']) {
  test(`v79 adjacent superset ${profileId}`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
    const source = coachGestureWorkout(), first = source.exercises[0]!, second = source.exercises[1]!
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [source] })
    const commands: string[] = []
    await page.route('**/blocks/*/merge-next', async route => {
      const command = route.request().postDataJSON() as { preset: string; expectedVersion: number }
      const current = backend.getWorkouts()[0]!
      expect(command).toMatchObject({ preset: 'set', expectedVersion: current.version })
      expect(route.request().url()).toContain(`/blocks/${first.blockId}/merge-next`)
      commands.push('merge')
      for (const exercise of current.exercises.slice(0, 2)) {
        exercise.blockId = first.blockId; exercise.blockType = 'group'; exercise.blockPreset = 'set'; exercise.blockRounds = 2
        exercise.restBetweenExercisesSec = 0; exercise.restBetweenRoundsSec = 90
      }
      current.version++
      await route.fulfill({ status: 200, json: { block: { id: first.blockId, version: current.version, replayed: false } } })
    })
    await page.route('**/blocks/*/split', async route => {
      commands.push('split')
      const current = backend.getWorkouts()[0]!
      current.exercises.slice(0, 2).forEach((exercise, index) => {
        exercise.blockType = 'single'; exercise.blockId = source.exercises[index]!.id; exercise.blockRounds = 1
      })
      current.version++
      await route.fulfill({ status: 200, json: { block: { id: first.blockId, version: current.version, replayed: false } } })
    })
    const roundCommands: string[] = []
    if (profileId.endsWith('1')) {
      await page.route('**/blocks/*/rounds', async route => {
        const current = backend.getWorkouts()[0]!
        expect(route.request().method()).toBe('POST')
        expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
        const members = current.exercises.filter(exercise => exercise.blockId === first.blockId)
        members.forEach((exercise, index) => { exercise.sets.push({ ...exercise.sets.at(-1)!, id: `c0ac0000-6010-4000-8000-0000000008${index}2`, position: 2, fact: {}, confirmedAt: null }); exercise.blockRounds = 3 })
        current.version++; roundCommands.push('append')
        await route.fulfill({ status: 200, json: { block: { id: first.blockId, version: current.version, replayed: false } } })
      })
      await page.route('**/blocks/*/rounds/2', async route => {
        const current = backend.getWorkouts()[0]!
        expect(route.request().method()).toBe('DELETE')
        expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
        const members = current.exercises.filter(exercise => exercise.blockId === first.blockId)
        expect(members.every(exercise => exercise.sets.at(-1)?.position === 2 && !exercise.sets.at(-1)?.confirmedAt && Object.keys(exercise.sets.at(-1)!.fact).length === 0)).toBe(true)
        members.forEach(exercise => { exercise.sets = exercise.sets.filter(set => set.position !== 2); exercise.blockRounds = 2 })
        current.version++; roundCommands.push('remove')
        await route.fulfill({ status: 200, json: { block: { id: first.blockId, version: current.version, replayed: false } } })
      })
    }
    await page.goto(`/workouts/${workoutId}/live`)
    await page.locator(`[data-workout-block="${first.blockId}"]`).getByRole('button', { name: 'Ещё действия', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Объединить со следующим в суперсет', exact: true }).click()
    await expect(page.locator('.exercise-block.live')).toHaveCount(1)
    await expect(page.locator('.circuit-round')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Круг', exact: true })).toBeVisible()
    const group = page.locator('.exercise-block.live')
    if (profileId.endsWith('1')) {
      await group.getByRole('button', { name: 'Круг', exact: true }).click()
      await expect(group.locator('.circuit-round')).toHaveCount(3)
      const lastRound = group.locator('.circuit-round').last()
      await lastRound.getByRole('button', { name: /Круг 3/ }).click()
      const row = lastRound.locator('[data-live-set-id]').first()
      const swipeRound = async () => {
        const field = row.getByLabel('Фактический вес', { exact: true })
        // A round now unfolds; begin the real gesture only once its origin is
        // stable and hittable. Trial does not focus/edit or dispatch the swipe.
        await field.click({ trial: true })
        const gesture = await beginClientGesture(page, row, browserName, field)
        await gesture.move(60); await gesture.end()
      }
      await swipeRound()
      await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
      await expect(group.locator('.circuit-round')).toHaveCount(3)
      expect(backend.getWorkouts()[0]!.exercises.filter(exercise => exercise.blockId === first.blockId).map(exercise => exercise.sets.at(-1)!.fact)).toEqual([{}, {}])
      await swipeRound()
      await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Убрать', exact: true }).click()
      await expect(group.locator('.circuit-round')).toHaveCount(2)
      expect(roundCommands).toEqual(['append', 'remove'])
    }
    await group.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    await expect(page.locator(`[data-live-set-id="${first.sets[0]!.id}"]`)).toHaveClass(/confirmed/)
    await group.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    // The completed round intentionally collapses after its final member.
    await expect.poll(() => backend.getWorkouts()[0]!.exercises.find(exercise => exercise.id === second.id)!.sets[0]!.confirmedAt).not.toBeNull()
    await expect(group.locator('.circuit-round-toggle').first()).toContainText('2 из 2 выполнено')
    await expect(page.locator('.coach-v79-actions .live-rest-trigger')).toContainText('1:30')
    await group.locator('.circuit-head').getByRole('button', { name: 'Ещё действия', exact: true }).click()
    const unavailableMerge = page.getByRole('menuitem', { name: 'Добавить следующее в суперсет', exact: true })
    await expect(unavailableMerge).toBeDisabled()
    await expect(unavailableMerge).toContainText('Есть выполненные подходы')
    await page.screenshot({ path: info.outputPath('coach-live-superset-unavailable.png') })
    await page.getByRole('menuitem', { name: 'Разделить суперсет', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Разделить', exact: true }).click()
    await expect(page.locator('.exercise-block.live')).toHaveCount(0)
    // Only the active single exercise is expanded after splitting.
    await expect.poll(() => backend.getWorkouts()[0]!.exercises.flatMap(exercise => exercise.sets).filter(set => set.confirmedAt).length).toBe(2)
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 6')
    await expect(page.locator('.coach-v79-actions .live-rest-trigger')).toContainText('1:30')
    expect(commands).toEqual(['merge', 'split'])
    await page.reload()
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 6')
    await expect(page.locator('.coach-v79-actions .live-rest-trigger')).toContainText('1:30')
    await page.screenshot({ path: info.outputPath('coach-live-superset-split.png') })
  })
}
const pilot = 'c0ac0000-6010-4000-8000-000000000001'
// Theme/density affect wrapping and touch geometry. Each scenario checks one
// disclosure cycle; the extra widths only exercise the same open layout.
for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`v79 workout note disclosure ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(({ pilot, density, theme }) => {
    localStorage.setItem('fit.appTheme', theme)
    localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density)
  }, { pilot, density, theme })
  const source = coachGestureWorkout()
  source.notes = ('Полная общая заметка из Ассистента, без сокращения текста.\n').repeat(30)
  source.exercises[0]!.trainerComment = 'Отдельная заметка к упражнению'
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.coach-live-v79')).toBeVisible()
  const note = page.locator('.coach-live-workout-note-disclosure'), summary = note.locator('summary')
  const field = page.getByLabel('Фактический вес', { exact: true }).first()
  const element = await field.elementHandle(), value = await field.inputValue()
  const stored = JSON.stringify(backend.getWorkouts()[0])
  await expect(note).not.toHaveAttribute('open', '')
  await expect(note.locator('p')).toBeHidden()
  await expect(summary.locator('span').first()).toHaveText('Заметка к тренировке')
  await expect(note.locator('.live-workout-note-read')).toBeVisible()
  await expect(note.locator('.live-workout-note-hide')).toBeHidden()
  expect((await note.boundingBox())!.height).toBeLessThanOrEqual(60)
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(note.locator('p')).toBeVisible()
  expect(await note.locator('p').textContent()).toBe(source.notes)
  await expect(note.locator('p')).toHaveCSS('white-space', 'pre-wrap')
  await expect(note.locator('.live-workout-note-hide')).toBeVisible()
  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await note.screenshot({ path: info.outputPath(`coach-note-open-${width}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await summary.click()
  await expect(note.locator('p')).toBeHidden()
  await summary.focus()
  await page.keyboard.press('Space')
  await expect(note.locator('p')).toBeVisible()
  await summary.click()
  expect(await element!.evaluate(e => e.isConnected)).toBe(true)
  await expect(field).toHaveValue(value)
  expect(JSON.stringify(backend.getWorkouts()[0])).toBe(stored)
  await page.locator('.content').evaluate(e => { e.scrollTop = 0 })
  await page.screenshot({ path: info.outputPath('coach-note-collapsed.png') })
  await page.reload()
  await expect(page.locator('.coach-live-v79')).toBeVisible()
  await expect(note.locator('p')).toBeHidden()
  await summary.click()
  expect(await note.locator('p').textContent()).toBe(source.notes)
  expect(JSON.stringify(backend.getWorkouts()[0])).toBe(stored)
})

test('v79 workout note empty and short', async ({ page }) => {
  const source = coachGestureWorkout(); source.notes = '  '
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.coach-live-v79')).toBeVisible()
  await expect(page.locator('.coach-live-workout-note')).toHaveCount(0)
  backend.getWorkouts()[0]!.notes = 'Спокойный темп.'
  await page.reload()
  const note = page.locator('.coach-live-workout-note-disclosure')
  await expect(note.locator('p')).toBeHidden()
  await note.locator('summary').click()
  await expect(note.locator('p')).toHaveText('Спокойный темп.')
})
for (const density of ['original', 'compact']) test(`v79 clock handoff preserves fields and deadline ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-25T08:59:00Z') })
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-25T08:59:00Z'
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const root = page.locator('.coach-live-v79')
  await expect(root.locator('.coach-v79-large-clock')).toBeVisible()
  await page.clock.pauseAt(new Date('2026-10-25T09:00:00Z'))
  const big = root.locator('.coach-v79-large-clock'), small = root.locator('.coach-v79-small-clock')
  await expect(big).toHaveAttribute('aria-label', 'Тренировка: 01:00')
  await expect(small).toHaveText('01:00')
  const field = page.getByLabel('Фактический вес', { exact: true }).last()
  const input = await field.elementHandle()
  await field.fill('29.5'); await field.blur()
  // Intermediate scroll positions catch the old hard seam, not only endpoints.
  // Sample the same real scroll owner; no new timer, fixture or viewport axis.
  let previousGlow = 1, previousLarge = 1, previousSmall = 0
  for (const offset of [0, 40, 80, 120, 160, 180]) {
    await page.locator('.content').evaluate((e, value) => { e.scrollTop = value }, offset)
    await expect.poll(() => root.evaluate(e => {
      const clock = e.querySelector('.coach-v79-large-clock')!.getBoundingClientRect(), header = e.querySelector('.page-header')!.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (header.bottom - clock.top) / clock.height))
      return Math.abs(Number(getComputedStyle(e).getPropertyValue('--v79-glow-opacity')) - (1 - x * x * (3 - 2 * x)))
    })).toBeLessThan(.001)
    const presentation = await root.evaluate(e => {
      const css = getComputedStyle(e)
      return { glow: Number(css.getPropertyValue('--v79-glow-opacity')), large: Number(css.getPropertyValue('--v79-large-opacity')), small: Number(css.getPropertyValue('--v79-small-opacity')) }
    })
    expect(presentation.glow).toBeLessThanOrEqual(previousGlow + .001)
    expect(presentation.large).toBeLessThanOrEqual(previousLarge + .001)
    expect(presentation.small).toBeGreaterThanOrEqual(previousSmall - .001)
    expect(presentation.large * presentation.small).toBeLessThan(.001)
    previousGlow = presentation.glow; previousLarge = presentation.large; previousSmall = presentation.small
  }
  await expect(big).toHaveAttribute('aria-label', 'Тренировка: 01:00')
  await page.locator('.content').evaluate(e => e.scrollTop = 180)
  await expect.poll(() => root.evaluate(e => Number(getComputedStyle(e).getPropertyValue('--v79-small-opacity')))).toBeGreaterThan(.98)
  await expect.poll(() => root.evaluate(e => Number(getComputedStyle(e).getPropertyValue('--v79-status-opacity')))).toBe(0)
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  await expect.poll(() => root.evaluate(e => Number(getComputedStyle(e).getPropertyValue('--v79-large-opacity')))).toBe(1)
  expect(await input!.evaluate(e => e.isConnected)).toBe(true)
  await expect(field).toHaveValue('29.5')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).not.toBeNull()
  await expect(big).toHaveAttribute('aria-label', 'Отдых: 00:02')
  await expect(big.locator(':scope > .coach-live-digits')).toHaveCSS('font-size', density === 'original' ? '96px' : '48px')
  await expect(big.locator('.coach-v79-elapsed .coach-live-digits')).toHaveCSS('font-size', density === 'original' ? '30px' : '20px')
  const until = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  await page.locator('.content').evaluate(e => e.scrollTop = 400)
  const compactRest = root.locator('.coach-v79-small-action .live-rest-trigger')
  await expect(compactRest.locator('span')).toHaveText('0:02')
  await expect(compactRest.locator('span')).toHaveCSS('clip-path', 'none')
  expect(await compactRest.locator('span').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(1)
  await page.clock.runFor(4000)
  await expect(big).toHaveAttribute('aria-label', 'Тренировка: 01:04')
  await expect(root.locator('.coach-v79-actions .live-rest-trigger')).toContainText('Отдых −0:02')
  await expect(compactRest.locator('span')).toHaveText('−0:02')
  await expect(small).toHaveText('01:04')
  await page.screenshot({ path: info.outputPath(`${density}-docked-overdue.png`) })
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(until)
  await expect(field).toHaveValue('29.5')
  await page.screenshot({ path: info.outputPath(`${density}-clock.png`), fullPage: true })
})
// Two densities have different clock sizes/heights; browser engines differ in
// CSS animation and sticky scroll. No extra users or width cross-product.
for (const density of ['original', 'compact']) test(`v79 source rest motion keeps scroll and inputs ${density}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  const field = page.getByLabel('Фактический вес', { exact: true }).last(), element = await field.elementHandle()
  await field.fill('29.5'); await field.blur()
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  const clock = page.locator('.coach-v79-large-clock > .coach-live-digits')
  const motion = await clock.evaluate(e => {
    const animation = e.getAnimations().find(a => (a as CSSAnimation).animationName === 'coach-v79-rest-entry')!
    const frames = (animation.effect as KeyframeEffect).getKeyframes()
    animation.pause(); animation.currentTime = 100
    return { first: frames[0]!.transform, last: frames.at(-1)!.transform, duration: animation.effect!.getTiming().duration, scale: getComputedStyle(e).transform }
  })
  expect(motion.first).toBe('scale(0.4)')
  expect(motion.last).toBe('scale(1)')
  expect(motion.duration).toBe(600)
  expect(motion.scale).not.toBe('none')
  await page.screenshot({ path: info.outputPath(`${density}-rest-entry.png`) })
  await clock.evaluate(e => e.getAnimations().forEach(a => a.finish()))
  await page.locator('.content').evaluate(e => e.scrollTop = 400)
  await expect.poll(() => page.locator('.coach-live-v79').evaluate(e => Number(getComputedStyle(e).getPropertyValue('--v79-small-opacity')))).toBeGreaterThan(.98)
  await page.locator('.coach-v79-small-action button').click({ button: 'right' })
  const restSheet = page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })
  await expect(restSheet).toHaveCSS('padding-top', '0px')
  const restHeader = restSheet.locator('.client-lime-sheet-header')
  const restBox = (await restSheet.boundingBox())!, restHeaderBox = (await restHeader.boundingBox())!
  expect(restHeaderBox.x).toBeCloseTo(restBox.x)
  expect(restHeaderBox.width).toBeCloseTo(restBox.width)
  await page.getByRole('dialog', { name: 'Таймер отдыха', exact: true }).getByRole('button', { name: 'Остановить отдых', exact: true }).click()
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  await expect(page.locator('.coach-v79-timer')).toHaveAttribute('data-state', 'live')
  expect(await element!.evaluate(e => e.isConnected)).toBe(true)
  await expect(field).toHaveValue('29.5')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(clock).toHaveCSS('animation-name', 'none')
  // Global Fit reduced-motion uses !important .01ms (not literal zero).
  expect(await page.locator('.coach-v79-glow').evaluate(e => Number.parseFloat(getComputedStyle(e, '::after').transitionDuration))).toBeLessThanOrEqual(.00001)
  expect(await page.locator('.coach-v79-toggle-arrow').first().evaluate(e => Number.parseFloat(getComputedStyle(e).transitionDuration))).toBeLessThanOrEqual(.00001)
})
for (const role of ['client', 'trainer'] as const) test(`v79 never reaches outside ${role}`, async ({ page }) => {
  await mockPilot(page, { role, profileId: role === 'trainer' ? 'c0ac0000-6010-4000-8000-000000000003' : pilot, fitLime: true, clientLime: role === 'client', workouts: [restTimerWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.coach-live-v79')).toHaveCount(0)
})
for (const density of ['original', 'compact']) test(`v79 cards keep notes full inputs and menus ${density}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  const source = coachGestureWorkout(), first = source.exercises[0]!
  first.trainerComment = 'Полная заметка тренера без потери текста'
  first.sets = Array.from({ length: 6 }, (_, index) => ({ ...first.sets[0]!, id: `c0ac0000-6010-4000-8000-${String(900 + index).padStart(12, '0')}`, position: index }))
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const card = page.locator('.live-exercise').first(), rows = card.locator('form[data-live-set-id]')
  await expect(rows).toHaveCount(6)
  if (density === 'original') {
    await expect(card.locator('.live-exercise-head')).toHaveCSS('min-height', '0px')
    await expect(card.locator('.live-exercise-head')).toHaveCSS('padding-top', '16px')
  }
  await expect(card.locator('.coach-v79-exercise-tools .live-add-set')).toHaveCSS('height', '44px')
  await expect(card.locator('.live-exercise-note')).toHaveCSS('border-top-width', '1px')
  await expect(card.locator('.live-exercise-note > summary')).toHaveCSS('min-height', '44px')
  const field = rows.first().getByLabel('Фактический вес', { exact: true })
  expect(await field.evaluate(e => e.getBoundingClientRect().height)).toBe(density === 'original' ? 54 : 48)
  await card.getByRole('button', { name: 'Ещё действия', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Объединить со следующим в суперсет', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await field.fill('29.5'); const element = await field.elementHandle()
  const toggle = card.locator('.coach-v79-card-toggle')
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(card.locator('.exercise-technique-trigger')).toHaveAttribute('aria-expanded', 'false')
  await expect(card).toHaveCSS('background-color', 'rgb(26, 26, 28)')
  const icon = toggle.locator('.coach-v79-toggle-icon')
  await expect(icon).toHaveAttribute('data-folded', 'true')
  await expect(icon.locator('.coach-v79-toggle-open').first()).toHaveCSS('opacity', '1')
  await expect(icon.locator('.coach-v79-toggle-closed').first()).toHaveCSS('opacity', '0')
  await expect(icon.locator('.coach-v79-toggle-arrow').first()).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)')
  await page.screenshot({ path: info.outputPath(`${density}-folded-source.png`) })
  expect(await element!.evaluate(e => e.isConnected)).toBe(true)
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toHaveCSS('background-color', 'rgb(37, 37, 41)')
  await expect(icon.locator('.coach-v79-toggle-arrow').first()).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await expect(field).toBeVisible(); await expect(field).toHaveValue('29.5')
  await card.locator('.live-exercise-note > summary').click()
  await expect(card.getByLabel(`Заметка: ${first.name}`, { exact: true })).toHaveValue(first.trainerComment)
  expect(await card.locator('.coach-v79-card-body > div').evaluate(e => e.scrollTop)).toBe(0)
  expect(await page.locator('.content').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.locator('.content').evaluate(e => e.scrollTop = 400)
  const rest = page.locator('.coach-v79-small-action button'), finish = page.getByRole('button', { name: 'Завершить тренировку', exact: true })
  await expect(rest).toBeVisible()
  const restBox = (await rest.boundingBox())!, finishBox = (await finish.boundingBox())!
  expect(restBox.width).toBeGreaterThanOrEqual(44)
  expect(restBox.height).toBeGreaterThanOrEqual(44)
  expect(restBox.x + restBox.width).toBeLessThanOrEqual(finishBox.x)
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  await page.screenshot({ path: info.outputPath(`${density}-six-sets-notes.png`) })
})

test('v79 density keeps one focused form and rest while viewport contracts', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T08:59:00Z') })
  await page.addInitScript(() => {
    const viewport = new EventTarget()
    Object.defineProperties(viewport, { height: { get: () => Number(document.documentElement.dataset.testVisibleHeight ?? innerHeight) }, offsetTop: { get: () => 0 } })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [restTimerWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.coach-live-v79')).toBeVisible()
  await page.clock.pauseAt(new Date('2026-10-08T09:00:00Z'))
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  const deadline = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  const field = page.getByLabel('Фактический вес', { exact: true }).last()
  await field.fill('29.5'); const element = await field.elementHandle()
  for (const density of ['compact', 'original']) {
    await page.evaluate(({ pilot, density }) => {
      const key = `fit.coachLiveDensity.${pilot}`
      localStorage.setItem(key, density); window.dispatchEvent(new StorageEvent('storage', { key, newValue: density }))
      document.documentElement.dataset.testVisibleHeight = '400'; window.visualViewport?.dispatchEvent(new Event('resize'))
    }, { pilot, density })
    await page.clock.runFor(250)
    await expect(field).toBeFocused(); await expect(field).toHaveValue('29.5')
    expect(await element!.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true)
    await expect.poll(() => field.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 52 && r.bottom <= 400 })).toBe(true)
    expect(await field.evaluate(e => e.getBoundingClientRect().height)).toBe(density === 'original' ? 54 : 48)
  }
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(deadline)
})

test('v79 sheets keep real catalogue filters creation and single add', async ({ page }, info) => {
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.live-add-exercise').click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await expect(picker).toBeVisible()
  await expect(page.locator('.coach-live-v79-shell')).toBeVisible()
  await expect(picker).toHaveCSS('border-radius', '40px')
  await expect(picker.getByRole('heading', { name: 'Добавить упражнение', exact: true })).toHaveCSS('font-size', '16px')
  await picker.getByRole('button', { name: 'Фильтровать', exact: true }).click()
  const filters = picker.getByRole('region', { name: 'Фильтры упражнений' })
  await filters.getByRole('button', { name: 'Ноги', exact: true }).click()
  await expect(filters.getByRole('button', { name: 'Ноги', exact: true })).toHaveCSS('background-color', 'rgb(186, 96, 234)')
  await picker.getByRole('button', { name: 'Применить фильтры', exact: true }).click()
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  await expect(picker.getByLabel('Название', { exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Назад к упражнениям', exact: true }).click()
  await expect(picker.getByLabel('Поиск упражнения')).toBeVisible()
  await page.screenshot({ path: info.outputPath('v79-catalogue.png') })
  await picker.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await page.locator('.live-add-exercise').click()
  await picker.getByLabel('Поиск упражнения').fill('планка')
  await picker.getByRole('button', { name: 'Добавить: Планка', exact: true }).click()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(4)
  await expect(picker).toHaveCount(0)
})

// One root sheet flow per engine: shared by both densities. Chromium drives
// actual CDP touch; WebKit exercises pointer capture/mouse (not a real iPhone).
test('v79 catalogue header drag preserves scroll drafts and single add', async ({ page, browserName }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [coachGestureWorkout()] })
  const count = backend.getWorkouts()[0]!.exercises.length
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.live-add-exercise').click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true }), title = picker.locator('.client-lime-sheet-header h1')
  await expect.poll(() => picker.evaluate(e => e.getAnimations().filter(a => a.playState === 'running').length)).toBe(0)
  const top = (await picker.boundingBox())!.y
  let gesture = await beginClientGesture(page, picker, browserName, title)
  await gesture.move(0, 32); await page.waitForTimeout(100); await gesture.end()
  await expect(picker).toBeVisible()
  await expect.poll(async () => Math.abs((await picker.boundingBox())!.y - top)).toBeLessThan(1)
  gesture = await beginClientGesture(page, picker, browserName, title)
  await gesture.move(0, 200); await gesture.end(true)
  await expect(picker).toBeVisible()
  await expect.poll(async () => Math.abs((await picker.boundingBox())!.y - top)).toBeLessThan(1)
  const list = picker.locator('.picker-list')
  if (browserName === 'chromium') {
    gesture = await beginClientGesture(page, list, browserName); await gesture.move(0, -120); await gesture.end()
  } else {
    // Mobile WebKit's automation has no wheel/touch-pan API. Check retained
    // scroll here; genuine touch-pan is exercised above through Chromium CDP.
    await list.evaluate(e => e.scrollTop = 200)
  }
  await expect.poll(() => list.evaluate(e => e.scrollTop)).toBeGreaterThan(0)
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: /Фильтровать/ }).click()
  gesture = await beginClientGesture(page, picker, browserName, title); await gesture.move(0, 200); await gesture.end()
  await expect(picker.getByRole('region', { name: 'Фильтры упражнений' })).toBeVisible()
  await picker.getByRole('button', { name: 'Применить фильтры', exact: true }).click()
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  const name = picker.getByPlaceholder('Например: Болгарский присед')
  await name.fill('Несохранённое упражнение')
  gesture = await beginClientGesture(page, picker, browserName, title); await gesture.move(0, 200); await gesture.end()
  await expect(name).toHaveValue('Несохранённое упражнение')
  await picker.getByRole('button', { name: 'Назад к упражнениям', exact: true }).click()
  gesture = await beginClientGesture(page, picker, browserName, title); await gesture.move(0, 200)
  await page.screenshot({ path: info.outputPath('catalogue-drag-in-progress.png') })
  await gesture.end()
  await expect(picker).toHaveCount(0)
  expect(backend.getWorkouts()[0]!.exercises).toHaveLength(count)
})
test('v79 row and exercise swipes stay separate from drag and editing', async ({ page, browserName }) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  const source = coachGestureWorkout(), first = source.exercises[0]!
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`[data-live-set-id="${first.sets[1]!.id}"]`)
  const field = row.getByLabel('Фактический вес', { exact: true })
  await field.fill('31'); await field.blur()
  const gesture = await beginClientGesture(page, row, browserName, row.locator('.live-set-number'))
  await gesture.move(60); await gesture.end()
  await expect(row.getByRole('button', { name: /Удалить подход 2:/ })).toBeVisible()
  await expect(page.locator('[data-workout-swipe]').getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0)
  await row.getByRole('button', { name: /Удалить подход 2:/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(field).toHaveValue('31')
  const handle = page.getByRole('button', { name: 'Переместить: Приседания', exact: true })
  await handle.focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect.poll(() => backend.getWorkouts()[0]!.exercises.at(-1)!.id).toBe(first.id)
  const outer = page.locator(`[data-workout-swipe="${first.id}"]`)
  const exerciseGesture = await beginClientGesture(page, outer, browserName, outer.locator('.live-exercise-head h2').first())
  await exerciseGesture.move(100); await exerciseGesture.end()
  await outer.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(field).toHaveValue('31')
})

test('v79 docked rest returns keyboard focus to its visible trigger', async ({ page }) => {
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  const root = page.locator('.coach-live-v79')
  await expect(root).toBeVisible()
  await page.locator('.content').evaluate(e => e.scrollTop = 220)
  const small = root.locator('.coach-v79-small-action button')
  await expect.poll(() => root.locator('.coach-v79-small-action').getAttribute('aria-hidden')).toBe('false')
  await small.click()
  const sheet = page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await expect(small).toBeFocused()
})

// Widths cover narrow title wrapping, wider phone fields and the trainer desktop
// shell. Interaction contracts above are not repeated across this visual matrix.
for (const width of [375, 430, 1440]) for (const density of ['original', 'compact']) test(`v79 source geometry ${density} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  const source = coachGestureWorkout()
  source.exercises[0]!.name = 'Жим гантелей на наклонной скамье с полным длинным названием упражнения'
  source.clientName = 'Алексей Константинович Смирнов — длинное имя клиента'
  source.notes = 'Полная заметка к тренировке без подмены демонстрационными данными'
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const card = page.locator('.live-exercise').first(), field = card.getByLabel('Фактический вес', { exact: true }).first()
  await expect(field).toHaveCSS('height', density === 'original' ? '54px' : '48px')
  const title = card.locator('.live-exercise-head h2')
  await expect(title).toHaveText(source.exercises[0]!.name)
  expect(await title.evaluate(e => e.scrollHeight <= e.clientHeight + 1)).toBe(true)
  await expect(card.locator('.coach-v79-card-toggle')).toHaveCSS('height', '44px')
  await expect(page.getByLabel('Заметка к тренировке', { exact: true })).toHaveText(source.notes)
  const header = page.locator('.live-session-header'), progress = header.locator('.live-session-progress-copy')
  await expect(header.locator('h2')).toHaveCSS('font-size', density === 'original' ? '24px' : '20px')
  await expect(header.locator('.coach-live-client')).toHaveText(source.clientName)
  await expect(progress).toContainText('подход 1 из 2')
  await expect(progress).toContainText('Готово 0 из 6')
  await expect(progress).toHaveCSS('clip-path', 'none')
  await expect(progress).toHaveCSS('position', 'static')
  expect(await progress.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(1)
  expect(await page.locator('.content').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.locator('.content').evaluate(e => e.scrollTop = 0)
  await page.screenshot({ path: info.outputPath(`${density}-${width}-source.png`) })
})

test('v79 retry and partial finish keep actual facts instead of demo reset', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  const backend = await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [coachGestureWorkout()], failFirstSetConfirm: true })
  const setId = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.id
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`[data-live-set-id="${setId}"]`)
  await row.getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  const sync = page.locator('.live-sync-state')
  await expect(sync).toContainText('Не удалось отправить')
  await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('27.5')
  await sync.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).not.toBeNull()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toContainText('Есть незавершённые подходы')
  await page.locator('.finish-confirm').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(backend.getWorkouts()[0]!.status).toBe('in_progress')
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.locator('.finish-confirm').getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page).not.toHaveURL(/\/live$/)
  await page.reload()
  expect(backend.getWorkouts()[0]!.status).toBe('done')
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
})

for (const density of ['original', 'compact']) test(`v79 empty session preserves add without another Start ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  const source = restTimerWorkout(); source.exercises = []; source.startedAt = new Date(Date.now() - 60000).toISOString()
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-pinned-empty')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Начать/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Завершить тренировку', exact: true })).toBeDisabled()
  await expect.poll(() => page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).evaluate(e => {
    const button = e.getBoundingClientRect(), bar = document.querySelector('.live-bottom-bar-empty')!.getBoundingClientRect()
    return button.top >= 0 && button.bottom <= bar.top
  })).toBe(true)
  expect(await page.locator('.content').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`empty-${density}.png`) })
  await page.getByRole('button', { name: 'Выбрать упражнение', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })).toBeVisible()
})

// Two densities exercise the approved54/48 geometry, not duplicate business flows.
for (const density of ['original', 'compact']) test(`v79 duration distance RPE and reduced-motion sheets use existing controls ${density}`, async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  await page.addInitScript(({ pilot, density }) => localStorage.setItem(`fit.coachLiveDensity.${pilot}`, density), { pilot, density })
  const source = coachGestureWorkout()
  source.exercises[1] = { ...source.exercises[1]!, ref: 'plank', name: 'Планка', inputKind: 'duration', sets: source.exercises[1]!.sets.map(s => ({ ...s, weightKg: undefined, reps: undefined, durationSec: 60 })) }
  source.exercises[2] = { ...source.exercises[2]!, ref: 'running', name: 'Бег', inputKind: 'distance', sets: source.exercises[2]!.sets.map(s => ({ ...s, weightKg: undefined, reps: undefined, durationSec: 600, distanceKm: 1.5 })) }
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const cards = page.locator('.live-exercise')
  const duration = cards.nth(1).getByRole('button', { name: /Фактическое время:/ }).first()
  const height = density === 'original' ? '54px' : '48px'
  await expect(duration).toHaveCSS('height', height)
  await expect(duration.locator('..')).toHaveCSS('grid-column', '2 / 4')
  await expect(cards.nth(1).locator('.live-set-empty').first()).toHaveCSS('display', 'none')
  await duration.click()
  const sheet = page.getByRole('dialog', { name: 'Фактическое время', exact: true })
  await expect(sheet).toBeVisible(); await expect(sheet).toHaveCSS('border-radius', '40px')
  await expect(sheet).toHaveCSS('padding-top', '0px')
  const sheetBox = (await sheet.boundingBox())!, headerBox = (await sheet.locator('.client-lime-sheet-header').boundingBox())!
  expect(headerBox.x).toBeCloseTo(sheetBox.x)
  expect(headerBox.width).toBeCloseTo(sheetBox.width)
  await page.screenshot({ path: info.outputPath(`${density}-duration-sheet.png`) })
  await sheet.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
  await expect(duration).toBeFocused()
  await expect(cards.nth(2).locator('.run-distance-control').first()).toHaveCSS('height', height)
  await cards.first().getByRole('button', { name: 'Ещё действия', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Указать RPE', exact: true }).click()
  await expect(cards.first().locator('.live-set-rpe').first()).toHaveCSS('height', height)
  await cards.nth(1).scrollIntoViewIfNeeded()
  // WebKit may capture its sticky layer before the scroll frame is painted.
  await expect.poll(() => page.locator('.coach-live-v79').evaluate(e => Number(getComputedStyle(e).getPropertyValue('--v79-small-opacity')))).toBeGreaterThan(.98)
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  await page.screenshot({ path: info.outputPath(`${density}-duration-distance.png`) })
})

test('v79 Live presentation never enters the existing planner', async ({ page }) => {
  const source = coachGestureWorkout()
  await mockPilot(page, { profileId: pilot, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/new?client=${source.clientId}&date=2026-10-25`)
  await expect(page.getByRole('button', { name: 'Выбрать упражнения', exact: true })).toBeVisible()
  await expect(page.locator('.coach-live-v79-shell')).toHaveCount(0)
  await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })).toBeVisible()
  await expect(page.locator('.coach-v79-picker-overlay')).toHaveCount(0)
})
