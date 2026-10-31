import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

export function workoutRescheduleCases() {
  test.skip(process.env.FIT_YANDEX_E2E_REQUIRED !== 'true', 'Uses the mandatory native appointment lane')
  test('coach reschedules the same appointment from its header with overlap and network retry', async ({ page }, info) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const target = { ...restTimerWorkout(), trainerId: profileId, createdBy: profileId, title: 'Силовая тренировка', status: 'planned' as const,
      workoutDate: '2026-11-02', startTime: '10:00', endTime: '11:00', startedAt: null, trainingFormat: 'with_trainer' as const }
    const other = { ...target, id: '12345678-1234-4234-8234-123456789012', clientName: 'Другой спортсмен', title: 'Другой план', startTime: '12:00', endTime: '13:00' }
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [target, other] })
    const original = JSON.stringify(target.exercises)
    const commands: Array<{ workoutDate: string; startTime: string; endTime: string; operationId: string; expectedVersion: number }> = []
    await page.route(`**/v1/workouts/${workoutId}/reschedule`, async route => {
      commands.push(route.request().postDataJSON() as typeof commands[number])
      if (commands.length === 1) { await route.abort('failed'); return }
      const command = commands.at(-1)!
      Object.assign(backend.getWorkouts()[0]!, { workoutDate: command.workoutDate, startTime: command.startTime, endTime: command.endTime, version: target.version + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: target.version + 1 } } })
    })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Изменить дату и время тренировки' }).click()
    const sheet = page.getByRole('dialog', { name: 'Дата и время', exact: true })
    await sheet.getByLabel('Начало', { exact: true }).fill('11:30')
    await sheet.getByLabel('Начало', { exact: true }).blur()
    await expect(sheet.getByLabel('Окончание', { exact: true })).toHaveValue('12:30')
    await expect(sheet.getByText('На это время уже есть тренировка', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('slot-overlap.png') })
    await sheet.getByRole('button', { name: 'Перенести всё равно' }).click()
    await expect(sheet.getByRole('alert')).toContainText('Не удалось перенести')
    await expect(sheet.getByLabel('Начало', { exact: true })).toHaveValue('11:30')
    await sheet.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/today\?date=2026-11-02/)
    expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0])
    expect(backend.getWorkouts()).toHaveLength(2)
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(original)
    await expect(page.locator('.schedule-v2-event').filter({ hasText: 'Силовая тренировка' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
  test('coach preserves an overnight interval and warns about the following local day', async ({ page }) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const target = { ...restTimerWorkout(), trainerId: profileId, createdBy: profileId, title: 'Вечерняя тренировка', status: 'planned' as const,
      workoutDate: '2026-11-02', startTime: '20:00', endTime: '22:00', startedAt: null, trainingFormat: 'with_trainer' as const }
    const next = { ...target, id: '12345678-1234-4234-8234-123456789012', title: 'Следующий день', workoutDate: '2026-11-03', startTime: '00:30', endTime: '01:30' }
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [target, next] })
    const commands: unknown[] = []
    await page.route(`**/v1/workouts/${workoutId}/reschedule`, async route => {
      const command = route.request().postDataJSON() as { workoutDate: string; startTime: string; endTime: string; expectedVersion: number }
      commands.push(command)
      Object.assign(backend.getWorkouts()[0]!, { ...command, version: command.expectedVersion + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: command.expectedVersion + 1 } } })
    })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Изменить дату и время тренировки' }).click()
    const sheet = page.getByRole('dialog', { name: 'Дата и время', exact: true })
    await sheet.getByLabel('Начало', { exact: true }).fill('')
    await sheet.getByLabel('Начало', { exact: true }).fill('23:00')
    await expect(sheet.getByLabel('Окончание', { exact: true })).toHaveValue('01:00')
    await expect(sheet.getByText('Длительность — 120 минут', { exact: true })).toBeVisible()
    await expect(sheet.getByText('На это время уже есть тренировка', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Перенести всё равно' }).click()
    await expect(sheet).toHaveCount(0)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ workoutDate: '2026-11-02', startTime: '23:00', endTime: '01:00' })
    expect(backend.getWorkouts()).toHaveLength(2)
  })

}
