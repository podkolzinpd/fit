import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

/** Each role has different access and composition; plan and Live use different fields. */
export function rpeFiveCases() {
  for (const role of ['trainer', 'client'] as const) {
    const actor = role === 'trainer' ? 'c0ac0000-6010-4000-8000-000000000001' : 'c11e0000-6010-4000-8000-000000000001'
    test(`RPE5 and5.5 persist in ${role} plan`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
      await page.addInitScript(id => localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'), actor)
      const source = coachGestureWorkout(false, 1)
      source.status = 'planned'; source.startedAt = null; source.createdBy = actor; source.workoutDate = '2026-11-06'
      const backend = await mockPilot(page, { role, profileId: actor, fitLime: true, clientLime: role === 'client', workouts: [source] })
      const commands: number[][] = []
      await page.route(`**/v1/workouts/${workoutId}`, async route => {
        if (route.request().method() !== 'PUT') return route.fallback()
        const draft = route.request().postDataJSON() as { exercises: Array<{ sets: Array<{ rpe: number }> }> }
        commands.push(draft.exercises.map(exercise => exercise.sets.map(set => set.rpe)).flat())
        const current = backend.getWorkouts()[0]!
        current.exercises.forEach((exercise, i) => exercise.sets.forEach((set, j) => { set.rpe = draft.exercises[i]!.sets[j]!.rpe }))
        current.version += 1
        await route.fulfill({ json: { workout: { id: workoutId } } })
      })
      await page.goto(`/workouts/${workoutId}/edit`)
      await page.getByLabel('Целевой RPE, подход 1', { exact: true }).selectOption('5')
      await page.getByLabel('Целевой RPE, подход 2', { exact: true }).selectOption('5.5')
      await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
      await expect.poll(() => commands.length).toBe(1)
      expect(commands[0]!.slice(0,2)).toEqual([5,5.5])
      await page.goto(`/workouts/${workoutId}/edit`)
      await expect(page.getByLabel('Целевой RPE, подход 1', { exact: true })).toHaveValue('5')
      await expect(page.getByLabel('Целевой RPE, подход 2', { exact: true })).toHaveValue('5.5')
    })
    test(`RPE5 and5.5 persist in ${role} Live fact`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
      await page.addInitScript(id => {
        localStorage.setItem(`fit.rpeDisplay.${id}`, 'true')
        localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
      }, actor)
      const source = coachGestureWorkout(false,1)
      const exercise = source.exercises[0]!
      exercise.sets.push({ ...exercise.sets[1]!, id: 'c0ac0000-6010-4000-8000-000000000399', position: 2, rpe: 8, fact: {}, confirmedAt: null })
      source.createdBy = actor; source.workoutDate = '2026-11-06'; source.startedAt = '2026-11-06T08:58:00Z'
      const backend = await mockPilot(page, { role, profileId: actor, fitLime: true, clientLime: role === 'client', workouts: [source] })
      await page.goto(`/workouts/${workoutId}/live`)
      for (const [index,rpe] of [5,5.5].entries()) {
        const setId = source.exercises[0]!.sets[index]!.id
        const row = page.locator(`form[data-live-set-id="${setId}"]`)
        await row.getByLabel('Фактический RPE', { exact: true }).selectOption(String(rpe))
        await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
        await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[index]!.fact.rpe).toBe(rpe)
      }
      await page.reload()
      for (const [index,rpe] of [5,5.5].entries()) {
        const setId = source.exercises[0]!.sets[index]!.id
        const row = page.locator(`form[data-live-set-id="${setId}"]`)
        await expect(row.getByLabel('Фактический RPE', { exact: true })).toHaveValue(String(rpe))
      }
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets[2]!.rpe).toBe(8)
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets[2]!.confirmedAt).toBeNull()
    })
  }
}
