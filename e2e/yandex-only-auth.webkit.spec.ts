import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import { clientId, coachGestureWorkout, mockPilot } from './fit-lime-fixtures'
import type { WorkoutExerciseDraft } from '../src/shared/domain'

async function readyPlanEditorFixture(page: Page, theme = 'dark') {
  const actorId = 'c11e0000-6010-4000-8000-000000000001'
  await page.addInitScript(({ actorId, theme }) => localStorage.setItem(`fit.clientLime.theme.${actorId}`, theme), { actorId, theme })
  const source = coachGestureWorkout()
  const backend = await mockPilot(page, { role: 'client', profileId: actorId, clientLime: true, fitLime: false, workouts: [source] })
  const blockId = source.exercises[0]!.blockId
  const exercises: WorkoutExerciseDraft[] = [
    ...source.exercises.slice(0, 2).map((exercise, position) => ({ ...exercise, position, blockId, blockType: 'group' as const, blockRounds: 2,
      restBetweenExercisesSec: 15, restBetweenRoundsSec: 90, restBetweenSetsSec: 75,
      sets: [{ position: 0, weightKg: 7 + position, reps: 12 }, { position: 1, weightKg: 9 + position, reps: 10 }] })),
    { ...source.exercises[2]!, position: 2, name: 'Планка', ref: 'plank', inputKind: 'duration', blockType: 'single', blockRounds: 1, sets: [{ position: 0, durationSec: 90 }] },
  ]
  const favorite = { id: source.id, title: 'Плечи и корпус', version: 1, createdAt: '2026-10-23T00:00:00Z', exercises }
  await page.route('https://stage.example.test/v1/favorite-workouts', route => route.fulfill({ json: { favorites: [favorite] } }))
  return { actorId, favorite, source, backend }
}

test('Yandex ready plan protects the last input, pending request, retry and source history', async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const { actorId, favorite, source, backend } = await readyPlanEditorFixture(page)
  const originalFavorite = JSON.stringify(favorite), originalHistory = JSON.stringify(backend.getWorkouts())
  let release: (() => void) | undefined, attempts = 0
  const requestSchema = z.object({ requestId: z.string(), exercises: z.array(z.object({
    blockId: z.string(), blockRounds: z.number(),
    restBetweenExercisesSec: z.number().optional(), restBetweenRoundsSec: z.number().optional(), restBetweenSetsSec: z.number().optional(),
    sets: z.array(z.object({ position: z.number(), weightKg: z.number().nullish(), reps: z.number().nullish(), durationSec: z.number().nullish() }).passthrough()),
  }).passthrough()) })
  const requests: z.infer<typeof requestSchema>[] = []
  await page.route('https://stage.example.test/v1/workouts', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    attempts++
    requests.push(requestSchema.parse(route.request().postDataJSON()))
    if (attempts === 1) {
      await new Promise<void>(resolve => { release = resolve })
      return route.fulfill({ status: 503, json: { error: 'database_unavailable' } })
    }
    return route.fallback()
  })
  await page.goto(`/workouts/new?favorite=${favorite.id}`)
  const memberMenu = page.locator('.block-exercise-head').first().getByRole('button', { name: 'Ещё действия', exact: true })
  await memberMenu.click()
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.locator('.planned-round-exercise')).toHaveCount(4)
  const weight = page.locator('.planned-round-exercise').first().getByLabel('Вес, подход 1', { exact: true })
  await weight.fill('22.5')
  await page.locator('.compact-editor-exercise-toggle').last().click()
  const seconds = page.getByLabel('Время, подход 1: секунды', { exact: true })
  await seconds.fill('45')
  // Native submit while focus stays in the last field catches stale blur-only drafts.
  await page.locator('form.workout-form').evaluate(form => (form as HTMLFormElement).requestSubmit())
  await expect.poll(() => attempts).toBe(1)
  await expect(weight).toBeDisabled()
  await expect(seconds).toBeDisabled()
  await expect(memberMenu).toBeDisabled()
  await expect(page.getByRole('button', { name: /Упражнение$/ })).toBeDisabled()
  expect(requests[0]!.exercises[0]!.sets[0]!.weightKg).toBe(22.5)
  expect(requests[0]!.exercises[2]!.sets[0]!.durationSec).toBe(105)
  release!()
  await expect(page.getByText('Не удалось сохранить тренировку. Введённые данные остались в форме. Попробуйте сохранить ещё раз.', { exact: true })).toBeVisible()
  await expect(weight).toBeEnabled()
  await expect(weight).toHaveValue('22.5')
  await expect(seconds).toHaveValue('45')
  const draftKey = `fit.workout-form-draft.${actorId}.favorite-${favorite.id}`
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toContain('22.5')
  expect(JSON.stringify(favorite)).toBe(originalFavorite)
  expect(JSON.stringify(backend.getWorkouts())).toBe(originalHistory)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/[a-f0-9-]{36}$/)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1]!.exercises[0]!).toMatchObject({ blockRounds: 2, restBetweenExercisesSec: 15, restBetweenRoundsSec: 90, restBetweenSetsSec: 75 })
  expect(requests[1]!.exercises[0]!.blockId).toBe(requests[1]!.exercises[1]!.blockId)
  expect(requests[1]!.exercises[0]!.blockId).not.toBe(favorite.exercises[0]!.blockId)
  expect(JSON.stringify(backend.getWorkouts().find(workout => workout.id === source.id))).toBe(JSON.stringify(source))
  expect(JSON.stringify(favorite)).toBe(originalFavorite)
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull()
})

// Themes exercise token pairs; both real routes exercise different editor flags.
// Width changes check only geometry, not a duplicate CRUD lifecycle.
for (const theme of ['light', 'dark']) for (const mode of ['plan', 'favorite']) test(`Yandex ready editor Lime geometry ${mode} ${theme}`, async ({ page }, info) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const { favorite } = await readyPlanEditorFixture(page, theme)
  await page.goto(mode === 'plan' ? `/workouts/new?favorite=${favorite.id}` : `/me/workouts/favorites/${favorite.id}/edit`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workout-reference/)
  const row = page.locator('.planned-round-exercise').first()
  await expect(row).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать суперсет со следующим', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Действия с планом', exact: true })).toHaveText('Действия с планом')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => document.fonts.ready)
    const geometry = await row.evaluate(node => {
      const fields = [...node.querySelectorAll<HTMLElement>('.coach-plan-metric')].map(field => field.getBoundingClientRect())
      return { display: getComputedStyle(node).display, fields: fields.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right })) }
    })
    expect(geometry.display).toBe('grid')
    expect(Math.abs(geometry.fields[0]!.y - geometry.fields[1]!.y)).toBeLessThanOrEqual(1)
    expect(geometry.fields[0]!.right).toBeLessThan(geometry.fields[1]!.x)
    expect(geometry.fields[0]!.height).toBe(48)
    const toggle = page.locator('.compact-editor-exercise-toggle').last()
    await expect(toggle.locator('.compact-editor-chevron')).toBeVisible()
    const blockHead = await page.locator('.exercise-block-head').first().boundingBox()
    expect(blockHead!.height).toBeLessThanOrEqual(60)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`ready-editor-${mode}-${theme}-${width}.png`), fullPage: true })
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`ready-editor-fields-${mode}-${theme}-${width}.png`) })
  }
})

test('Yandex ready editor keeps the last input clear of keyboard and restores save after dismissal', async ({ page }, info) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  // A modeled visualViewport checks our layout only, not a physical iPhone keyboard.
  await page.addInitScript(() => {
    if (visualViewport) Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 420 })
  })
  const { favorite } = await readyPlanEditorFixture(page)
  for (const mode of ['plan', 'favorite']) {
    await page.goto(mode === 'plan' ? `/workouts/new?favorite=${favorite.id}` : `/me/workouts/favorites/${favorite.id}/edit`)
    const toggle = page.locator('.compact-editor-exercise-toggle').last()
    await toggle.click()
    const seconds = page.getByLabel('Время, подход 1: секунды', { exact: true })
    await seconds.fill('45')
    await seconds.focus()
    await page.evaluate(() => visualViewport?.dispatchEvent(new Event('resize')))
    await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
    await seconds.scrollIntoViewIfNeeded()
    const field = (await seconds.boundingBox())!
    expect(field.y).toBeGreaterThanOrEqual(0)
    expect(field.y + field.height).toBeLessThanOrEqual(420)
    // Existing policy hides the fixed footer during typing; do not overlay the keyboard.
    await expect(page.locator('.workout-action-row')).toBeHidden()
    await page.screenshot({ path: info.outputPath(`ready-editor-keyboard-${mode}.png`) })
    await seconds.blur()
    await page.evaluate(() => {
      if (visualViewport) Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight })
      visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/)
    const save = page.getByRole('button', { name: mode === 'plan' ? 'Сохранить план' : 'Сохранить изменения', exact: true })
    await expect(save).toBeVisible()
    await expect(seconds).toHaveValue('45')
    const saveBox = (await save.boundingBox())!
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(844)
  }
})

