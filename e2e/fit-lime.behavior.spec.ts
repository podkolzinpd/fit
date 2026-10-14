import { expect, test } from '@playwright/test'
import { trainerId, clientId, workoutId, conversationId, newWorkoutId, coachGestureWorkout, restTimerWorkout, workout, type MockWorkout, mockPilot, scheduleVisibilityRows, limeClients, beginClientGesture, openSwipeFixture, mockClientStreamingVoice, publicTrainerId, mockPublicTrainer } from './fit-lime-fixtures'

// Behavior-only acceptance. Visual/mixed state matrices live in the visual spec.
test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

test('Figma workout Coach reference full editor is absent for non-pilot trainer', { tag: ["@lime-critical"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true, workouts: [] })
  await page.goto(`/workouts/new?client=${clientId}&date=2026-09-24`)
  await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toBeVisible()
  await expect(page.locator('.coach-reference-form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
  await expect(page.getByLabel('Запись тренировки')).toBeVisible()
})

test('Figma workout Coach reference second trainer starts immediately after client choice', async ({ page }) => {
  await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000002', fitLime: true, workouts: [] })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
  await expect(picker).toHaveClass(/coach-reference-sheet/)
  await expect(picker.getByRole('button', { name: 'Применить клиента' })).toHaveCount(0)
  await picker.getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page).toHaveURL(/\/live$/)
  await expect(page.locator('.quick-start-format')).toHaveCount(0)
})

test('Figma workout Coach reference planning retains advanced draft during editor handoff', async ({ page }) => {
  const profileId = 'c0ac0000-6010-4000-8000-000000000002'
  await mockPilot(page, { profileId, fitLime: true, workouts: [] })
  const key = `fit.workout-form-draft.${profileId}.new--2026-09-24--quick`
  await page.addInitScript(({ key, clientId }) => localStorage.setItem(key, JSON.stringify({ clientId, title: 'Сохранённый план', workoutDate: '2026-09-24', startTime: '12:30', endTime: '14:00', notes: 'Сохранить заметку', stageId: '', recordCompleted: false, trainingFormat: 'self', prepSeconds: 15, exercises: [] })), { key, clientId })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await page.getByRole('textbox', { name: 'Название тренировки' }).fill('Сохранённый план с правкой')
  await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?date=2026-09-24&entry=quick/)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as unknown, key)).toMatchObject({ title: 'Сохранённый план с правкой', prepSeconds: 15, notes: 'Сохранить заметку', trainingFormat: 'self', startTime: '12:30', endTime: '14:00' })
})

