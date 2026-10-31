import { expect, test } from '@playwright/test'
import { beginClientGesture, mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

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
      Object.assign(backend.getWorkouts()[0]!, { workoutDate: command.workoutDate, startTime: command.startTime, endTime: command.endTime, version: command.expectedVersion + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: command.expectedVersion + 1 } } })
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
  test('coach swipes over appointments and holds any part of the whole card to confirm a move', async ({ page, browserName }, info) => {
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const target = { ...restTimerWorkout(), trainerId: profileId, createdBy: profileId, title: 'Переносимая тренировка', status: 'planned' as const,
      workoutDate: '2026-11-02', startTime: '10:00', endTime: '11:00', startedAt: null, trainingFormat: 'with_trainer' as const }
    const initialVersion = target.version
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [target] })
    const commands: Array<{ workoutDate: string; startTime: string; endTime: string; expectedVersion: number }> = []
    await page.route(`**/v1/workouts/${workoutId}/reschedule`, async route => {
      const command = route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      Object.assign(backend.getWorkouts()[0]!, { workoutDate: command.workoutDate, startTime: command.startTime, endTime: command.endTime, version: command.expectedVersion + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: command.expectedVersion + 1 } } })
    })
    await page.goto('/today?date=2026-11-02&week=2026-11-02')
    const card = page.locator(`[data-workout-id="${workoutId}"]`)
    await expect(card).toBeVisible()
    const viewport = page.locator('.schedule-v2-timeline')
    const startScroll = await viewport.evaluate(node => node.scrollTop)
    const swipe = await beginClientGesture(page, card, browserName, card.locator('b'))
    await swipe.move(100); await swipe.end()
    await expect(page).toHaveURL(/date=2026-11-03/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(startScroll, -1)
    const background = viewport.locator('.day-grid-hour-line').nth(10)
    const reverse = await beginClientGesture(page, viewport, browserName, background)
    await reverse.move(-100); await reverse.end()
    await expect(page).toHaveURL(/date=2026-11-02/)
    await expect(card).toBeVisible()
    if (browserName === 'chromium') {
      const before = await viewport.evaluate(node => node.scrollTop)
      const vertical = await beginClientGesture(page, card, browserName)
      await vertical.move(0, -90); await vertical.end()
      await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(before + 20)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page).toHaveURL(/date=2026-11-02/)
    }
    const cancelled = await beginClientGesture(page, card, browserName)
    await page.waitForTimeout(460)
    await expect(card).toHaveClass(/is-slot-moving/)
    const viewBox = (await viewport.boundingBox())!, cardBox = (await card.boundingBox())!
    const beforeAutoScroll = await viewport.evaluate(node => node.scrollTop)
    await cancelled.move(0, viewBox.y + viewBox.height - 20 - (cardBox.y + cardBox.height / 2))
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(beforeAutoScroll + 8)
    await cancelled.end(true)
    await expect(card).not.toHaveClass(/is-slot-moving/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(commands).toHaveLength(0)
    for (const [index, origin] of [card.locator('.schedule-v2-avatar'), card.locator('b'), undefined].entries()) {
      await card.evaluate(node => node.scrollIntoView({ block: 'center' }))
      const hold = await beginClientGesture(page, card, browserName, origin)
      await page.waitForTimeout(460)
      await expect(card).toHaveClass(/is-slot-moving/)
      await hold.move(0, 56)
      await expect(card.locator('time')).toHaveText('11:00–12:00')
      if (index === 0) await page.screenshot({ path: info.outputPath('whole-card-hold.png') })
      await hold.end()
      const sheet = page.getByRole('dialog', { name: 'Дата и время', exact: true })
      await expect(sheet.getByLabel('Начало', { exact: true })).toHaveValue('11:00')
      await expect(sheet.getByLabel('Окончание', { exact: true })).toHaveValue('12:00')
      if (index < 2) {
        await sheet.getByRole('button', { name: 'Отмена', exact: true }).click()
        expect(commands).toHaveLength(0)
        expect(backend.getWorkouts()[0]!.startTime).toBe('10:00')
      } else await sheet.getByRole('button', { name: 'Перенести', exact: true }).click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ startTime: '11:00', endTime: '12:00', expectedVersion: initialVersion })
    await expect(card).toBeVisible()
    expect(backend.getWorkouts()).toHaveLength(1)
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  for (const [theme, density, width, fitLime] of [
    ['light', 'comfortable', 390, true], ['dark', 'comfortable', 430, true], ['light', 'compact', 430, true], ['dark', 'compact', 390, true],
    ['light', 'comfortable', 390, false], ['dark', 'comfortable', 430, false],
  ] as const) test(`coach slot geometry ${fitLime ? 'lime' : 'base'} ${theme} ${density} ${width}`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(theme => localStorage.setItem('fit.appTheme', theme), theme)
    const profileId = 'c0ac0000-6010-4000-8000-000000000001'
    const target = { ...restTimerWorkout(), trainerId: profileId, createdBy: profileId, title: 'Тренировка с длинным названием', status: 'planned' as const,
      workoutDate: '2026-11-02', startTime: '10:00', endTime: '11:00', startedAt: null, trainingFormat: 'with_trainer' as const }
    await mockPilot(page, { profileId, fitLime, scheduleDensity: density, workouts: [target] })
    if (density === 'compact') {
      await page.goto('/today?date=2026-11-02&week=2026-11-02')
      const card = page.locator(`[data-workout-id="${workoutId}"]`)
      await expect(card).toBeVisible()
      await card.evaluate(node => node.scrollIntoView({ block: 'center' }))
      const hold = await beginClientGesture(page, card, browserName)
      await page.waitForTimeout(460)
      await expect(card).toHaveClass(/is-slot-moving/)
      await hold.move(0, 44); await hold.end()
    } else {
      await page.goto(`/workouts/${workoutId}`)
      await page.getByRole('button', { name: 'Изменить дату и время тренировки' }).click()
    }
    const sheet = page.getByRole('dialog', { name: 'Дата и время', exact: true })
    await expect(sheet).toBeVisible()
    expect(await page.locator('html').evaluate(node => node.classList.contains('theme-light'))).toBe(!fitLime && theme === 'light')
    await expect(sheet.getByLabel('Начало', { exact: true })).toHaveValue(density === 'compact' ? '11:00' : '10:00')
    await page.evaluate(() => document.fonts.ready)
    expect(await sheet.evaluate(node => {
      const box = node.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const button of await sheet.getByRole('button').all()) {
      const box = await button.boundingBox()
      if (box) expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: info.outputPath(`slot-${theme}-${density}-${width}.png`) })
    await sheet.getByRole('button', { name: 'Отмена', exact: true }).click()
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