test('Yandex shared plan fields keep the trainer reference layout at mobile and desktop widths', async ({ page }, info) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const source = coachGestureWorkout()
  const members = source.exercises.slice(0, 2)
  for (const exercise of members) { exercise.blockId = members[0]!.blockId; exercise.blockType = 'group'; exercise.blockRounds = 2 }
  source.exercises = members
  await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000001', fitLime: true, workouts: [source] })
  await page.goto(`/workouts/new?copy=${source.id}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/coach-workout-reference/)
  const row = page.locator('.planned-round-exercise').first()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(row).toBeVisible()
    const values = await row.locator('.coach-plan-metric').evaluateAll(fields => fields.map(field => { const r = field.getBoundingClientRect(); return { y: r.y, width: r.width } }))
    expect(Math.abs(values[0]!.y - values[1]!.y)).toBeLessThanOrEqual(1)
    expect(values[0]!.width).toBeGreaterThan(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`shared-trainer-fields-${width}.png`) })
  }
})

if (process.env.FIT_YANDEX_E2E_REQUIRED === 'true') {
  for (const name of [
    'VITE_YANDEX_ONLY_AUTH_ENABLED',
    'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED',
    'VITE_YANDEX_APP_SESSION_ENABLED',
    'VITE_YANDEX_MAIN_ROUTING_ENABLED',
  ]) {
    expect(process.env[name], `${name} must be enabled in the required Yandex E2E lane`).toBe('true')
  }
  expect(process.env.VITE_YANDEX_OAUTH_CLIENT_ID).toBeTruthy()
  expect(process.env.VITE_YANDEX_API_BASE_URL).toBe('https://stage.example.test')
}

const legacyRequestCounts = new WeakMap<object, number>()

for (const input of ['favorite', 'preset'] as const) test(`Yandex ready ${input} creates an independent plan through the shared form`, async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const actorId = 'c11e0000-6010-4000-8000-000000000001'
  const source = coachGestureWorkout()
  const original = JSON.stringify(source)
  const backend = await mockPilot(page, { role: 'client', profileId: actorId, clientLime: true, fitLime: false, workouts: [source] })
  const favorite = { id: source.id, title: 'Мой шаблон', version: 1, createdAt: '2026-10-22T00:00:00Z', exercises: [{ ...source.exercises[0]!, sets: [{ position: 0, weightKg: 40, reps: 12 }] }] }
  const favoriteBefore = JSON.stringify(favorite)
  await page.route('https://stage.example.test/v1/favorite-workouts', route => route.fulfill({ json: { favorites: [favorite] } }))
  await page.goto(`/workouts/new?${input}=${input === 'favorite' ? source.id : 'full-body-no-equipment'}`)
  await expect(page.locator('.planned-exercise')).toHaveCount(input === 'favorite' ? 1 : 5)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/[a-f0-9-]{36}$/)
  await expect.poll(() => backend.getWorkouts().length).toBe(2)
  const saved = backend.getWorkouts().find(workout => workout.id !== source.id)!
  expect(saved.status).toBe('planned')
  expect(saved.exercises).toHaveLength(input === 'favorite' ? 1 : 5)
  if (input === 'favorite') expect(saved.exercises[0]!.sets[0]).toMatchObject({ weightKg: 40, reps: 12 })
  expect(saved.exercises[0]!.blockId).not.toBe(source.exercises[0]!.blockId)
  expect(JSON.stringify(backend.getWorkouts().find(workout => workout.id === source.id))).toBe(original)
  expect(JSON.stringify(favorite)).toBe(favoriteBefore)
})

for (const status of ['planned', 'done'] as const) test(`Yandex assigned ${status} workout saves an independent favorite without original manage rights`, async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const actorId = 'c11e0000-6010-4000-8000-000000000001'
  const source = { ...coachGestureWorkout(), status }
  const first = source.exercises[0]!.sets[0]!
  first.weightKg = 20
  first.reps = 5
  first.fact = status === 'done' ? { weightKg: 30, reps: 8 } : {}
  first.confirmedAt = status === 'done' ? '2026-10-21T09:00:00Z' : null
  const original = JSON.stringify(source)
  const backend = await mockPilot(page, { role: 'client', profileId: actorId, clientLime: true, fitLime: false, workouts: [source] })
  let snapshot: { exercises: Record<string, unknown>[] } | undefined
  await page.route('https://stage.example.test/v1/favorite-workouts', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { favorites: [] } })
    const draft = z.object({ title: z.string(), exercises: z.array(z.record(z.string(), z.unknown())) }).parse(route.request().postDataJSON())
    snapshot = draft
    return route.fulfill({ status: 201, json: { ...draft, id: source.id, version: 1, createdAt: '2026-10-22T00:00:00Z' } })
  })
  await page.goto(`/workouts/${source.id}`)
  const menu = page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true })
  await menu.click()
  await expect(page.getByRole('menuitem', { name: 'Удалить тренировку', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^(Изменить|Изменить результат)$/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'В избранное', exact: true }).click()
  await page.getByRole('dialog', { name: 'Сохранить в избранное' }).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(() => snapshot).toBeTruthy()
  expect(z.array(z.unknown()).parse(snapshot!.exercises[0]?.sets)[0]).toMatchObject({ weightKg: status === 'done' ? 30 : 20, reps: status === 'done' ? 8 : 5 })
  expect(JSON.stringify(backend.getWorkouts()[0])).toBe(original)
})

test('Yandex ready workouts edits, renames, plans and deletes an independent favorite with explicit retries', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const actorId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
  const id = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
  const exercise = { position: 0, source: 'system', ref: 'squat', customExerciseId: null, name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength',
    blockId: '8ffdb87b-078c-42d4-b6db-af8bc60f80f2', blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 90, trainerComment: null,
    sets: [{ position: 0, weightKg: 50, reps: 8, durationMin: null, durationSec: null, distanceKm: null, rpe: null }] }
  let favorite: { id: string; title: string; version: number; createdAt: string; exercises: Record<string, unknown>[] } | null = {
    id, title: 'Ноги и корпус', version: 1, createdAt: '2026-10-21T08:00:00Z', exercises: [exercise],
  }
  let editAttempts = 0, deleteAttempts = 0, loadError = false, historyError = true, renameConflict = true
  let editorConflict = false, favoriteReads = 0
  let recoveryReadMode: 'normal' | 'error' | 'missing' | 'pending' = 'normal'
  let releaseFavoriteRead: (() => void) | undefined
  const updates: unknown[] = []
  await page.route('https://stage.example.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/health') return route.fulfill({ json: { status: 'ok' }, headers: { 'x-fit-request-id': 'synthetic-ready-health', 'access-control-expose-headers': 'x-fit-request-id' } })
    if (path === '/v1/auth/yandex/session') return route.fulfill({ json: { accessMode: 'read_write', profile: {
      id: actorId, firstName: 'Тестовый спортсмен', lastName: null, timezone: 'Europe/Moscow', accountRole: 'client',
      client: { id: clientId, trainerId: actorId, fullName: 'Тестовый спортсмен' }, experiments: { clientLime: true, fitLime: false, trainerScheduleV2: false },
    } } })
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
    if (path === '/v1/clients') return route.fulfill({ json: { clients: [{
      id: clientId, canArchive: false, hasAccount: true, fullName: 'Тестовый спортсмен', canonicalFullName: 'Тестовый спортсмен',
      gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
    }] } })
    if (path === '/v1/connections') return route.fulfill({ json: { memberships: [], invitations: [] } })
    if (path === '/v1/training-data' && !historyError) return route.fulfill({ json: {
      accessMode: 'read_only', customExercises: [], attention: [], attentionPreferences: [], hasMoreWorkouts: false, totalWorkouts: 0, workouts: [],
    } })
    if (path === '/v1/favorite-workouts') {
      favoriteReads++
      if (recoveryReadMode === 'pending') await new Promise<void>(resolve => { releaseFavoriteRead = resolve })
      return route.fulfill(loadError || recoveryReadMode === 'error'
        ? { status: 503, json: { error: 'database_unavailable' } } : { json: { favorites: favorite && recoveryReadMode !== 'missing' ? [favorite] : [] } })
    }
    if (path === `/v1/favorite-workouts/${id}` && request.method() === 'PUT') {
      const command = z.object({ expectedVersion: z.number(), title: z.string(), exercises: z.array(z.record(z.string(), z.unknown())).optional() }).parse(request.postDataJSON())
      updates.push(command)
      if (command.exercises && editorConflict) {
        editorConflict = false
        favorite!.version++
        return route.fulfill({ status: 409, json: { error: 'version_conflict' } })
      }
      if (!command.exercises && renameConflict) {
        renameConflict = false
        favorite!.version++
        return route.fulfill({ status: 409, json: { error: 'version_conflict' } })
      }
      expect(command.expectedVersion).toBe(favorite?.version)
      if (command.exercises) {
        editAttempts++
        expect(command.exercises[0]?.sets).toMatchObject([{ weightKg: 65, reps: 10 }])
        if (editAttempts === 1) return route.fulfill({ status: 503, json: { error: 'database_unavailable' } })
      }
      favorite = { ...favorite!, title: command.title, exercises: command.exercises ?? favorite!.exercises, version: favorite!.version + 1 }
      return route.fulfill({ json: favorite })
    }
    if (path === `/v1/favorite-workouts/${id}` && request.method() === 'DELETE') {
      deleteAttempts++
      if (deleteAttempts === 1) return route.fulfill({ status: 503, json: { error: 'database_unavailable' } })
      favorite = null
      // The deletion committed, but its response was lost. Reconcile by GET.
      return route.fulfill({ status: 503, json: { error: 'database_unavailable' } })
    }
    // Even a failed history must not block the independent Ready section.
    return route.fulfill({ status: 503, json: { error: 'synthetic_unused_read' } })
  })
  await page.addInitScript(({ actorId }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    if (!localStorage.getItem(`fit.clientLime.theme.${actorId}`)) localStorage.setItem(`fit.clientLime.theme.${actorId}`, 'light')
  }, { actorId })
  await page.goto('/me/workouts?tab=presets')
  const card = page.locator('.favorite-workout-card')
  await expect(card).toContainText('Приседание')
  const shortCardBox = (await card.boundingBox())!
  const shortMenuBox = (await card.getByRole('button', { name: 'Действия с тренировкой Ноги и корпус' }).boundingBox())!
  expect(shortCardBox.x + shortCardBox.width - shortMenuBox.x - shortMenuBox.width).toBeLessThanOrEqual(24)
  await expect(page.locator('.state-panel-error')).toHaveCount(0)
  await expect(page.getByText('Управление избранным', { exact: true })).toBeVisible()
  await page.locator('.coachmark-bubble').filter({ hasText: 'Управление избранным' }).getByRole('button', { name: 'Понятно', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировки Fit' })).toBeVisible()
  historyError = false
  await card.getByRole('button', { name: 'Действия с тренировкой Ноги и корпус' }).click()
  await page.getByRole('menuitem', { name: 'Переименовать', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Переименовать тренировку' })
  await rename.getByLabel('Название', { exact: true }).fill('Силовая')
  await rename.getByRole('button', { name: 'Сохранить', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(rename.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(rename.getByRole('button', { name: 'Сохранить', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(rename).not.toBeVisible()
  await expect(card.getByRole('button', { name: 'Действия с тренировкой Ноги и корпус' })).toBeFocused()
  await card.getByRole('button', { name: 'Действия с тренировкой Ноги и корпус' }).click()
  await page.getByRole('menuitem', { name: 'Переименовать', exact: true }).click()
  await rename.getByLabel('Название', { exact: true }).fill('Силовая')
  await page.setViewportSize({ width: 390, height: 500 })
  await expect.poll(async () => {
    const bounds = await rename.getByLabel('Название', { exact: true }).boundingBox()
    return bounds ? bounds.y + bounds.height : Infinity
  }).toBeLessThanOrEqual(500)
  await testInfo.attach('favorite-rename-keyboard', { body: await page.screenshot({ path: testInfo.outputPath('favorite-rename-keyboard.png') }), contentType: 'image/png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await rename.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(rename.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await rename.getByRole('button', { name: 'Загрузить текущую версию', exact: true }).click()
  await expect(rename.getByLabel('Название', { exact: true })).toHaveValue('Силовая')
  await rename.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(rename).not.toBeVisible()
  expect(updates).toEqual([{ expectedVersion: 1, title: 'Силовая' }, { expectedVersion: 2, title: 'Силовая' }])
  await card.getByRole('button', { name: 'Действия с тренировкой Силовая' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Силовая')
  await expect(page.getByLabel('Дата', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Тип тренировки' })).toHaveCount(0)
  await page.getByLabel('Название', { exact: true }).fill('Моя силовая')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Упражнение', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await picker.getByLabel('Поиск упражнения').fill('Планка')
  await picker.locator('button[data-exercise-ref="plank"][data-exercise-source="system"]').click()
  await picker.getByRole('button', { name: 'Добавить (1)', exact: true }).click()
  await expect(page.locator('.planned-exercise')).toHaveCount(2)
  const titles = page.locator('.compact-editor-exercise-title strong')
  const addedName = await titles.nth(1).innerText()
  const handle = page.getByRole('button', { name: `Переместить: ${addedName}`, exact: true })
  await handle.focus()
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
  await expect(titles.first()).toHaveText(addedName)
  await handle.focus()
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(titles.first()).toHaveText('Приседание')
  await page.locator('.planned-exercise').nth(1).getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Заменить', exact: true }).click()
  await picker.getByLabel('Поиск упражнения').fill('Скручивания')
  await picker.locator('button[data-exercise-ref="crunches"][data-exercise-source="system"]').click()
  await expect(titles.nth(1)).toHaveText('Скручивания')
  await page.locator('.planned-exercise').nth(1).getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить упражнение', exact: true }).click()
  await expect(page.locator('.planned-exercise')).toHaveCount(1)
  await page.locator('.compact-editor-exercise-toggle').first().click()
  await page.getByLabel('Вес, подход 1', { exact: true }).fill('65')
  await page.getByLabel('Повторы, подход 1', { exact: true }).fill('10')
  await testInfo.attach('favorite-editor', { body: await page.screenshot({ path: testInfo.outputPath('favorite-editor.png') }), contentType: 'image/png' })
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'недоступен' })).toBeVisible()
  expect(editAttempts).toBe(1)
  await page.reload()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Моя силовая')
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/workouts\?tab=presets$/)
  await expect(card).toContainText('Моя силовая')
  expect(editAttempts).toBe(2)
  // Recovery must read before discarding this editor's input, including 503/missing.
  await card.getByRole('button', { name: 'Действия с тренировкой Моя силовая' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название', { exact: true }).fill('Черновик для восстановления')
  const editDraftKey = `fit.favorite-workout-edit.${actorId}.${id}`
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), editDraftKey)).toContain('Черновик для восстановления')
  editorConflict = true
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  const recover = page.getByRole('button', { name: 'Загрузить текущую версию', exact: true })
  await expect(recover).toBeVisible()
  const retainedEditorDraft = await page.evaluate(key => localStorage.getItem(key), editDraftKey)
  const writesBeforeRecovery = updates.length, readsBeforeCancel = favoriteReads
  await recover.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(favoriteReads).toBe(readsBeforeCancel)
  expect(await page.evaluate(key => localStorage.getItem(key), editDraftKey)).toBe(retainedEditorDraft)
  for (const failure of ['error', 'missing'] as const) {
    recoveryReadMode = failure
    await recover.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Загрузить', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(failure === 'error' ? 'Не удалось загрузить актуальную версию' : 'Тренировка больше недоступна')
    await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Черновик для восстановления')
    expect(await page.evaluate(key => localStorage.getItem(key), editDraftKey)).toBe(retainedEditorDraft)
    expect(updates).toHaveLength(writesBeforeRecovery)
  }
  favorite!.title = 'Серверная версия'
  favorite!.exercises = [{ ...exercise, sets: [{ ...exercise.sets[0]!, weightKg: 80, reps: 12 }] }]
  recoveryReadMode = 'pending'
  let reloadNavigations = 0
  const countReload = () => { reloadNavigations++ }
  page.on('framenavigated', countReload)
  const readsBeforePending = favoriteReads
  await recover.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Загрузить', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Загружаем…', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Название', { exact: true })).toBeDisabled()
  expect(await page.evaluate(key => localStorage.getItem(key), editDraftKey)).toBe(retainedEditorDraft)
  await page.locator('form.workout-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(favoriteReads).toBe(readsBeforePending + 1)
  expect(updates).toHaveLength(writesBeforeRecovery)
  recoveryReadMode = 'normal'
  releaseFavoriteRead?.()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Серверная версия')
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), editDraftKey)).toBeNull()
  expect(reloadNavigations).toBe(0)
  page.off('framenavigated', countReload)
  await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled()
  expect(updates).toHaveLength(writesBeforeRecovery)
  await page.locator('.compact-editor-exercise-toggle').first().click()
  await expect(page.getByLabel('Вес, подход 1', { exact: true })).toHaveValue('80')
  await page.getByLabel('Вес, подход 1', { exact: true }).fill('65')
  await page.getByLabel('Повторы, подход 1', { exact: true }).fill('10')
  await page.getByLabel('Название', { exact: true }).fill('Моя силовая')
  const recoveredVersion = favorite!.version
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/workouts\?tab=presets$/)
  expect(updates.at(-1)).toMatchObject({ expectedVersion: recoveredVersion, title: 'Моя силовая' })
  favorite!.title = 'СиловаяТренировкаБезПробелов'.repeat(4)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 932 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ actorId, theme }) => localStorage.setItem(`fit.clientLime.theme.${actorId}`, theme), { actorId, theme })
      await page.reload()
      await expect(card).toBeVisible()
      const menu = card.getByRole('button', { name: /Действия с тренировкой/ })
      const box = (await menu.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await testInfo.attach(`ready-${width}-${theme}`, { body: await page.screenshot({ path: testInfo.outputPath(`ready-${width}-${theme}.png`) }), contentType: 'image/png' })
    }
  }
  favorite!.title = 'Моя силовая'
  await page.reload()
  await card.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?favorite=${id}$`))
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  const storedDraftKey = `fit.workout-form-draft.${actorId}.favorite-${id}`
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storedDraftKey)).not.toBeNull()
  // A refreshed source must not silently overwrite or resume an older plan.
  await page.goto('/me/workouts?tab=presets')
  await expect(card).toBeVisible()
  favorite!.version++
  // Do not reload: retain the application's fresh 20-second query cache.
  await card.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Есть несохранённый черновик' })).toBeVisible()
  await expect(page.getByText('Шаблон обновлён или версия старого черновика неизвестна. Выберите, с чем продолжить.', { exact: true })).toBeVisible()
  await expect(page.locator('form.workout-form')).toHaveCount(0)
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  const retained = await page.evaluate(key => localStorage.getItem(key), storedDraftKey)
  await page.reload()
  await page.getByRole('button', { name: 'Начать из обновлённого шаблона', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await page.evaluate(key => localStorage.getItem(key), storedDraftKey)).toBe(retained)
  loadError = true
  await page.getByRole('button', { name: 'Начать из обновлённого шаблона', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Начать заново', exact: true }).click()
  await expect(page.locator('.state-panel-error')).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), storedDraftKey)).toBe(retained)
  loadError = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Есть несохранённый черновик' })).toBeVisible()
  // The server can change again while the user reads the restore choice.
  favorite!.version++
  favorite!.exercises = [{ ...exercise, sets: [{ ...exercise.sets[0]!, weightKg: 70, reps: 10 }] }]
  await page.getByRole('button', { name: 'Начать из обновлённого шаблона', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Начать заново', exact: true }).click()
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  await expect.poll(async () => {
    const stored = await page.evaluate(key => localStorage.getItem(key), storedDraftKey)
    // Replacing a draft removes the old value before React persists the new one.
    return stored === null ? null : z.object({ sourceVersion: z.number() }).parse(JSON.parse(stored)).sourceVersion
  }).toBe(favorite!.version)
  await page.locator('.compact-editor-exercise-toggle').first().click()
  await expect(page.getByLabel('Вес, подход 1', { exact: true })).toHaveValue('70')
  await page.goto('/me/workouts?tab=presets')
  await page.locator('.preset-workout-card').first().getByRole('button', { name: 'Запланировать', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?preset=full-body-no-equipment$/)
  await expect(page.locator('.planned-exercise')).toHaveCount(5)
  await expect(page.getByRole('group', { name: 'Тип тренировки' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
  await expect(page.locator('.coach-plan-options')).not.toHaveAttribute('open')
  await testInfo.attach('ready-plan', { body: await page.screenshot({ path: testInfo.outputPath('ready-plan.png') }), contentType: 'image/png' })
  await page.getByText('Настройки плана', { exact: true }).click()
  await page.getByLabel('Окончание', { exact: true }).fill('12:00')
  await page.getByLabel('Заметка', { exact: true }).fill('Личная заметка')
  await page.reload()
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await page.getByText('Настройки плана', { exact: true }).click()
  await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue('12:00')
  await expect(page.getByLabel('Заметка', { exact: true })).toHaveValue('Личная заметка')
  await page.goto('/me/workouts?tab=presets')
  await card.getByRole('button', { name: 'Действия с тренировкой Моя силовая' }).click()
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Запланированные тренировки и история сохранятся.')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Повторить удаление' })).toBeVisible()
  await expect(card).toBeVisible()
  expect(deleteAttempts).toBe(1)
  await page.getByRole('button', { name: 'Повторить удаление' }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByText('Пока нет сохранённых тренировок.')).toBeVisible()
  await page.goto(`/workouts/new?favorite=${id}`)
  await expect(page.getByRole('heading', { name: 'Тренировка больше недоступна' })).toBeVisible()
  await expect(page.locator('form.workout-form')).toHaveCount(0)
  loadError = true
  await page.goto(`/me/workouts/favorites/${id}/edit`)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0)
  loadError = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка больше недоступна' })).toBeVisible()
})