test('Figma workout Coach reference grouped drag retry has one unchanged receipt', async ({ page }) => {
  const source = coachGestureWorkout(true), first = source.exercises[0]!
  await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000002', fitLime: true, workouts: [source] })
  const commands: unknown[] = []
  await page.route('**/blocks/*/move', async (route) => {
    commands.push(route.request().postDataJSON() as unknown)
    if (commands.length === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service_unavailable"}' })
    else await route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const handle = page.getByRole('button', { name: 'Переместить: Приседания, Жим' })
  await handle.focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Повторить сохранение порядка' })).toBeVisible()
  await expect(page.locator('[data-workout-block]').first()).toHaveAttribute('data-workout-block', first.blockId)
  await page.getByRole('button', { name: 'Повторить сохранение порядка' }).click()
  await expect(page.locator('[data-workout-block]').last()).toHaveAttribute('data-workout-block', first.blockId)
  expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0])
  await expect(page.locator(`[data-workout-block="${first.blockId}"] .live-exercise-head`).filter({ hasText: 'Приседания' }).first()).toBeVisible()
  await expect(page.locator(`[data-workout-block="${first.blockId}"] .live-exercise-head`).filter({ hasText: 'Жим' }).first()).toBeVisible()
})

test('Figma workout Coach reference actions completion retains cardio warning', async ({ page }) => {
  const source = restTimerWorkout(), exercise = source.exercises[0]!
  exercise.inputKind = 'distance'; exercise.ref = 'running'; exercise.muscleGroup = 'cardio'; exercise.name = 'Бег'
  exercise.sets = [ { ...exercise.sets[0]!, confirmedAt: '2026-10-08T09:01:00Z', fact: { distanceKm: 1 }, distanceKm: 1 } ]
  await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000002', fitLime: true, workouts: [source] })
  let finishes = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/finish')) finishes++ })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toContainText('нет фактического времени')
  await page.getByRole('button', { name: 'Внести время', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toHaveCount(0)
  await expect(page.locator('.live-set.editing')).toBeVisible()
  expect(finishes).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить без оценки', exact: true }).click()
  await expect(page).not.toHaveURL(/\/live$/)
  expect(finishes).toBe(1)
})

for (const [role, profileId, expected] of [
  ['trainer', 'c0ac0000-6010-4000-8000-000000000002', true],
  ['trainer', trainerId, false],
  ['client', 'c0ac0000-6010-4000-8000-000000000001', false],
] as const) {
  test(`Figma workout Coach reference direct route boundary ${role} ${profileId}`, { tag: ["@lime-critical"] }, async ({ page }) => {
    await mockPilot(page, { role, profileId, fitLime: true, workouts: [restTimerWorkout()] })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.live-rest-trigger')).toBeVisible()
    await expect(page.locator('.coach-live-digits')).toHaveCount(expected ? 1 : 0)
    await expect(page.locator('.coach-workout-reference')).toHaveCount(expected ? 1 : 0)
  })
}

test('Live rest legacy negative countdown without preparation', async ({ page }) => {
  // Keep Date fixed across reload while letting loading/render timers run.
  await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых')
  await page.clock.setFixedTime(new Date('2026-10-08T09:00:04Z'))
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await page.reload()
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await page.locator('.live-rest-trigger').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('Live rest starts before the first confirmation response and is not restarted by acknowledgement', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  const source = restTimerWorkout(); source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
  let release = () => {}
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/workout-sets/*/confirm', async (route) => { await responseGate; await route.fallback() })
  try {
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:30')
    await page.clock.fastForward(5_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
    release()
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
  } finally { release() }
})

test('Live rest preparation disabled keeps timed sets manual', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(0, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await page.clock.fastForward(4_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('−0:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

test('Live rest preparation enabled preserves the automatic phase sequence', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(10, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подготовка 0:10')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 0:02')
  await page.clock.fastForward(2_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
})

test('Live rest failure and retry preserve the countdown and a manual adjustment', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  const source = restTimerWorkout(); source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source], failFirstSetConfirm: true })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  const retry = page.getByRole('button', { name: 'Готово, отдых', exact: true }).filter({ hasText: 'Повтор' })
  await expect(retry).toBeVisible()
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:25')
  await page.locator('.live-rest-trigger').click()
  await page.getByRole('button', { name: 'Плюс 15 секунд', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:40')
  await retry.click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger')).toContainText('Отдых 1:40')
})

test('Live rest phase expiry waits for a pending confirmation without timing the same set twice', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [restTimerWorkout(10, true)] })
  let release = () => {}, confirmations = 0
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/workout-sets/*/confirm', async (route) => {
    confirmations += 1
    await responseGate
    await route.fallback()
  })
  try {
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator('.live-rest-trigger')).toContainText('Подготовка')
    await page.clock.fastForward(10_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Подход')
    await page.clock.fastForward(3_000)
    await expect(page.locator('.live-rest-trigger')).toContainText('Отдых')
    await expect.poll(() => confirmations).toBe(1)
    await page.clock.fastForward(5_000)
    expect(confirmations).toBe(1)
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
    release()
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
    await expect(page.locator('.live-rest-trigger')).toContainText('Подход 0:03')
    await page.clock.fastForward(3_000)
    await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
    expect(confirmations).toBe(2)
  } finally { release() }
})

test('Live rest invalid empty result does not start the timer', async ({ page }) => {
  const source = restTimerWorkout()
  source.exercises[0]!.sets = source.exercises[0]!.sets.map((set) => ({ ...set, weightKg: undefined, reps: undefined }))
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.getByText('Введите результат подхода', { exact: true })).toBeVisible()
  await expect(page.locator('.live-rest-trigger')).toHaveText('Таймер')
})

for (const role of ['client', 'trainer'] as const) test(`Workout actual duration quick entry and draft ${role}`, { tag: ["@lime-duration"] }, async ({ page }) => {
  const profileId = role === 'client' ? '10000000-0000-4000-8000-000000000099' : trainerId
  await mockPilot(page, { role, profileId, pilot: false })
  await page.addInitScript(({ profileId, clientId }) => { if (!localStorage.getItem(`fit.today-draft.${profileId}`)) localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
    screen: 'save', text: 'Приседания 3 по 8', choices: {},
    items: [{ line: 'Приседания 3 по 8', exercise: { source: 'system', ref: 'squat', name: 'Приседания', muscleGroup: 'legs', inputKind: 'reps' }, sets: [{ position: 0, reps: 8 }], hasValues: true }],
    clientId, recordMode: 'completed', workoutDate: '2026-09-24', startTime: '',
  })) }, { profileId, clientId })
  const path = role === 'client' ? '/me?view=save' : '/today?view=save'
  await page.goto(path)
  const input = page.getByRole('textbox', { name: 'Длительность тренировки, мин' })
  await expect(input).toHaveValue('')
  await input.fill('50,5')
  await expect.poll(async () => page.evaluate((id) =>
    (JSON.parse(localStorage.getItem(`fit.today-draft.${id}`) ?? '{}') as { actualDurationMinutes?: string }).actualDurationMinutes,
  profileId)).toBe('50,5')
  await page.reload()
  await expect(input).toHaveValue('50,5')
  const saved = page.waitForRequest((request) => new URL(request.url()).pathname === '/v1/workouts/completed')
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  const request = await saved
  expect((request.postDataJSON() as { actualDurationSec: number }).actualDurationSec).toBe(3030)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}$`))
  await expect(page.locator('.workout-actual-duration')).toContainText('51 мин')
})

test('Workout actual duration keeps draft through network error and conflict without blind overwrite', { tag: ["@lime-duration"] }, async ({ page }) => {
  const current: MockWorkout = { ...workout, status: 'done', completedAt: '2026-09-24T12:00:00Z', actualDurationSec: null }
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [current] })
  let attempts = 0
  await page.route(`**/v1/workouts/${workoutId}/duration`, async (route) => {
    attempts += 1
    if (attempts === 1) return route.abort('connectionrefused')
    if (attempts === 2) {
      current.actualDurationSec = 2700
      current.version = 2
      return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' })
    }
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Указать длительность' }).click()
  const dialog = page.getByRole('dialog', { name: 'Длительность тренировки', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Длительность тренировки, мин' })
  await expect(input).toHaveValue('')
  await input.fill('50')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(/повторите/i)
  await expect(input).toHaveValue('50')
  expect(attempts).toBe(1)
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('45 мин')
  await expect(input).toHaveValue('50')
  expect(attempts).toBe(2)
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.workout-actual-duration')).toContainText('50 мин')
  expect(attempts).toBe(3)
})

test('Achievement collection restores earned badges after signing in again', async ({ page }) => {
  const history = [{ ...workout, status: 'done', completedAt: '2026-09-23T12:00:00Z' }]
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: history })
  await page.goto('/me/achievements')
  const first = page.getByRole('button', { name: /^Первый шаг\./ })
  await expect(first.locator('.athlete-achievement-badge')).toHaveClass(/is-earned/)
  await page.goto('/me/settings')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/auth/)
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: history })
  await page.goto('/me/achievements')
  await expect(first.locator('.athlete-achievement-badge')).toHaveClass(/is-earned/)
})

test('Lime schedule ownership empty retry preference and account isolation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00+03:00'))
  const backend = await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows().slice(1, 4), failTrainingData: true })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(0)
  await expect(page.locator('.schedule-v2-period-summary')).toHaveText('0 тренировок · 0 клиентов')
  const toggle = page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })
  await toggle.check()
  await page.reload()
  await expect(toggle).toBeChecked()
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(2)
  await mockPilot(page, { profileId: '10000000-0000-4000-8000-000000000010', fitLime: true, workouts: [] })
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows() })
  await page.reload()
  await expect(toggle).toBeChecked()
  await page.goto('/today?date=2026-09-24')
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('region', { name: 'Самостоятельные тренировки' }).locator('a')).toHaveCount(2)
})

test('Lime schedule ownership storage failure is visible and retry keeps selection', async ({ page }) => {
  await mockPilot(page, { fitLime: true, workouts: scheduleVisibilityRows() })
  await page.goto('/schedule?week=2026-09-21')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem.bind(window.localStorage)
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('fit.lime-schedule-independent.')) throw new Error('storage denied')
      original(key, value)
    }
  })
  const toggle = page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })
  await toggle.check()
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('alert')).toContainText('не удалось сохранить настройку')
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(4)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Lime schedule ownership preserves non-Lime calendar and athlete history', async ({ page }) => {
  const rows = scheduleVisibilityRows()
  await mockPilot(page, { workouts: rows })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })).toHaveCount(0)
  await expect(page.locator('.schedule-v2-day-events > span')).toHaveCount(5)
  await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true, workouts: rows })
  await page.goto('/me/workouts')
  await page.getByRole('tab', { name: 'История' }).click()
  await expect(page.locator('a[href="/workouts/10000000-0000-4000-8000-000000000008"]')).toBeVisible()
  await page.getByRole('button', { name: 'Календарь', exact: true }).click()
  await expect(page.getByRole('button', { name: /24 сентября/ }).first()).toBeVisible()
})

for (const fitLime of [true, false]) {
  test(`calorie basis stays readable and pilot scoped: ${fitLime}`, async ({ page }) => {
    await mockPilot(page, { fitLime, workouts: [{ ...workout, status: 'done', activeCaloriesKcal: 220, calorieEstimateBasis: 'Оценка по времени и фактической нагрузке' }] })
    await page.goto(`/workouts/${workoutId}`)
    await expect(page.getByRole('region', { name: 'Сводка тренировки' })).toContainText('220 ккал')
    await expect(page.locator('.workout-calorie-explanation')).toHaveCount(fitLime ? 1 : 0)
    if (!fitLime) await expect(page.getByRole('region', { name: 'Сводка тренировки' })).toContainText('Оценка по времени и фактической нагрузке')
  })
}

test('Lime direct start opens Live immediately after choosing the client', async ({ page }) => {
  await mockPilot(page, { fitLime: true, workouts: [] })
  const commands: unknown[] = []
  page.on('request', (request) => { if (request.url().endsWith('/workouts/quick-start')) commands.push(request.postDataJSON() as unknown) })
  await page.goto('/today?date=2026-12-31')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}/live$`))
  await expect(page.locator('.live-workout-page')).toBeVisible()
  expect(commands).toHaveLength(1)
  expect(commands[0]).toMatchObject({ clientId, trainingFormat: 'with_trainer' })
})

