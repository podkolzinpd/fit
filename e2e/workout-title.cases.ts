import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId, coachGestureWorkout, clientId } from './fit-lime-fixtures'

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
  for (const role of ['trainer', 'client'] as const) test(`named history remains compact for ${role}`, async ({ page }, info) => {
    const profileId = '69200000-0000-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-10-30T09:00:00Z'))
    const source = { ...coachGestureWorkout(false, 5), title: 'Спина и ноги — тренировка с длинным названием', createdBy: profileId, startedAt: '2026-10-29T09:00:00Z', status: 'done' as const, workoutDate: '2026-10-29', completedAt: '2026-10-29T10:00:00Z' }
    await mockPilot(page, { role, profileId, fitLime: true, clientLime: true, workouts: [source] })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(base + (role === 'trainer' ? `/clients/${clientId}/workouts?view=list` : '/me/workouts?tab=history&view=list'))
    if (role === 'trainer') await page.locator('.coachmark-bubble').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
    const card = page.locator('.workout-chronicle-card').first()
    await expect(card.getByRole('heading', { name: source.title, exact: true })).toBeVisible()
    await expect(card.locator('.workout-chronicle-brief')).toHaveText(source.exercises.slice(0, 3).map(exercise => exercise.name).join(' · ') + ' · ещё 2')
    const geometry = await card.evaluate(element => {
      const title = element.querySelector('h2')!, date = element.querySelector('time')!
      return { titleSize: parseFloat(getComputedStyle(title).fontSize), dateSize: parseFloat(getComputedStyle(date).fontSize), titleTop: title.getBoundingClientRect().top, dateTop: date.getBoundingClientRect().top }
    })
    expect(geometry.dateSize).toBeLessThan(geometry.titleSize)
    expect(geometry.dateTop).toBeGreaterThan(geometry.titleTop)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await card.screenshot({ path: info.outputPath(`${role}-named-card.png`) })
  })

}
