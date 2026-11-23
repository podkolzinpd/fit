import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

export function liveWorkoutTitleCases() {
  for (const role of ['trainer', 'client'] as const) {
    test(`Live title rename preserves running facts and clock for ${role}`, async ({ page }, info) => {
      const owner = role === 'trainer' ? 'c0ac0000-6010-4000-8000-000000000001' : 'c11e0000-6010-4000-8000-000000000001'
      const source = { ...restTimerWorkout(0, false, 'manual'), title: 'Ноги', createdBy: owner,
        startedAt: new Date(Date.now() - 120_000).toISOString(), pausedSeconds: 11 }
      source.exercises[0]!.sets[0]!.confirmedAt = new Date().toISOString()
      source.exercises[0]!.sets[0]!.fact = { weightKg: 27, reps: 9 }
      const original = structuredClone(source)
      const backend = await mockPilot(page, { role, profileId: owner, fitLime: role === 'trainer', clientLime: role === 'client', workouts: [source] })
      const writes: unknown[] = []
      await page.route(`**/v1/workouts/${workoutId}/title`, async route => {
        const body = route.request().postDataJSON() as { title: string; expectedVersion: number }
        writes.push(body)
        const current = backend.getWorkouts()[0]!
        expect(body.expectedVersion).toBe(current.version)
        Object.assign(current, { title: body.title, version: current.version + 1 })
        await route.fulfill({ json: { workout: { id: workoutId, version: current.version } } })
      })
      const base = test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`
      await page.goto(`${base}/workouts/${workoutId}/live`)
      const trigger = page.getByRole('button', { name: 'Переименовать тренировку', exact: true })
      await expect(trigger).toHaveText('Ноги')
      const progress = page.locator('.live-session-progress-copy')
      const beforeProgress = await progress.textContent()
      const clock = page.locator('.coach-v79-large-clock')
      await expect(clock).toHaveAttribute('aria-label', /01:/)
      await trigger.click()
      const sheet = page.getByRole('dialog', { name: 'Переименовать тренировку', exact: true })
      await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue('Ноги')
      await sheet.getByLabel('Название', { exact: true }).fill('Отменённое название')
      await sheet.getByRole('button', { name: 'Отмена', exact: true }).click()
      expect(writes).toEqual([])
      await expect(trigger).toBeFocused()
      await trigger.click()
      await sheet.getByLabel('Название', { exact: true }).fill('  МКЦ 2 день 2: ноги и спина  ')
      await page.screenshot({ path: info.outputPath('live-title-editor.png') })
      await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(sheet).toHaveCount(0)
      await expect(trigger).toHaveText('МКЦ 2 день 2: ноги и спина')
      await expect(page.getByRole('heading', { name: 'МКЦ 2 день 2: ноги и спина', exact: true })).toBeVisible()
      await expect(progress).toHaveText(beforeProgress!)
      await expect(clock).toHaveAttribute('aria-label', /01:/)
      const renamed = backend.getWorkouts()[0]!
      expect({ ...renamed, title: original.title, version: original.version }).toEqual(original)
      expect(writes).toEqual([{ title: 'МКЦ 2 день 2: ноги и спина', expectedVersion: original.version }])
      await page.screenshot({ path: info.outputPath('live-title-saved.png') })
      await page.reload()
      await expect(trigger).toHaveText('МКЦ 2 день 2: ноги и спина')
      await expect(progress).toHaveText(beforeProgress!)
    })
  }

  test('Live title conflict retains the draft and rereads the running version before retry', async ({ page }) => {
    const owner = 'c0ac0000-6010-4000-8000-000000000001'
    const source = { ...restTimerWorkout(0, false, 'manual'), title: 'Ноги', createdBy: owner }
    const original = structuredClone(source)
    const backend = await mockPilot(page, { profileId: owner, fitLime: true, workouts: [source] })
    const writes: Array<{ title: string; expectedVersion: number }> = []
    await page.route(`**/v1/workouts/${workoutId}/title`, async route => {
      const body = route.request().postDataJSON() as typeof writes[number]
      writes.push(body)
      const current = backend.getWorkouts()[0]!
      if (writes.length === 1) {
        Object.assign(current, { title: 'Другая версия', version: current.version + 1 })
        return route.fulfill({ status: 409, json: { error: 'conflict' } })
      }
      expect(body.expectedVersion).toBe(current.version)
      Object.assign(current, { title: body.title, version: current.version + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: current.version } } })
    })
    const base = test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`
    await page.goto(`${base}/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Переименовать тренировку', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Переименовать тренировку', exact: true })
    await sheet.getByLabel('Название', { exact: true }).fill('Моё название')
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
    await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue('Моё название')
    await sheet.getByRole('button', { name: 'Перечитать тренировку', exact: true }).click()
    await expect(sheet.getByRole('status')).toContainText('Другая версия')
    await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue('Моё название')
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(writes.map(write => write.expectedVersion)).toEqual([original.version, original.version + 1])
    expect(backend.getWorkouts()[0]!.exercises).toEqual(source.exercises)
  })

  test('athlete cannot rename a trainer-owned Live workout', async ({ page }) => {
    const source = { ...restTimerWorkout(), title: 'План тренера', createdBy: 'c0ac0000-6010-4000-8000-000000000001' }
    await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000001', clientLime: true, workouts: [source] })
    const base = test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`
    await page.goto(`${base}/workouts/${workoutId}/live`)
    await expect(page.getByRole('heading', { name: 'План тренера', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Переименовать тренировку', exact: true })).toHaveCount(0)
  })
}