test('Yandex favorite save keeps the title and exposes diagnostics without replaying a failed POST', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const actorId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
  const workoutId = '948d78c7-994c-4c21-b2fe-81efb2091854'
  const exerciseId = 'e2fc2c6d-0f33-4826-af68-46b0a5c79ff4'
  let saves = 0
  let favorite: { id: string; title: string; exercises: Record<string, unknown>[]; createdAt: string } | undefined
  let releaseSave: (() => void) | undefined
  await page.route('https://stage.example.test/health', route => route.fulfill({ json: { status: 'ok' }, headers: {
    'x-fit-request-id': 'synthetic-health', 'access-control-expose-headers': 'x-fit-request-id',
  } }))
  await page.route('https://stage.example.test/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
      accessMode: 'read_write', profile: { id: actorId, firstName: 'Тестовый спортсмен', lastName: null,
        timezone: 'Europe/Moscow', accountRole: 'client', client: { id: clientId, trainerId: actorId, fullName: 'Тестовый спортсмен' },
        experiments: { clientLime: true, fitLime: false, trainerScheduleV2: false } },
    } })
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
    if (path === '/v1/connections') return route.fulfill({ json: { memberships: [], invitations: [] } })
    if (path === '/v1/training-data') return route.fulfill({ json: {
      accessMode: 'read_only', customExercises: [], attention: [], attentionPreferences: [], hasMoreWorkouts: false, totalWorkouts: 1,
      workouts: [{ id: workoutId, trainerId: actorId, clientId, clientName: 'Тестовый спортсмен', createdBy: actorId,
        startedBy: null, completedBy: actorId, workoutDate: '2020-01-02', startTime: null, endTime: null, status: 'done',
        notes: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null, feedbackSubmittedAt: null,
        trainerReaction: null, trainerReview: null, trainerReviewAuthorId: null, trainerReviewedAt: null,
        clientQuestion: null, clientQuestionAskedAt: null, clientQuestionResolvedAt: null, startedAt: null,
        completedAt: '2020-01-02T12:00:00Z', hasPr: false, version: 1,
        exercises: [{ id: exerciseId, position: 0, source: 'system', ref: 'squat', customExerciseId: null,
          name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength', blockId: exerciseId, blockType: 'single',
          blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0,
          restBetweenSetsSec: 60, trainerComment: null, sets: [{ id: exerciseId, position: 0,
            plan: { weightKg: 50, reps: 5, durationMin: null, durationSec: null, distanceKm: null, rpe: null },
            fact: { weightKg: 55, reps: 6, durationMin: null, durationSec: null, distanceKm: null, rpe: null },
            confirmedAt: '2020-01-02T12:00:00Z', version: 1 }] }],
      }],
    } })
    if (path === '/v1/favorite-workouts' && route.request().method() === 'POST') {
      saves += 1
      const body = z.object({ title: z.string(), exercises: z.array(z.record(z.string(), z.unknown())) }).parse(route.request().postDataJSON())
      expect(body.title).toBe('Тестовый план')
      expect(body.exercises[0]?.sets).toMatchObject([{ weightKg: 55, reps: 6 }])
      expect(route.request().headers()['x-fit-request-id']).toMatch(/^[a-f0-9-]{36}$/)
      await new Promise<void>(resolve => { releaseSave = resolve })
      if (saves > 1) favorite = { id: exerciseId, title: body.title, exercises: body.exercises, createdAt: '2026-10-20T09:00:00+00:00' }
      return route.fulfill(saves === 1 ? { status: 503, json: { error: 'database_unavailable' }, headers: {
        'x-fit-request-id': '12345678-1234-4234-8234-123456789abc', 'x-fit-release-id': 'synthetic-release',
        'x-fit-error-code': '08006', 'x-fit-error-category': 'database_connection',
        'access-control-expose-headers': 'x-fit-request-id,x-fit-release-id,x-fit-error-code,x-fit-error-category',
      } } : { status: 201, json: { id: exerciseId, title: body.title, exercises: body.exercises, createdAt: '2026-10-20T09:00:00+00:00' } })
    }
    if (path === '/v1/favorite-workouts') return route.fulfill({ json: { favorites: favorite ? [favorite] : [] } })
    if (path === '/v1/clients') return route.fulfill({ json: { clients: [{
      id: clientId, canArchive: false, hasAccount: true, fullName: 'Тестовый спортсмен', canonicalFullName: 'Тестовый спортсмен',
      gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
      currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
    }] } })
    return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (text: string) => { sessionStorage.setItem('test.copiedDiagnostic', text); return Promise.resolve() },
    } })
  })
  await page.goto(`/workouts/${workoutId}`)
  await page.getByRole('button', { name: 'Действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'В избранное', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Сохранить в избранное' })
  const title = dialog.getByRole('textbox', { name: 'Название' })
  await title.fill('Тестовый план')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(() => saves).toBe(1)
  await expect(dialog.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled()
  await expect(title).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled()
  // A second form submission while pending must not start another mutation.
  await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saves).toBe(1)
  releaseSave?.()
  await expect(dialog.getByRole('alert')).toContainText('Сервер не подтвердил сохранение в избранное')
  await expect(dialog.getByText('FIT-1234-5678-9ABC')).toBeVisible()
  await dialog.getByRole('button', { name: 'Скопировать диагностику' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Скопировано')
  const diagnostic = await page.evaluate(() => sessionStorage.getItem('test.copiedDiagnostic'))
  expect(diagnostic).toContain('08006')
  expect(diagnostic).toContain('synthetic-release')
  expect(diagnostic).not.toContain('Тестовый план')
  expect(diagnostic).not.toContain('a'.repeat(43))
  await expect(title).toHaveValue('Тестовый план')
  expect(saves).toBe(1)
  // One behavior flow; this matrix only checks responsive/theme rendering.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(({ value, id }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, value)
      window.dispatchEvent(new Event('fit-client-lime-theme-change'))
    }, { value: theme, id: actorId })
    await expect(page.locator('html')).toHaveClass(/fit-client-lime-document/)
    if (theme === 'light') await expect(page.locator('html')).toHaveClass(/theme-light/)
    else await expect(page.locator('html')).not.toHaveClass(/theme-light/)
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const copy = await dialog.getByRole('button', { name: 'Скопировать диагностику' }).boundingBox()
      expect(copy?.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: testInfo.outputPath(`favorite-error-${theme}-${width}.png`) })
    }
  }
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(() => saves).toBe(2)
  releaseSave?.()
  await expect(dialog).not.toBeVisible()
  await page.goto('/me/workouts?tab=presets')
  await page.reload()
  const card = page.locator('.favorite-workout-card').filter({ hasText: 'Тестовый план' })
  await expect(card).toBeVisible()
  await page.locator('.coachmark-bubble').filter({ hasText: 'Управление избранным' }).getByRole('button', { name: 'Понятно', exact: true }).click()
  await card.getByRole('button', { name: 'Запланировать' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?favorite=/)
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  expect(saves).toBe(2)
})