test('Lime keeps unparsed plan text when returning before choosing a client', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByRole('textbox', { name: 'Тренировка', exact: true }).fill('Планка три раза по минуте')
  await page.getByRole('button', { name: '← В календарь' }).click()
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик' }).click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByRole('textbox', { name: 'Тренировка', exact: true })).toHaveValue('Планка три раза по минуте')
})

test('Lime plan rejects an end time without start before any save command', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await page.getByRole('button', { name: 'Выбрать дату и время' }).click()
  await page.getByLabel('Окончание', { exact: true }).fill('15:00')
  await page.getByRole('button', { name: 'Применить дату' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('alert')).toContainText('Укажите начало тренировки')
  expect(backend.getSaveAttempts()).toBe(0)
  await page.getByRole('button', { name: 'Выбрать дату и время' }).click()
  await page.getByLabel('Начало', { exact: true }).fill('14:00')
  await page.getByRole('button', { name: 'Применить дату' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('dialog', { name: 'Быстрое создание тренировки' })).toHaveCount(0)
  expect(backend.getSaveAttempts()).toBe(1)
})

test('Lime start now retries one command without using the selected future date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  const commands: unknown[] = []
  await page.route('**/v1/workouts/quick-start', async (route) => {
    commands.push(route.request().postDataJSON() as unknown)
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
  })
  await page.goto('/today?date=2026-12-31')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас' }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Запланировать', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Не удалось начать тренировку')
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(() => commands.length).toBe(2)
  expect(commands[1]).toEqual(commands[0])
  expect(commands[0]).toMatchObject({ clientId, trainingFormat: 'with_trainer', operationId: expect.any(String) })
  expect(commands[0]).not.toHaveProperty('workoutDate')
  await page.getByRole('button', { name: 'Закрыть выбор действия' }).click()
  await expect(page).toHaveURL(/date=2026-12-31/)
})

