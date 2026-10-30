import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

export function workoutTitleCases() {
  test('title rename changes metadata and the athlete reads the same title without author controls', async ({ page }, info) => {
    const coach = '69200000-0000-4000-8000-000000000001'
    const athlete = '69200000-0000-4000-8000-000000000002'
    const source = { ...restTimerWorkout(), title: 'Ноги', status: 'done' as const, createdBy: coach, completedAt: '2026-10-29T10:00:00Z' }
    const original = structuredClone(source)
    const backend = await mockPilot(page, { profileId: coach, fitLime: true, workouts: [source] })
    const writes: unknown[] = []
    await page.route(`**/v1/workouts/${workoutId}/title`, async route => {
      const body = route.request().postDataJSON() as { title: string; expectedVersion: number }
      writes.push(body)
      const current = backend.getWorkouts()[0]!
      expect(body.expectedVersion).toBe(current.version)
      Object.assign(current, { title: body.title, version: current.version + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: current.version } } })
    })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(`${base}/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Переименовать тренировку', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Переименовать тренировку', exact: true })
    await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue('Ноги')
    await sheet.getByLabel('Название', { exact: true }).fill('Ноги и спина')
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByText('Ноги и спина', { exact: true })).toBeVisible()
    expect(writes).toEqual([{ title: 'Ноги и спина', expectedVersion: original.version }])
    expect(backend.getWorkouts()[0]!.exercises).toEqual(original.exercises)
    const renamed = structuredClone(backend.getWorkouts()[0]!)
    await mockPilot(page, { role: 'client', profileId: athlete, clientLime: true, workouts: [renamed] })
    await page.goto(`${base}/workouts/${workoutId}`)
    await expect(page.getByText('Ноги и спина', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Переименовать тренировку', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: info.outputPath('athlete-shared-title.png') })
  })
}