test('single-trainer public invitation survives preview failure and preserves a claimed receipt without a session', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const token = `ABCDEF123456.${'a'.repeat(64)}`
  let previewCount = 0
  await page.route('https://stage.example.test/v1/invitation-links/preview', route => {
    previewCount += 1
    return route.fulfill(previewCount === 1 ? { status: 503, json: { error: 'service_unavailable' } } : { json: {
      invitation: { targetRole: 'trainer', inviterName: 'Тестовый спортсмен', status: 'claimed', expiresAt: '2099-01-01T00:00:00.000Z' },
    } })
  })
  await page.goto(`/invite?token=${token}&source=yandex`)
  await expect(page.getByText('Не удалось проверить приглашение', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByText('Приглашение уже принято', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти и подключиться' })).toBeEnabled()
  expect(await page.evaluate(() => sessionStorage.getItem('fit.pendingInvitationLink.v1'))).toContain(token)
  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`public-invite-receipt-${width}.png`), fullPage: true })
  }
})

for (const role of ['client', 'trainer'] as const) {
  test(`single-trainer invitation registration preserves the verified ${role} role after OAuth`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    await page.route('https://stage.example.test/v1/auth/yandex/session', route => route.fulfill({ status: 409, json: {
      error: 'yandex_identity_unlinked', handoff: { token: 'h'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
    } }))
    await page.route('https://stage.example.test/v1/invitation-links/preview', route => route.fulfill({ json: {
      invitation: { targetRole: role, inviterName: 'Отправитель приглашения', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' },
    } }))
    let submittedRole: unknown
    await page.route('https://stage.example.test/v1/auth/yandex/complete-registration', route => {
      const body: unknown = route.request().postDataJSON()
      submittedRole = z.object({ accountRole: z.enum(['client', 'trainer']) }).parse(body).accountRole
      return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    })
    await page.route('https://stage.example.test/health', route => route.fulfill({ json: { status: 'ok' }, headers: {
      'x-fit-request-id': 'synthetic-invite-health', 'access-control-expose-headers': 'x-fit-request-id',
    } }))
    await page.addInitScript(value => {
      sessionStorage.setItem('fit.pendingInvitationLink.v1', JSON.stringify({ token: value, source: 'yandex', savedAt: Date.now() }))
      sessionStorage.setItem('fit.yandexIdPilot.oauthState', 'test-state')
      sessionStorage.setItem('fit.yandexIdPilot.oauthVerifier', 'v'.repeat(64))
      sessionStorage.setItem('fit.yandexIdPilot.oauthIntent', 'app')
    }, token)
    await page.goto('/auth/yandex/callback?code=test-code&state=test-state')
    const form = page.getByRole('main', { name: 'Регистрация' })
    await expect(form.getByRole('radio', { name: role === 'client' ? 'Я спортсмен' : 'Я тренер' })).toBeChecked()
    await expect(form.getByRole('radio', { name: role === 'client' ? 'Я тренер' : 'Я спортсмен' })).toBeDisabled()
    await form.getByRole('textbox', { name: 'Имя' }).fill('Тестовый пользователь')
    await form.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(form.getByRole('alert')).toBeVisible()
    expect(submittedRole).toBe(role)
    await expect(form.getByRole('textbox', { name: 'Имя' })).toHaveValue('Тестовый пользователь')
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`invite-registration-${role}-${width}.png`), fullPage: true })
    }
  })
}