test('Figma workout second pilot keeps quick-plan guidance and separate completed entry', async ({ page }) => {
  const profileId = '10000000-0000-4000-8000-000000000010'
  await mockPilot(page, { profileId, fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.evaluate((id) => {
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify(seen.filter((item) => item !== 'lime-quick-plan-2026-10')))
  }, profileId)
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const guidance = page.getByRole('status').filter({ hasText: 'План можно сохранить сразу' })
  await expect(guidance).toBeVisible()
  await guidance.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('textbox', { name: 'Название тренировки' }).fill('Силовая')
  await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Силовая')
  await page.goto('/workouts/new?date=2026-09-24')
  await page.getByRole('button', { name: 'Завершённая', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Записать тренировку', exact: true })).toBeDisabled()
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} server-assigned trainer keeps calendar, actions and inbox after direct navigation`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
    await expect(page.getByRole('dialog', { name: 'Входящие' }).getByRole('heading', { name: 'Сообщения' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть входящие' }).click()
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.getByRole('button', { name: 'Четверг, 24 сентября' })).toBeVisible()
    await page.reload()
    await expect(page.locator('.schedule-v2-card-grid')).toBeVisible()
  })
}

test('workout and assistant routes keep the previous presentation outside Fit Lime', async ({ page }) => {
  await mockPilot(page, { fitLime: false })
  for (const route of ['/workouts/new?date=2026-09-24', '/today?view=compose&entry=text', `/workouts/${workoutId}`, `/workouts/${workoutId}/live`, '/assistant']) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
  }
})

test('trainer without Fit Lime keeps the existing day hierarchy', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.fit-lime-today')).toHaveCount(0)
  await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-home-actions/)
})

test('trainer without Fit Lime keeps the existing week styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.schedule-v2-weekstrip')).toBeVisible()
  await expect(page.locator('.fit-lime-schedule')).toHaveCount(0)
})

test('non-pilot trainer retains the classic Today and schedule routes', async ({ page }) => {
  await mockPilot(page, { pilot: false, workouts: [] })
  await page.goto('/today')
  await expect(page.locator('.today-page')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.goto('/schedule')
  await expect(page.locator('.schedule-page:not(.schedule-v2)')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('inbox messages fail independently and all-messages back returns to the selected day', { tag: ["@lime-chat"] }, async ({ page }) => {
  const backend = await mockPilot(page, { failThreads: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить сообщения')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку сообщений' }).click()
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await inbox.getByRole('link', { name: 'Открыть все сообщения' }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('inbox questions fail independently and recover without hiding messages', { tag: ["@lime-chat"] }, async ({ page }) => {
  const backend = await mockPilot(page, { failWorkspace: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить вопросы')).toBeVisible({ timeout: 15_000 })
  backend.setWorkspaceFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку вопросов' }).click()
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await inbox.getByText('Можно заменить приседания?').click()
  await expect(page).toHaveURL(/\/workouts\/10000000-0000-4000-8000-000000000003\?reply=1$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('replying to a trainer question updates the inbox count on return', { tag: ["@lime-chat"] }, async ({ page }) => {
  await mockPilot(page, { questionWorkout: true })
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Можно заменить приседания?')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Можно заменить приседания?').click()
  await expect(page.getByRole('textbox', { name: 'Ответ клиенту' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Ответ клиенту' }).fill('Да, можно заменить.')
  await page.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(page.getByText('Вопрос закрыт')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '4 Вопросы и сообщения' })).toBeVisible()
})

test('reading a chat message updates the inbox count on return', { tag: ["@lime-chat"] }, async ({ page }) => {
  const readRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/read')) readRequests.push(request.url()) })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Спасибо!').click()
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect.poll(() => readRequests).toHaveLength(1)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '1 Вопросы и сообщения' })).toBeVisible()
})

test('compact trainer home failure is not presented as no workouts and retry restores old active', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { workouts: [{ ...workout, status: 'in_progress', workoutDate: '2025-01-01' }] })
  let fail = true
  await page.route('**/v1/workouts/home?*', async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    else await route.fallback()
  })
  await page.goto('/today')
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить действия' })).toBeVisible()
  fail = false
  await queue.getByRole('button', { name: 'Повторить загрузку действий' }).click()
  await expect(page.getByRole('region', { name: 'Активные тренировки' }).getByRole('link')).toHaveAttribute('href', `/workouts/${workoutId}/live`)
})

test('today keeps creation available when the trainer has no clients or workouts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { hasClients: false, workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toHaveAttribute('href', '/clients/new')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toHaveCount(0)
  await expect(page.getByText('Свободный день')).toBeVisible()
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '0 Незавершённые действия' }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Незавершённых действий нет')).toBeVisible()
})

test('calendar error leaves inbox and action tiles reachable, then retries in place', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { failTrainingData: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: /Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /Незавершённые действия/ })).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить данные' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('action queue shows source failure and recovers on retry', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { workouts: [], failClients: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '— Незавершённые действия' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить действия' })).toBeVisible()
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить планы' })).toBeVisible()
  backend.setClientsFailure(false)
  await queue.getByRole('button', { name: 'Повторить загрузку действий' }).click()
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime action queue preserves the selected day in workout navigation`, async ({ page }) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Незавершённые действия/ }).click()
    await expect(page.locator('.fit-lime-action-backdrop')).toBeVisible()
    const action = page.getByRole('dialog', { name: 'Рабочая очередь' }).locator('.schedule-v2-action-row[href]')
    await expect(action).toHaveAttribute('href', `/workouts/${workoutId}?reply=1`)
    await action.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}\\?reply=1$`))
    expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime planning action returns to its calendar date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  await page.getByRole('dialog', { name: 'Рабочая очередь' }).getByRole('link', { name: 'Запланировать' }).click()
  expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-27')
})

test('trainer without Fit Lime keeps the queue outside the pilot portal scope', async ({ page }) => {
  await mockPilot(page, { workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.locator('.fit-lime-action-backdrop')).toHaveCount(0)
})

test('Fit Lime questions remain visible when dialogs fail, and dialogs recover independently', { tag: ["@lime-chat"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, questionWorkout: true, failThreads: true })
  await page.goto('/chat')
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('Fit Lime dialog remains visible when questions fail', { tag: ["@lime-chat"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true, failWorkspace: true })
  await page.goto('/chat')
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить вопросы' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('trainer without Fit Lime keeps the existing messages list', { tag: ["@lime-chat"] }, async ({ page }) => {
  await mockPilot(page)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 1 })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime conversation retries a failed send without duplicating the message', { tag: ["@lime-chat","@lime-critical"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstChatSend: true })
  await page.goto(`/chat/${conversationId}`)
  await page.getByRole('textbox', { name: 'Сообщение' }).fill('Проверю и отвечу')
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Ошибка')).toBeVisible()
  await page.locator('.chat-message.own').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Проверю и отвечу')).toBeVisible()
  await expect(page.locator('.chat-message.own').getByText('Отправлено')).toBeVisible()
  await expect(page.locator('.chat-message.own')).toHaveCount(1)
  expect(backend.getChatSendAttempts()).toBe(2)
})

test('trainer without Fit Lime keeps the existing conversation styling', { tag: ["@lime-chat"] }, async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/chat/${conversationId}`)
  await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const fitLime of [false, true]) test(`Client full swipe keeps short reversed vertical and cancelled gestures harmless ${fitLime ? 'Lime' : 'ordinary'}`, { tag: ["@lime-clients"] }, async ({ page, browserName }) => {
  const row = await openSwipeFixture(page, fitLime)
  const commands: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/archive') && request.method() === 'PUT') commands.push(request.url()) })
  const surface = row.locator('.client-swipe-surface')
  const vertical = await beginClientGesture(page, surface, browserName)
  const before = await page.locator('.content').evaluate((element) => element.scrollTop)
  await vertical.move(3, -100)
  await vertical.end()
  await expect(row).not.toHaveClass(/is-open/)
  if (browserName === 'chromium') await expect.poll(() => page.locator('.content').evaluate((element) => element.scrollTop)).toBeGreaterThan(before)
  const short = await beginClientGesture(page, surface, browserName)
  await short.move(96)
  await short.end()
  await expect(row.getByRole('button', { name: 'В архив' })).toBeVisible()
  const other = page.locator('[data-client-swipe-id="10000000-0000-4000-8000-000000000021"]')
  const next = await beginClientGesture(page, other.locator('.client-swipe-surface'), browserName)
  await next.move(96)
  await expect(row).not.toHaveClass(/is-open/)
  await next.end()
  await expect(other).toHaveClass(/is-open/)
  const back = await beginClientGesture(page, surface, browserName)
  await back.move(96)
  await expect(other).not.toHaveClass(/is-open/)
  await back.end()
  await row.getByRole('link', { name: /Алексей Смирнов/ }).click()
  await expect(row).not.toHaveClass(/is-open/)
  await expect(page).toHaveURL(/\/clients$/)
  const reversed = await beginClientGesture(page, surface, browserName)
  await reversed.move(250)
  await expect(row).toHaveClass(/is-armed/)
  await reversed.move(10)
  await expect(row).not.toHaveClass(/is-armed/)
  await reversed.end()
  await expect(row).not.toHaveClass(/is-open/)
  const cancelled = await beginClientGesture(page, surface, browserName)
  await cancelled.move(250)
  await cancelled.end(true)
  await expect(row).not.toHaveClass(/is-open/)
  await expect(page).toHaveURL(/\/clients$/)
  expect(commands).toHaveLength(0)
})

