import { expect, test } from '@playwright/test'
import type { WorkoutDraft } from '../src/shared/domain'

// Historical fixtures are intercepted locally; these cases never rewrite real workouts.
const sourceId = 'c5100000-0000-4000-8000-000000000001'
const copyId = 'c5100000-0000-4000-8000-000000000002'
const oldName = 'Жим лёжа (Штанга)'
const newName = 'Жим штанги лёжа'

export function workoutCopyNamesCases() {
  for (const { role, width } of [
    { role: 'client', width: 390 }, { role: 'client', width: 430 }, { role: 'trainer', width: 1440 },
  ] as const) {
    test(`copy names: ${role} ${width} preserves originals and custom labels in light/dark`, async ({ page }, testInfo) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height: 900 })
      const owner = role === 'trainer' ? '90000000-0000-4000-8000-000000000009' : '92000000-0000-4000-8000-000000000029'
      const row = {
        id: sourceId, client_id: '11111111-1111-4111-8111-111111111111', trainer_id: owner, created_by: owner,
        workout_date: '2026-08-10', start_time: null, end_time: null, started_at: null, completed_at: '2026-08-10T10:00:00Z',
        status: 'done', notes: 'Сохранить исходную тренировку', stage_id: null, version: 3,
      }
      const exercises = [
        { exercise_source: 'system', exercise_ref: 'bench-press', exercise_name: oldName, custom_exercise_id: null, input_kind: 'strength', muscle_group: 'chest' },
        { exercise_source: 'custom', exercise_ref: 'c5200000-0000-4000-8000-000000000099', exercise_name: oldName, custom_exercise_id: 'c5200000-0000-4000-8000-000000000099', input_kind: 'strength', muscle_group: 'chest' },
        { exercise_source: 'system', exercise_ref: 'running', exercise_name: 'Бег — восстановление', custom_exercise_id: null, input_kind: 'distance', muscle_group: 'cardio' },
      ].map((exercise, position) => ({
        ...exercise, id: `c5200000-0000-4000-8000-00000000000${position + 1}`, position,
        block_id: `c5300000-0000-4000-8000-00000000000${position + 1}`,
        block_type: 'single', block_preset: 'set', block_rounds: 1, rest_between_exercises_sec: 0,
        rest_between_rounds_sec: 90, rest_between_sets_sec: 120, trainer_comment: null,
      }))
      const sets = exercises.map((exercise, position) => ({
        id: `c5400000-0000-4000-8000-00000000000${position + 1}`, workout_exercise_id: exercise.id, position: 0,
        plan_weight_kg: position < 2 ? 50 : null, plan_reps: position < 2 ? 10 : null,
        fact_weight_kg: position < 2 ? 55 : null, fact_reps: position < 2 ? 9 : null,
        plan_duration_sec: position === 2 ? 180 : null, fact_duration_sec: position === 2 ? 160 : null,
        plan_distance_km: position === 2 ? 0.5 : null, fact_distance_km: position === 2 ? 0.5 : null,
        confirmed_at: '2026-08-10T10:00:00Z', version: 2,
      }))
      const original = JSON.stringify({ row, exercises, sets })
      let savedCopy: WorkoutDraft | undefined
      const submissions: WorkoutDraft[] = []
      await page.route('**/rest/v1/workouts?*', (route) => {
        const isCopy = new URL(route.request().url()).searchParams.get('id') === `eq.${copyId}`
        return route.fulfill({ json: isCopy && savedCopy
          ? { ...row, id: copyId, workout_date: savedCopy.workoutDate, status: 'planned', completed_at: null, version: 1 }
          : row })
      })
      await page.route('**/rest/v1/workout_exercises?*', (route) => {
        const isCopy = new URL(route.request().url()).searchParams.get('workout_id') === `eq.${copyId}`
        return route.fulfill({ json: isCopy && savedCopy
          ? exercises.map((exercise, i) => ({ ...exercise, exercise_name: savedCopy!.exercises[i]!.name }))
          : exercises })
      })
      await page.route('**/rest/v1/workout_sets?*', (route) => route.fulfill({ json: sets }))
      for (const rpc of ['list_workouts', 'list_latest_exercise_results', 'list_workout_personal_records', 'list_exercise_progress', 'list_workout_summaries']) {
        await page.route(`**/rest/v1/rpc/${rpc}`, (route) => route.fulfill({ json: [] }))
      }
      for (const rpc of ['save_workout', 'save_completed_workout', 'record_planned_workout_result']) {
        await page.route(`**/rest/v1/rpc/${rpc}`, (route) => {
          const { p_workout: draft } = route.request().postDataJSON() as { p_workout: WorkoutDraft }
          submissions.push(draft)
          if (!draft.id) savedCopy = draft
          return route.fulfill({ json: draft.id ?? copyId })
        })
      }
      await page.goto('/auth')
      await page.getByLabel('Email').fill(`${role}@fit.local`)
      await page.getByLabel('Пароль').fill('FitLocal123!')
      await page.getByRole('button', { name: 'Войти', exact: true }).click()
      await expect(page).toHaveURL(role === 'client' ? /\/me$/ : /\/today$/)
      await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible()
      const hints = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true })
      while (await hints.count()) await hints.first().click()
      for (const dark of [false, true]) {
        await page.goto(role === 'client' ? '/me/profile' : '/profile')
        await page.getByRole('switch', { name: 'Тёмная тема' }).setChecked(dark)
        await page.goto(`/workouts/${sourceId}`)
        await expect(page.getByText(oldName, { exact: true })).toHaveCount(2)
        while (await hints.count()) await hints.first().click()
        await page.getByText(oldName, { exact: true }).first().scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath(`original-${dark ? 'dark' : 'light'}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
        await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click()
        await expect(page.getByText(newName, { exact: true })).toBeVisible()
        await expect(page.getByText(oldName, { exact: true })).toBeVisible()
        await expect(page.getByText('Бег — восстановление', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.getByText(newName, { exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath(`copy-${dark ? 'dark' : 'light'}.png`), fullPage: true })
        await page.locator('.planned-exercise').first().screenshot({ path: testInfo.outputPath(`system-name-${dark ? 'dark' : 'light'}.png`) })
        await page.locator('.planned-exercise').nth(1).screenshot({ path: testInfo.outputPath(`custom-name-${dark ? 'dark' : 'light'}.png`) })
        // A saved copy draft must not leak the refreshed label into editing the original.
        await page.goto(`/workouts/${sourceId}/edit`)
        await expect(page.getByText(oldName, { exact: true })).toHaveCount(2)
        await expect(page.getByText(newName, { exact: true })).toHaveCount(0)
        await page.goto(`/workouts/new?copy=${sourceId}`)
        await expect(page.getByText(newName, { exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
      await expect(page).toHaveURL(`/workouts/${copyId}`)
      await expect(page.getByText(newName, { exact: true })).toBeVisible()
      expect(submissions).toHaveLength(1)
      expect(savedCopy?.id).toBeUndefined()
      expect(savedCopy?.exercises.map((exercise) => exercise.name)).toEqual([newName, oldName, 'Бег — восстановление'])
      expect(savedCopy?.exercises.map((exercise) => exercise.ref)).toEqual(exercises.map((exercise) => exercise.exercise_ref))
      expect(savedCopy?.exercises[0]?.sets[0]).toMatchObject({ weightKg: 55, reps: 9 })
      await page.goto(`/workouts/${sourceId}`)
      await expect(page.getByText(oldName, { exact: true })).toHaveCount(2)
      await expect(page.getByText(newName, { exact: true })).toHaveCount(0)
      expect(JSON.stringify({ row, exercises, sets })).toBe(original)
    })
  }
}