test('single-trainer claimed link recovers a lost response through an explicit safe retry', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const token = `ABCDEF123456.${'a'.repeat(64)}`
  const trainerId = '11e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
  let claims = 0
  await page.route('https://stage.example.test/v1/legal/acceptance', route => route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } }))
  await page.route('https://stage.example.test/v1/auth/yandex/session', route => route.fulfill({ json: {
    accessMode: 'read_write', profile: { id: trainerId, firstName: 'Тестовый тренер', lastName: null,
      timezone: 'Europe/Moscow', accountRole: 'trainer', experiments: { trainerScheduleV2: false, fitLime: true, clientLime: false } },
  } }))
  await page.route('https://stage.example.test/v1/invitation-links/preview', route => route.fulfill({ json: {
    invitation: { targetRole: 'trainer', inviterName: 'Тестовый спортсмен', status: 'claimed', expiresAt: '2099-01-01T00:00:00.000Z' },
  } }))
  await page.route('https://stage.example.test/health', route => route.fulfill({ json: { status: 'ok' }, headers: {
    'x-fit-request-id': 'synthetic-invite-health', 'access-control-expose-headers': 'x-fit-request-id',
  } }))
  await page.route('https://stage.example.test/v1/invitation-links/claim', route => {
    claims += 1
    return claims === 1 ? route.abort('connectionreset') : route.fulfill({ json: { clientId } })
  })
  await page.addInitScript(() => localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' })))
  await page.goto(`/invite?token=${token}&source=yandex`)
  await expect(page.getByRole('button', { name: 'Проверить подключение' })).toBeEnabled()
  expect(claims).toBe(0)
  await page.getByRole('button', { name: 'Проверить подключение' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(claims).toBe(1)
  await page.getByRole('button', { name: 'Проверить подключение' }).click()
  await expect(page.getByRole('heading', { name: 'Спортсмен подключён' })).toBeVisible()
  expect(claims).toBe(2)
  expect(await page.evaluate(() => sessionStorage.getItem('fit.pendingInvitationLink.v1'))).toBeNull()
  await page.screenshot({ path: testInfo.outputPath('claimed-link-recovered.png'), fullPage: true })
})

for (const lime of [false, true]) {
  test(`Yandex trainer display name refreshes in profile and chat (${lime ? 'lime' : 'mono'})`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
    const actorId = '22e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const clientId = '33e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const trainerId = '11e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const conversationId = '44e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    let displayName = 'Татьяна'
    let connectionsReads = 0
    let failConnections = false
    await page.route('https://stage.example.test/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: {
      'x-fit-request-id': 'synthetic-health', 'access-control-expose-headers': 'x-fit-request-id',
    } }))
    await page.route('https://stage.example.test/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
        accessMode: 'read_write', profile: { id: actorId, firstName: 'Тестовый клиент',
          lastName: null, timezone: 'Europe/Moscow', accountRole: 'client',
          client: { id: clientId, trainerId, fullName: 'Тестовый клиент' },
          experiments: { clientLime: lime, fitLime: false, trainerScheduleV2: false } },
      } })
      if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
      if (path === '/v1/clients') return route.fulfill({ json: { clients: [{
        id: clientId, canArchive: false, hasAccount: true, fullName: 'Тестовый клиент', canonicalFullName: 'Тестовый клиент',
        gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
        currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
      }] } })
      if (path === '/v1/me/finance') return route.fulfill({ json: { finance: { trainers: [] } } })
      if (path === '/v1/me/sport-profile') return route.fulfill({ json: { sport: { sports: [], bio: null } } })
      if (path === '/v1/chat/conversations') return route.fulfill({ json: { conversationId } })
      if (path === '/v1/connections') {
        connectionsReads += 1
        if (failConnections) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
        return route.fulfill({ json: { memberships: [{ clientId, trainerId, firstName: null, lastName: null,
          displayName, joinedAt: '2026-10-07T10:00:00Z', isRoot: true }], invitations: [] } })
      }
      if (path === '/v1/chat/threads') return route.fulfill({ json: { threads: [{
        conversationId, clientId, trainerId, partnerUserId: trainerId, partnerName: displayName,
        activeConnection: true, lastMessageBody: null, lastMessageAt: null, lastMessageSenderId: null,
        unreadCount: 0, canMessage: true, blockedByMe: false, blockedByPartner: false,
      }] } })
      if (path === `/v1/chat/conversations/${conversationId}/messages`) return route.fulfill({ json: { messages: [], nextCursor: null } })
      if (path === `/v1/chat/conversations/${conversationId}/connection`) return route.fulfill({ json: { state: {
        activeConnection: true, invitationPending: false, invitedAt: null, canInvite: false, canAccept: false, trainerSwitchRequired: false,
      } } })
      if (path === `/v1/chat/conversations/${conversationId}/unread`) return route.fulfill({ json: { unread: { firstMessageId: null, firstCreatedAt: null, unreadCount: 0 } } })
      if (path === '/v1/push/status') return route.fulfill({ json: { subscribed: false } })
      return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    })
    await page.addInitScript(id => {
      localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
      localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-assistant-2026-09']))
    }, actorId)
    await page.goto('/me/profile')
    await expect(page.locator('.client-trainer-connection-card')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(lime ? /fit-client-lime-document/ : /^(?!.*fit-client-lime-document)/)
    await page.screenshot({ path: testInfo.outputPath('trainer-name-initial.png'), fullPage: true })
    await expect(page.locator('.client-trainer-person strong')).toHaveText('Татьяна')
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 932 })
      await page.screenshot({ path: testInfo.outputPath(`trainer-name-profile-${width}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('link', { name: 'Настройки профиля' }).click()
    await expect(page).toHaveURL(/\/me\/settings$/)
    // URL changes before a cold lazy route commits. Wait until the profile really unmounts.
    await expect(page.locator('.client-trainer-connection-card')).toHaveCount(0)
    displayName = 'Татьяна Александровна Длинное Проверочное Имя'
    await page.goBack()
    await expect(page).toHaveURL(/\/me\/profile$/)
    await expect(page.locator('.client-trainer-person strong')).toHaveText(displayName)
    await page.screenshot({ path: testInfo.outputPath('trainer-name-renamed.png'), fullPage: true })
    expect(connectionsReads).toBeGreaterThan(1)
    await page.getByRole('button', { name: 'Написать' }).click()
    await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
    await expect(page.getByText('Напишите первое сообщение.', { exact: true })).toBeVisible()
    await expect(page.locator('.chat-conversation-page .error')).toHaveCount(0)
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 932 })
      await page.screenshot({ path: testInfo.outputPath(`trainer-name-chat-${width}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    failConnections = true
    await page.goBack()
    await expect(page.locator('.client-home-connections .error')).toBeVisible()
    failConnections = false
    await page.locator('.client-home-connections').getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.locator('.client-home-connections .error')).toHaveCount(0)
    await expect(page.locator('.client-trainer-person strong')).toHaveText(displayName)
  })
}

test.beforeEach(async ({ page }) => {
  legacyRequestCounts.set(page, 0)
  await page.route('**/v1/auth/yandex/link', route => {
    legacyRequestCounts.set(page, (legacyRequestCounts.get(page) ?? 0) + 1)
    return route.abort('connectionrefused')
  })
  await page.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):54321(?:\/|$)/, (route) => {
    legacyRequestCounts.set(page, (legacyRequestCounts.get(page) ?? 0) + 1)
    return route.abort('connectionrefused')
  })
})