test('Fit Lime client loading error retries without losing the clients route', { tag: ["@lime-clients"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failClients: true })
  await page.goto('/clients')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: /Алексей Смирнов/ })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
})

test('trainer without Fit Lime keeps the previous clients list and archive', { tag: ["@lime-clients"] }, async ({ page }) => {
  await mockPilot(page, { clientRecords: limeClients })
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.getByRole('link', { name: 'Архив' }).click()
  await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime client card isolates secondary data failures and retries', { tag: ["@lime-clients"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failTrainingData: true, failConnections: true })
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Запланировать тренировку/ })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить статистику тренировок' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить приглашения и права доступа' })).toBeVisible({ timeout: 15_000 })
  backend.setTrainingDataFailure(false)
  backend.setConnectionsFailure(false)
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить статистику тренировок' }).getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить приглашения и права доступа' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Архивировать клиента' })).toBeVisible()
})

test('trainer without Fit Lime keeps the existing client card', { tag: ["@lime-clients"] }, async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime trainer edit and join keep a route back to the client list', { tag: ["@lime-clients"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto(`/clients/${clientId}/edit`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  await page.goto('/join')
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('heading', { name: 'Подключение' })).toBeVisible()
  await expect(page.getByLabel('Код приглашения')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/clients$/)
})

