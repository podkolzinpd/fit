import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

export function quickWorkoutEntryCases() {
  test.skip(process.env.FIT_QUICK_WORKOUT_ENTRY_ACCEPTANCE !== '1', 'Dedicated native quick-entry harness')
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