test.afterEach(({ page }) => {
  expect(legacyRequestCounts.get(page), 'Yandex-only auth must not call Supabase or retired linking').toBe(0)
})

for (const role of ['trainer', 'client'] as const) {
  test(`Yandex goal stage deletion uses the selected version without other client progress (${role})`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
    const actorId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
    const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
    const otherClientId = '209cb508-16e2-4399-8dd0-bcadfd58818f'
    const goalId = 'a1013343-1267-49dc-8c4d-9ad99b709035'
    const stageId = 'cf07db27-7d46-401f-9412-70c929fb55be'
    const versions: number[] = []
    let progressReads = 0
    let otherProgressReads = 0
    let deleted = false
    let version = 7
    let releaseDelete: (() => void) | undefined
    await page.route('https://stage.example.test/health', (route) => route.fulfill({
      headers: { 'x-fit-request-id': 'synthetic-health', 'access-control-expose-headers': 'x-fit-request-id' }, json: { status: 'ok' },
    }))
    await page.route('https://stage.example.test/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
        accessMode: 'read_write', profile: { id: actorId, firstName: 'Synthetic trainer',
          lastName: null, timezone: 'Europe/Moscow', accountRole: role,
          ...(role === 'client' ? { client: { id: clientId, trainerId: actorId, fullName: 'Synthetic client' } } : {}),
        },
      } })
      if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
      if (path === '/v1/clients') return route.fulfill({ json: { clients: [clientId, otherClientId].map((id) => ({
        id, canArchive: true, hasAccount: false, fullName: 'Synthetic client', canonicalFullName: 'Synthetic client',
        gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
        currentWeightKg: null, lastActivityAt: '2026-10-01T00:00:00Z', archivedAt: null, version: 1, membershipVersion: 1,
      })) } })
      if (path === `/v1/clients/${clientId}/progress`) {
        progressReads += 1
        return route.fulfill({ json: { entries: [], customMetrics: [], goal: {
          id: goalId, clientId, title: 'Синтетическая цель', targetDate: null, status: 'active', version: 1, criteria: [],
          stages: deleted ? [] : [{ id: stageId, goalId, title: 'Первый этап', startsOn: '2026-10-01',
            endsOn: '2026-10-31', position: 0, version }],
        } } })
      }
      if (path === `/v1/clients/${otherClientId}/progress`) otherProgressReads += 1
      if (path === `/v1/goal-stages/${stageId}` && route.request().method() === 'DELETE') {
        const body = z.object({ expectedVersion: z.number().int().positive() }).parse(route.request().postDataJSON())
        versions.push(body.expectedVersion)
        await new Promise<void>((resolve) => { releaseDelete = resolve })
        if (body.expectedVersion !== version) return route.fulfill({ status: 409, json: { error: 'stage_conflict' } })
        deleted = true
        return route.fulfill({ json: { stage: { id: stageId, deleted: true } } })
      }
      return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    })
    await page.goto(role === 'client' ? '/me/goal' : `/clients/${clientId}/goal`)
    const stage = page.locator('.stage-row').filter({ hasText: 'Первый этап' })
    await expect(stage).toBeVisible()
    for (const width of role === 'client' ? [390, 430] : [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`goal-stage-${width}.png`), fullPage: true })
    }
    await page.evaluate(() => {
      localStorage.setItem('fit.appTheme', 'dark')
      window.dispatchEvent(new Event('fit-theme-change'))
    })
    await page.setViewportSize({ width: 390, height: 932 })
    await page.screenshot({ path: testInfo.outputPath('goal-stage-dark-390.png'), fullPage: true })
    const confirm = page.getByRole('alertdialog', { name: 'Удалить этап?' })
    await stage.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Отмена' }).click()
    expect(versions).toEqual([])
    const readsBeforeDelete = progressReads
    await stage.getByRole('button', { name: 'Удалить', exact: true }).click()
    version = 8
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect.poll(() => versions).toEqual([7])
    await expect(stage.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled()
    releaseDelete?.()
    await expect(stage.getByText('Данные уже изменились. Обновите страницу и повторите.')).toBeVisible()
    expect(deleted).toBe(false)
    expect(progressReads).toBe(readsBeforeDelete)
    expect(otherProgressReads).toBe(0)
    await page.reload()
    await expect(stage).toBeVisible()
    await stage.getByRole('button', { name: 'Удалить', exact: true }).click()
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect.poll(() => versions).toEqual([7, 8])
    releaseDelete?.()
    await expect(page.getByText('Этапов пока нет')).toBeVisible()
    expect(otherProgressReads).toBe(0)
  })
}

test('Yandex workout completion reads personal records once without paginated Progress', async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
    || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
    || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
  const actorId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
  const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
  const workoutId = '948d78c7-994c-4c21-b2fe-81efb2091854'
  const exerciseId = 'e2fc2c6d-0f33-4826-af68-46b0a5c79ff4'
  const token = 'a'.repeat(43)
  let recordReads = 0
  let progressReads = 0
  await page.route('https://stage.example.test/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
      accessMode: 'read_write', profile: { id: actorId, firstName: 'Synthetic trainer',
        lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
    } })
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
    if (path === '/v1/workouts/home') return route.fulfill({ json: { workouts: [] } })
    if (path.endsWith('/active-workout')) return route.fulfill({ json: { workout: null } })
    if (path === '/v1/training-data') return route.fulfill({ json: {
      accessMode: 'read_only', customExercises: [], attention: [], attentionPreferences: [],
      hasMoreWorkouts: false, totalWorkouts: 1, workouts: [{
        id: workoutId, trainerId: actorId, clientId, clientName: 'Synthetic client',
        createdBy: actorId, startedBy: null, completedBy: actorId,
        workoutDate: '2020-01-02', startTime: null, endTime: null, status: 'done',
        notes: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null,
        feedbackSubmittedAt: null, trainerReaction: null, trainerReview: null,
        trainerReviewAuthorId: null, trainerReviewedAt: null, clientQuestion: null,
        clientQuestionAskedAt: null, clientQuestionResolvedAt: null,
        startedAt: null, completedAt: '2020-01-02T12:00:00Z', hasPr: true, version: 1,
        exercises: [{ id: exerciseId, position: 0, source: 'system', ref: 'squat',
          customExerciseId: null, name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength',
          blockId: exerciseId, blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
          trainerComment: null, sets: [],
        }],
      }],
    } })
    if (path === `/v1/workouts/${workoutId}/personal-records`) {
      recordReads += 1
      expect(route.request().headers()['x-fit-session']).toBe(token)
      return route.fulfill({ json: { records: [{ exerciseRef: 'squat', exerciseName: 'Приседание',
        inputKind: 'strength', metric: 'weight_reps', primaryValue: 600, weightKg: 60, reps: 10 }] } })
    }
    if (path.includes('/progress/exercises/')) progressReads += 1
    return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
  })
  await page.addInitScript(({ sessionToken }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: sessionToken, expiresAt: '2099-01-01T00:00:00Z' }))
    history.replaceState({ usr: { justCompleted: true }, key: 'records-test', idx: 0 }, '')
  }, { sessionToken: token })
  await page.goto(`/workouts/${workoutId}`)
  const completion = page.getByRole('region', { name: 'Тренировка завершена' })
  await expect(completion.getByText('Личный рекорд · Приседание')).toBeVisible()
  await expect(completion.getByText('60 кг × 10 повт.')).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 932 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  expect(recordReads).toBe(1)
  expect(progressReads).toBe(0)
})

test('retired Supabase linking callback offers a fresh Yandex login without exchanging its code', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires native Yandex auth.')
  let authRequests = 0
  await page.route('https://stage.example.test/v1/auth/yandex/**', route => {
    authRequests += 1
    return route.abort('failed')
  })
  await page.addInitScript(() => {
    sessionStorage.setItem('fit.yandexIdPilot.oauthState', 'retired-state')
    sessionStorage.setItem('fit.yandexIdPilot.oauthVerifier', 'v'.repeat(43))
    sessionStorage.setItem('fit.yandexIdPilot.oauthIntent', 'link')
  })
  await page.goto('/auth/yandex/callback?code=retired-code&state=retired-state')
  await expect(page.getByText('Привязка через старую сессию больше недоступна. Начните вход через Yandex ID заново.').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Повторить вход' })).toHaveAttribute('href', '/auth')
  expect(new URL(page.url()).search).toBe('')
  expect(await page.evaluate(() => sessionStorage.getItem('fit.yandexIdPilot.oauthVerifier'))).toBeNull()
  expect(authRequests).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('retired-linking-callback.png'), fullPage: true })
})

test('Yandex-only entry has one primary action at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete default-off Yandex-only auth switches.',
  )

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/auth')

    await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Авторизация через Yandex ID' })).toBeVisible()
    await expect(page.getByRole('main', { name: 'Вход в Fit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass(/primary/)
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByLabel('Пароль')).toHaveCount(0)
    await expect(page.getByText('Забыли пароль?')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`yandex-only-entry-${viewport.width}.png`),
      fullPage: true,
    })

    if (viewport.width === 390) {
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'dark')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
      await expect(page.locator('html')).not.toHaveClass(/theme-light/)
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
      await page.screenshot({
        path: testInfo.outputPath('yandex-only-entry-dark-390.png'),
        fullPage: true,
      })
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'light')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
    }

    await page.goto('/auth/forgot')
    await expect(page).toHaveURL(/\/auth$/)
  }
})