test('trainer without Fit Lime keeps create, edit and join outside the pilot theme', { tag: ["@lime-clients"] }, async ({ page }) => {
  await mockPilot(page)
  for (const route of ['/clients/new', `/clients/${clientId}/edit`, '/join']) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

test('Fit Lime empty goal can be created without automatic criteria', { tag: ["@lime-goals","@lime-critical"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Цель' }).fill('Укрепить спину')
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Укрепить спину' })).toBeVisible()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
})

test('Fit Lime goal error retries without changing the client route', { tag: ["@lime-goals"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/goal$`))
})

test('trainer without Fit Lime keeps the original goal surface', { tag: ["@lime-goals"] }, async ({ page }) => {
  await mockPilot(page, { withGoal: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('heading', { name: 'Подготовка к старту' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime measurement history confirms destructive removal', { tag: ["@lime-progress"] }, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, withMeasurements: true })
  await page.goto(`/progress/${clientId}?view=measurements`)
  await expect(page.getByText('Последний замер')).toBeVisible()
  await page.getByRole('button', { name: 'История · 1' }).click()
  await expect(page.getByRole('heading', { name: 'История замеров (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('alertdialog', { name: /Удалить замер/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('heading', { name: 'История замеров (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Замеров пока нет')).toBeVisible()
})

test('Fit Lime progress source error has a working retry', { tag: ["@lime-progress","@lime-critical"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/progress/${clientId}?view=measurements`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Замеров пока нет')).toBeVisible()
})

test('trainer without Fit Lime keeps progress and workout history in the prior theme', { tag: ["@lime-progress"] }, async ({ page }) => {
  await mockPilot(page, { workouts: [{ ...workout, status: 'done' }] })
  for (const route of [`/progress/${clientId}`, `/progress/${clientId}?view=measurements`, `/clients/${clientId}/workouts`]) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

test('Fit Lime trainer profile keeps draft after save failure and retries', { tag: ["@lime-profile","@lime-critical"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstProfileSave: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить анкету' }).click()
  const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await form.getByLabel('О себе').fill('Сохраняемый текст')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(form.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('О себе')).toHaveValue('Сохраняемый текст')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
  expect(backend.getProfileSaveAttempts()).toBe(2)
})

test('Fit Lime trainer profile reports photo upload failure without losing editor', { tag: ["@lime-profile"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить анкету' }).click()
  const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await form.getByLabel('Выбрать фото').setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg')
  await expect(form.locator('.trainer-photo-editor').getByRole('alert')).toBeVisible()
  await expect(form.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('Fit Lime trainer profile retains publication, confirmation and sign-out', { tag: ["@lime-profile"] }, async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByRole('button', { name: 'Снять с публикации' })).toBeVisible()
  await page.getByRole('button', { name: 'Снять с публикации' }).click()
  await expect(page.getByRole('alertdialog', { name: /Снять анкету с публикации/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('button', { name: 'Снять с публикации' })).toBeVisible()
  await page.goto('/profile/settings')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

test('Fit Lime trainer profile has addressed load retry and non-pilot control', { tag: ["@lime-profile"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProfile: true })
  await page.goto('/profile')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setProfileFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
  await mockPilot(page)
  await page.reload()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.goto('/profile/settings')
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Тёмная тема', exact: true })).toBeVisible()
})

test('Fit Lime custom exercise creation keeps draft after server error', { tag: ["@lime-exercises","@lime-critical"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstCustomExerciseSave: true })
  await page.goto('/exercises')
  const form = page.locator('.catalog-custom-form')
  await form.getByLabel('Название').fill('Мой присед')
  await form.getByRole('button', { name: 'Добавить' }).click()
  await expect(form.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('Название')).toHaveValue('Мой присед')
  await form.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.locator('.catalog-custom-item')).toContainText('Мой присед')
  expect(backend.getCustomExerciseSaveAttempts()).toBe(2)
})

test('Fit Lime custom exercise edit and archive keep confirmation, error and restore', { tag: ["@lime-exercises"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, withCustomExercise: true, failArchive: true })
  await page.goto('/exercises')
  const item = page.locator('.catalog-custom-item')
  await expect(item).toContainText('Мой присед')
  await item.getByRole('button', { name: 'Изменить' }).click()
  const form = page.locator('.catalog-custom-form')
  await form.getByLabel('Название').fill('Мой присед с паузой')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(item).toContainText('Мой присед с паузой')
  await item.getByRole('button', { name: 'В архив' }).click()
  await expect(page.getByRole('alertdialog', { name: /Перенести «Мой присед с паузой» в архив/ })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(item).not.toHaveClass(/archived/)
  await item.getByRole('button', { name: 'В архив' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(item).not.toHaveClass(/archived/)
  backend.setArchiveFailure(false)
  await item.getByRole('button', { name: 'В архив' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
  await expect(item).toHaveClass(/archived/)
  await item.getByRole('button', { name: 'Вернуть' }).click()
  await expect(item).not.toHaveClass(/archived/)
})

test('Fit Lime exercises retry failed data without changing non-pilot catalog', { tag: ["@lime-exercises"] }, async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failTrainingData: true })
  await page.goto('/exercises')
  await expect(page.locator('.catalog-custom-results').getByRole('alert')).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.locator('.catalog-custom-results').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Собственных упражнений пока нет')).toBeVisible()
  await mockPilot(page)
  await page.reload()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
})

test('the bell count equals the visible queue and updates after snoozing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  let snoozeStatus = 0
  const snoozeRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/attention/snooze')) snoozeRequests.push(request.url()) })
  page.on('response', (response) => { if (response.url().includes('/attention/snooze')) snoozeStatus = response.status() })
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
  await expect(queue.getByText('Тренировки ещё не добавлены')).toBeVisible()
  await queue.getByRole('button', { name: 'Напомнить через 2 недели' }).click()
  await expect.poll(() => snoozeRequests).toHaveLength(1)
  await expect.poll(() => snoozeStatus).toBe(200)
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByText('Незавершённых действий нет')).toBeVisible()
})

test('action and onboarding sheets keep keyboard focus inside and return it on close', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  const bell = page.getByRole('button', { name: '1 Незавершённые действия' })
  await bell.click()
  const closeQueue = page.getByRole('button', { name: 'Закрыть рабочую очередь' })
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Напомнить через 2 недели' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bell).toBeFocused()

  const onboarding = page.getByRole('button', { name: 'Установка и уведомления' })
  await onboarding.click()
  const closeOnboarding = page.getByRole('button', { name: 'Закрыть подсказки' })
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(onboarding).toBeFocused()
})

test('today keeps workout entry usable while clients fail and recover', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page)
  let recovered = false
  await page.route('http://127.0.0.1:4100/v1/clients', async (route) => {
    await route.fulfill(recovered
      ? { status: 200, contentType: 'application/json', body: JSON.stringify({ clients: [] }) }
      : { status: 503, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  const clientError = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить клиентов' })
  await expect(clientError).toBeVisible()
  recovered = true
  await clientError.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toBeVisible()
})

test('new workout keeps the selected calendar day and returns to its two-week context', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-day-card').nth(8).click()
  const selectedDay = '/today?date=2026-09-29&week=2026-09-21&range=2w'
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
  await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-29' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?date=2026-09-29$/)
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
})

test('direct pilot workout link returns to its dated calendar instead of clients', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/workouts/new?date=2026-09-29')
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29$/)
})

test('Lime complete lifecycle preserves one plan through start resume and finish', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  const writes: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/workouts')) writes.push(new URL(request.url()).pathname) })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнения' }).click()
  await page.locator('.client-picker-trigger').click()
  await page.locator(`.client-picker-item[data-client-id="${clientId}"]`).click()
  await page.getByLabel('Начало').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'С тренером', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Начать сейчас', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}/live$`))
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.schedule-v2-event.schedule-event-done')).toHaveCount(1)
  expect(writes).toEqual(['/v1/workouts', `/v1/workouts/${newWorkoutId}/start`, `/v1/workouts/${newWorkoutId}/finish`])
})

test('failed calendar save preserves the form and retry returns to the selected day once', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstSave: true })
  await page.goto('/today?date=2026-09-29&week=2026-09-21&range=2w')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнения' }).click()
  await page.locator('.client-picker-trigger').click()
  await page.locator(`.client-picker-item[data-client-id="${clientId}"]`).click()
  await page.getByLabel('Начало').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'С тренером', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.locator('.workout-form .error')).toBeVisible()
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await expect(page.getByLabel('Начало')).toHaveValue('14:00')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  expect(backend.getLastSavedStartTime()).toBe('14:00')
  expect(backend.getSaveAttempts()).toBe(2)
  await page.reload()
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('editing a pilot workout returns to its calendar day with the changed time', async ({ page }) => {
  const backend = await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  const coachmarkDismiss = page.getByRole('button', { name: 'Понятно' })
  if (await coachmarkDismiss.isVisible()) await coachmarkDismiss.click()
  await page.getByRole('link', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('Начало').fill('13:00')
  await page.getByLabel('Окончание').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  expect(backend.getLastEditedStartTime()).toBe('13:00')
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('rescheduling refreshes both the former day and the two-week overview', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Перенести тренировку' }).click()
  await page.getByLabel('Новая дата').fill('2026-09-29')
  await page.getByRole('button', { name: 'Перенести', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Перенести тренировку' })).toBeHidden()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(0)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.locator('.schedule-v2-day-card').nth(8)).toContainText('Алексей Смирнов')
})

test('cancelling a pilot plan updates the day and excludes it from weekly totals', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Тренировка не состоялась' }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveClass(/schedule-event-skipped/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.getByText('0 тренировок · 0 клиентов')).toBeVisible()
})

test('untimed and near-midnight workouts remain reachable at the bottom of the day', async ({ page }) => {
  await mockPilot(page, { workouts: [
    { ...workout, id: '10000000-0000-4000-8000-000000000009', startTime: null, endTime: null },
    { ...workout, id: '10000000-0000-4000-8000-000000000010', startTime: '23:50', endTime: '00:20' },
  ] })
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.schedule-v2-untimed').getByText('Без времени', { exact: true })).toBeVisible()
  const late = page.locator('.schedule-v2-event')
  await expect(late).toHaveCount(1)
  await expect(late).toContainText('30 мин')
  const bottom = await late.evaluate((element) => (element as HTMLElement).offsetTop + element.clientHeight)
  const gridHeight = await page.locator('.schedule-v2-timeline .day-grid').evaluate((element) => element.clientHeight)
  expect(gridHeight).toBeGreaterThanOrEqual(bottom)
  await late.scrollIntoViewIfNeeded()
  await expect(late).toBeInViewport()
})

test('live clock refreshes after focus without resetting manual scroll and crosses midnight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:00.000Z'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: '27 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 700 })
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:40.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(700)
  await page.clock.setFixedTime(new Date('2026-09-27T21:01:00.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '28 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('00:01')
})

test('invalid calendar URL dates do not crash the pilot', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-02-31&range=2w')
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  await page.goto('/today?date=oops&week=2026-02-31')
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('Client Lime direct list entry keeps text through voice, review and save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const backend = await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
  await mockClientStreamingVoice(page, 'Приседания один подход десять повторений')
  await page.goto('/me?entry=workout')
  await expect(page).toHaveURL(/\/me\?entry=workout&draft=[\w-]+$/)
  const input = page.getByLabel('Тренировка', { exact: true })
  await input.fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(input).toHaveValue('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await page.getByRole('button', { name: /Остановить ·/ }).click()
  await expect(input).toHaveValue(/Жим лёжа[\s\S]*Присед/)
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
})

test('Client Lime compact voice permission denial preserves typed text', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId, workouts: [] })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
    })
  })
  await page.goto('/me?entry=workout')
  const input = page.getByLabel('Тренировка', { exact: true })
  await input.fill('Жим лёжа 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await expect(page.getByText('Нет доступа к микрофону.', { exact: false })).toBeVisible()
  await expect(input).toHaveValue('Жим лёжа 40 кг')
})

test('Client Lime voice parsing exposes progress and retains failed transcript', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: clientId })
  await page.goto('/me')
  await mockClientStreamingVoice(page, 'Упражнение с необычным названием десять раз')
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/assistant/yandex/parse-workout', async (route) => {
    await pending
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"error":"unavailable"}' })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Слушаю…' })).toBeVisible()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Разбираю диктовку' })).toBeVisible()
  release?.()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Упражнение с необычным названием десять раз')
  await expect(page.getByRole('region', { name: 'Не нашли упражнение' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Тренировка', { exact: true })).toHaveValue('Упражнение с необычным названием десять раз')
})

for (const kind of ['anonymous', 'other-client', 'trainer'] as const) {
  test(`Client Lime public routes exclude ${kind}`, { tag: ["@lime-critical"] }, async ({ page }) => {
    await mockPilot(page, { role: kind === 'trainer' ? 'trainer' : 'client', profileId: kind === 'other-client' ? '10000000-0000-4000-8000-000000000010' : kind === 'trainer' ? trainerId : clientId, fitLime: kind === 'trainer' })
    if (kind === 'anonymous') await page.addInitScript(() => localStorage.removeItem('fit.yandexAppSession.v1'))
    await page.addInitScript((id) => localStorage.setItem(`fit.clientLime.theme.${id}`, 'dark'), clientId)
    await mockPublicTrainer(page)
    for (const route of ['/legal/privacy', `/trainers/${publicTrainerId}`, '/invite']) {
      await page.goto(route)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expect(page.locator('.fit-client-lime')).toHaveCount(0)
      await expect(page.locator('html')).not.toHaveClass(/fit-client-lime-document/)
    }
  })
}

for (const role of ['client', 'trainer'] as const) test(`Lime rollout honors server admission and rollback for a previously non-pilot ${role}`, { tag: ["@lime-critical"] }, async ({ page }) => {
  const profileId = '10000000-0000-4000-8000-000000000099'
  const route = role === 'client' ? '/me' : '/clients'
  const scope = role === 'client' ? 'fit-client-lime' : 'fit-lime-shell'
  await mockPilot(page, { role, profileId, clientLime: role === 'client', fitLime: role === 'trainer' })
  await page.goto(route)
  await expect(page.locator('.phone-frame')).toHaveClass(new RegExp(scope))
  await page.reload()
  await expect(page.locator('.phone-frame')).toHaveClass(new RegExp(scope))
  // A fresh actor refresh must respect a server rollback for the same identity.
  await mockPilot(page, { role, profileId, clientLime: false, fitLime: false })
  await page.reload()
  await expect(page.locator('.phone-frame')).not.toHaveClass(new RegExp(scope))
})