for (const preference of ['light', 'dark'] as const) {
  for (const width of [390, 430, 1440]) {
    test(`Lime auth entry survives reopening ${preference} ${width}`, async ({ page }, testInfo) => {
      test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex-only auth lane.')
      await page.setViewportSize({ width, height: 844 })
      await page.emulateMedia({ colorScheme: preference })
      await page.route('**/v1/**', (route) => route.fulfill({ status: 503, json: { error: 'synthetic_no_real_api' } }))
      await page.addInitScript(({ preference, clientId }) => {
        localStorage.setItem('fit.appTheme', preference)
        localStorage.setItem('fit.clientLime.theme.', preference)
        localStorage.setItem(`fit.clientLime.theme.${clientId}`, preference)
      }, { preference, clientId })
      await page.goto('/auth', { waitUntil: 'domcontentloaded' })
      const entry = page.getByRole('main', { name: 'Вход в Fit' })
      await expect(entry).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await expect(page.locator('html')).not.toHaveClass(/theme-light/)
      const photo = page.locator('.lime-auth-photo')
      await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(940)
      await page.evaluate(async () => { await document.fonts.load('400 16px "YS Geo"'); await document.fonts.load('500 16px "YS Geo"') })
      if (process.env.FIT_LIME_FONTS_REQUIRED === 'true') expect(await page.evaluate(() => document.fonts.check('500 16px "YS Geo"'))).toBe(true)
      const welcome = page.getByRole('heading', { name: 'Добро пожаловать в ФИТ', exact: true })
      await expect(welcome.locator('.brand')).toHaveAttribute('src', '/fit-logo.svg')
      await expect(entry.locator('.brand')).toHaveCount(1)
      await expect(photo).toHaveCSS('object-fit', 'contain')
      await expect(photo).toHaveCSS('border-radius', '0px')
      const photoBox = (await photo.boundingBox())!
      const welcomeBox = (await welcome.boundingBox())!
      expect(welcomeBox.y - photoBox.y - photoBox.height).toBeGreaterThanOrEqual(16)
      expect(welcomeBox.y - photoBox.y - photoBox.height).toBeLessThanOrEqual(32)
      const action = page.getByRole('button', { name: 'Продолжить с Yandex ID' })
      await expect(action).toBeInViewport()
      await expect(action).toHaveCSS('font-family', /YS Geo/)
      await expect(action).toHaveCSS('min-height', '48px')
      await expect(action).toHaveCSS('border-radius', '999px')
      await action.focus()
      await expect(action).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await action.blur()
      await page.screenshot({ path: testInfo.outputPath(`auth-entry-${preference}-${width}.png`), fullPage: true })
      if (preference === 'light' && width === 390) {
        for (const viewport of [{ width: 375, height: 667 }, { width: 360, height: 568 }]) {
          await page.setViewportSize(viewport)
          await expect(welcome).toBeInViewport({ ratio: 1 })
          await expect(action).toBeInViewport({ ratio: 1 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: testInfo.outputPath(`auth-entry-short-${viewport.width}.png`), fullPage: true })
        }
        await page.setViewportSize({ width, height: 844 })
      }
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(entry).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      expect(await page.evaluate((id) => localStorage.getItem(`fit.clientLime.theme.${id}`), clientId)).toBe(preference)
      expect(await page.evaluate(() => localStorage.getItem('fit.appTheme'))).toBe(preference)
      const reopened = await page.context().newPage()
      await reopened.goto('/auth', { waitUntil: 'domcontentloaded' })
      await expect(reopened.getByRole('main', { name: 'Вход в Fit' })).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await reopened.close()
      await photo.evaluate((image: HTMLImageElement) => image.dispatchEvent(new Event('error')))
      await expect(photo).toBeHidden()
      await expect(action).toBeEnabled()
      await expect(page.getByRole('link', { name: 'Условия использования' })).toHaveAttribute('href', '/legal/terms')
      await page.getByRole('link', { name: 'Конфиденциальность' }).click()
      await expect(page).toHaveURL(/\/legal\/privacy$/)
      await page.goBack({ waitUntil: 'domcontentloaded' })
      await expect(entry).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    })
  }
}

test('Lime auth entry stays dark after client logout without changing its saved theme', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex-only auth lane.')
  await page.setViewportSize({ width: 390, height: 844 })
  let revocations = 0
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: { 'x-fit-request-id': 'synthetic-logout-health', 'access-control-expose-headers': 'x-fit-request-id' } }))
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/auth/yandex/session') {
      if (route.request().method() === 'DELETE') {
        revocations += 1
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({ json: { accessMode: 'read_write', profile: {
        id: clientId, firstName: 'Тестовый спортсмен', lastName: null, timezone: 'Europe/Moscow', accountRole: 'client',
        client: { id: clientId, trainerId: '10000000-0000-4000-8000-000000000001', fullName: 'Тестовый спортсмен' },
        experiments: { clientLime: true, fitLime: false, trainerScheduleV2: false },
      } } })
    }
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-10-01T00:00:00Z' } })
    if (path === '/v1/clients') return route.fulfill({ json: { clients: [] } })
    return route.fulfill({ status: 503, json: { error: 'synthetic_no_real_api' } })
  })
  await page.addInitScript((id) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 's'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    // This is a returning athlete, as in the shared pilot fixtures. Its old
    // Assistant intro must not cover the settings logout target in CI.
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-assistant-2026-09']))
    localStorage.setItem('fit.appTheme', 'light')
    localStorage.setItem(`fit.clientLime.theme.${id}`, 'light')
  }, clientId)
  await page.goto('/me/settings')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.getByRole('main', { name: 'Вход в Fit' })).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  expect(await page.evaluate(() => localStorage.getItem('fit.yandexAppSession.v1'))).toBeNull()
  await expect.poll(() => revocations).toBe(1)
  expect(await page.evaluate((id) => localStorage.getItem(`fit.clientLime.theme.${id}`), clientId)).toBe('light')
  await page.screenshot({ path: testInfo.outputPath('auth-entry-after-logout.png'), fullPage: true })
  const reopened = await page.context().newPage()
  await reopened.goto('/auth', { waitUntil: 'domcontentloaded' })
  await expect(reopened.getByRole('main', { name: 'Вход в Fit' })).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await reopened.close()
})

test('Lime auth entry keeps pending and error actions readable without its photo', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex-only auth lane.')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    Object.defineProperty(crypto.subtle, 'digest', { value: () => new Promise((_resolve, reject) => {
      window.addEventListener('test-pkce-reject', () => reject(new Error('synthetic PKCE error')), { once: true })
    }) })
  })
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Продолжить с Yandex ID' }).click()
  await expect(page.getByRole('button', { name: 'Переходим в Yandex ID…' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('auth-entry-pending.png'), fullPage: true })
  await page.evaluate(() => window.dispatchEvent(new Event('test-pkce-reject')))
  await expect(page.getByRole('alert')).toHaveText('Не удалось начать вход через Yandex ID.')
  await expect(page.getByRole('alert')).toHaveCSS('color', 'rgb(240, 160, 160)')
  await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeEnabled()
  await page.locator('.lime-auth-photo').evaluate((image: HTMLImageElement) => image.dispatchEvent(new Event('error')))
  await expect(page.locator('.lime-auth-photo')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('auth-entry-error-no-photo.png'), fullPage: true })
})

test('restored Yandex session completes the legal check after reload', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex-only session switches.',
  )
  const token = 'a'.repeat(43)
  let legalRequests = 0
  await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessMode: 'read_write',
        profile: {
          id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
          firstName: 'Ирина',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'trainer',
        },
      }),
    })
  })
  await page.route('https://stage.example.test/v1/legal/acceptance', async (route) => {
    legalRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applicable: true, accepted: false, acceptedAt: null }),
    })
  })
  await page.addInitScript(([sessionToken]) => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: sessionToken,
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  }, [token])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
  await expect(page.getByText('Проверяем документы…')).toHaveCount(0)
  expect(legalRequests).toBe(2)
})

test('Yandex restore exits loading after a network error and offers retry', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex-only session switches.',
  )
  await page.route('https://stage.example.test/v1/auth/yandex/session', (route) => route.abort('connectionrefused'))
  await page.route('https://stage.example.test/health', (route) => route.abort('connectionrefused'))
  await page.addInitScript(() => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: 'a'.repeat(43),
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  })
  await page.goto('/')
  await expect(page.locator('.fit-startup-photo')).toHaveCount(0, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.getByRole('button', { name: /Повторить/ })).toBeVisible()
})

for (const path of ['/', '/auth', '/auth/yandex/session']) {
  test(`photograph bridges bootstrap and session restoration on ${path}`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex session switches.')
    let releaseSession!: () => void
    const sessionReady = new Promise<void>((resolve) => { releaseSession = resolve })
    let releaseLegal!: () => void
    let legalRequested = false
    const legalReady = new Promise<void>((resolve) => { releaseLegal = resolve })
    await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
      await sessionReady
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessMode: 'read_write',
          profile: {
            id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
            firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer',
          },
        }),
      })
    })
    await page.route('https://stage.example.test/v1/legal/acceptance', async (route) => {
      legalRequested = true
      await legalReady
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ applicable: true, accepted: false, acceptedAt: null }),
      })
    })
    await page.addInitScript(() => localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: 'a'.repeat(43), expiresAt: '2099-09-01T12:00:00.000Z',
    })))
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#fit-startup-shell')).toHaveCount(0)
      const splash = page.getByRole('status', { name: 'Загружаем Fit' })
      await expect(splash).toBeVisible()
      const photo = splash.locator('img')
      await expect(photo).toBeVisible()
      await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(940)
      await expect(page.getByText(/Восстанавливаем сессию/)).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('session-photo.png') })
      releaseSession()
      await expect.poll(() => legalRequested).toBe(true)
      await expect(splash).toBeVisible()
      await expect(page.getByText('Проверяем документы…')).toHaveCount(0)
      releaseLegal()
      await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
      await expect(page.locator('.fit-startup-photo')).toHaveCount(0)
    } finally {
      releaseSession()
      releaseLegal()
    }
  })
}

for (const theme of ['dark', 'light']) {
  for (const width of [390, 430, 1440]) {
    test(`Lime registration ${theme} ${width}: role, validation, pending, error and back`, async ({ page }, testInfo) => {
      test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex auth lane.')
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      let registrations = 0
      let release!: () => void
      const pending = new Promise<void>((resolve) => { release = resolve })
      await page.route('https://stage.example.test/v1/auth/yandex/session', (route) => route.fulfill({ status: 409, json: {
        error: 'yandex_identity_unlinked', handoff: { token: 'h'.repeat(43), expiresAt: '2099-09-19T12:10:00.000Z' },
      } }))
      await page.route('https://stage.example.test/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: { 'x-fit-request-id': 'synthetic-registration-health', 'access-control-expose-headers': 'x-fit-request-id' } }))
      await page.route('https://stage.example.test/v1/auth/yandex/complete-registration', async (route) => {
        registrations += 1
        expect(route.request().postDataJSON()).toMatchObject({ accountRole: 'client', firstName: 'Тестовый спортсмен' })
        await pending
        await route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
      })
      await page.addInitScript((appearance) => {
        localStorage.setItem('fit.clientLime.theme.', appearance)
        sessionStorage.setItem('fit.yandexIdPilot.oauthState', 'test-state')
        sessionStorage.setItem('fit.yandexIdPilot.oauthVerifier', 'v'.repeat(64))
        sessionStorage.setItem('fit.yandexIdPilot.oauthIntent', 'app')
      }, theme)
      await page.goto('/auth/yandex/callback?code=test-code&state=test-state')
      const form = page.getByRole('main', { name: 'Регистрация' })
      await expect(form).toBeVisible()
      await expect(page.getByRole('button', { name: 'Да, был аккаунт' })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Email старого аккаунта' })).toHaveCount(0)
      await expect(form.getByRole('radio', { name: 'Я тренер' })).toBeChecked()
      await expect(page.locator('html')).toHaveClass(/fit-client-lime-document/)
      await expect(page.locator('html')).toHaveClass(theme === 'light' ? /theme-light/ : /^(?!.*theme-light)/)
      const image = form.locator('.lime-registration-photo')
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(940)
      if (process.env.FIT_LIME_FONTS_REQUIRED === 'true') {
        await page.evaluate(async () => { await document.fonts.load('400 16px "YS Geo"'); await document.fonts.load('500 16px "YS Geo"') })
        expect(await page.evaluate(() => document.fonts.check('500 16px "YS Geo"'))).toBe(true)
      }
      await page.screenshot({ path: testInfo.outputPath(`registration-${theme}-${width}.png`), fullPage: true })
      await form.getByRole('radio', { name: 'Я спортсмен' }).click()
      await form.getByRole('button', { name: 'Создать аккаунт' }).click()
      expect(registrations).toBe(0)
      const name = form.getByRole('textbox', { name: 'Имя' })
      await name.fill('А')
      expect(await name.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false)
      await name.fill('А'.repeat(120))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await name.fill('Тестовый спортсмен')
      await expect(image).toHaveCSS('height', '84px')
      await page.setViewportSize({ width, height: 420 })
      await form.getByRole('button', { name: 'Создать аккаунт' }).scrollIntoViewIfNeeded()
      await expect(form.getByRole('button', { name: 'Создать аккаунт' })).toBeInViewport()
      await page.setViewportSize({ width, height: 844 })
      await form.getByRole('button', { name: 'Назад' }).click()
      await expect(page).toHaveURL(/\/auth$/)
      await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toBeVisible()
      await expect(page.getByRole('main', { name: 'Вход в Fit' })).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await expect(page.locator('html')).toHaveClass(/fit-client-lime-document/)
      expect(registrations).toBe(0)
      await page.goto('/auth/yandex/callback?code=test-code&state=test-state')
      await expect(form).toBeVisible()
      await expect(page.getByRole('button', { name: 'Да, был аккаунт' })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Email старого аккаунта' })).toHaveCount(0)
      await expect(form.getByRole('radio', { name: 'Я тренер' })).toBeChecked()
      await expect(form.getByRole('textbox', { name: 'Имя' })).toHaveValue('')
      await form.getByRole('radio', { name: 'Я спортсмен' }).click()
      await name.fill('Тестовый спортсмен')
      await form.getByRole('button', { name: 'Создать аккаунт' }).click()
      await expect(form.getByRole('button', { name: 'Создаём…' })).toBeDisabled()
      await expect(form.getByRole('button', { name: 'Назад' })).toBeDisabled()
      release()
      await expect(form.getByRole('alert')).toBeVisible()
      await expect(form.getByRole('button', { name: 'Создать аккаунт' })).toBeEnabled()
      expect(registrations).toBe(1)
      const metrics = await name.evaluate((el) => { const style = getComputedStyle(el); return { font: style.fontFamily, weight: style.fontWeight, size: style.fontSize, height: el.getBoundingClientRect().height, radius: style.borderRadius } })
      expect(metrics).toMatchObject({ font: expect.stringContaining('YS Geo'), weight: '400', size: '16px', height: 48, radius: '16px' })
      await expect(form.getByRole('button', { name: 'Создать аккаунт' })).toHaveCSS('border-radius', '999px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(form.getByRole('link', { name: 'Условия использования' })).toHaveAttribute('href', '/legal/terms')
      await expect(form.getByRole('link', { name: 'Политику конфиденциальности' })).toHaveAttribute('href', '/legal/privacy')
      await page.screenshot({ path: testInfo.outputPath(`registration-error-${theme}-${width}.png`), fullPage: true })
      await image.evaluate((el: HTMLImageElement) => el.dispatchEvent(new Event('error')))
      await expect(image).toBeHidden()
      await expect(form.getByRole('textbox', { name: 'Имя' })).toBeVisible()
      await page.addInitScript(() => sessionStorage.setItem('fit.auth.invitationReturn.v1', JSON.stringify({ path: '/join?code=AB12CD34EF56', savedAt: Date.now() })))
      await page.goto('/auth/yandex/callback?code=test-code&state=test-state')
      // A legacy code has no public role preview: do not guess its target role.
      await expect(form.getByRole('radio', { name: 'Я спортсмен' })).toBeEnabled()
      await expect(form.getByRole('radio', { name: 'Я тренер' })).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath(`registration-invitation-${theme}-${width}.png`), fullPage: true })
    })
  }
}

for (const theme of ['light', 'dark']) for (const status of ['planned', 'done'] as const) test(`Yandex detail separates adjacent supersets and anchors footer menu ${theme} ${status}`, async ({ page }, info) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  const actorId = 'c11e0000-6010-4000-8000-000000000001'
  await page.addInitScript(({ actorId, theme }) => localStorage.setItem(`fit.clientLime.theme.${actorId}`, theme), { actorId, theme })
  const source = { ...coachGestureWorkout(false, 7), status }
  source.exercises.forEach((exercise, index) => {
    if (index !== 4) {
      exercise.blockId = source.exercises[index < 2 ? 0 : index < 4 ? 2 : 5]!.id
      exercise.blockType = 'group'
      exercise.blockPreset = 'set'
      exercise.blockRounds = 3
    }
    exercise.name = `Длинное название упражнения для проверки суперсета и переноса строк ${index + 1}`
  })
  await mockPilot(page, { role: 'client', profileId: actorId, clientLime: true, fitLime: false, workouts: [source] })
  await page.goto(`/workouts/${source.id}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
  const blocks = page.locator('.exercise-block.view')
  await expect(blocks).toHaveCount(3)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 932 })
    const boxes = await blocks.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }))
    await page.screenshot({ path: info.outputPath(`blocks-${width}.png`), fullPage: true })
    expect(boxes[1]!.top - boxes[0]!.bottom).toBeGreaterThanOrEqual(8)
    expect(boxes[2]!.top - boxes[1]!.bottom).toBeGreaterThan(8)
    const trigger = page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true })
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const m = (await menu.boundingBox())!, t = (await trigger.boundingBox())!, nav = (await page.locator('.tab-bar').boundingBox())!
    await page.screenshot({ path: info.outputPath(`menu-${width}.png`) })
    expect(m.y + m.height).toBeLessThanOrEqual(t.y - 4)
    expect(Math.abs(m.x + m.width - t.x - t.width)).toBeLessThanOrEqual(1)
    expect(m.x).toBeGreaterThanOrEqual(8)
    expect(m.y).toBeGreaterThanOrEqual(0)
    expect(m.y + m.height).toBeLessThan(nav.y)
    await page.locator('.content').evaluate(el => { el.scrollTop -= 24 })
    await expect.poll(async () => { const moved = (await menu.boundingBox())!, anchor = (await trigger.boundingBox())!; return Math.abs(moved.y + moved.height - anchor.y + 6) }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})


test('Yandex trainer detail keeps automatic exercise menu placement', async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires production Yandex composition.')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const source = { ...coachGestureWorkout(), status: 'done' as const }
  await mockPilot(page, { role: 'trainer', profileId: source.trainerId, fitLime: false, workouts: [source] })
  await page.goto(`/workouts/${source.id}`)
  const trigger = page.getByRole('button', { name: `Действия с упражнением «${source.exercises[0]!.name}»`, exact: true })
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const m = (await menu.boundingBox())!, t = (await trigger.boundingBox())!
  expect(m.y).toBeGreaterThanOrEqual(t.y + t.height + 4)
  expect(Math.abs(m.x + m.width - t.x - t.width)).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})
