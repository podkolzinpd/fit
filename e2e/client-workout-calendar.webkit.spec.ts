import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const historyRow = {
  id: 'c1000000-0000-4000-8000-000000000001',
  client_id: '11111111-1111-4111-8111-111111111111',
  trainer_id: '22222222-2222-4222-8222-222222222222',
  client_name: 'Анна Смирнова',
  created_by: '92000000-0000-4000-8000-000000000029',
  workout_date: '2026-08-10',
  start_time: '18:00:00',
  end_time: '19:00:00',
  started_at: '2026-08-10T15:00:00Z',
  completed_at: '2026-08-10T16:00:00Z',
  status: 'done',
  notes: null,
  trainer_review: null,
  trainer_reaction: null,
  trainer_review_author_id: null,
  trainer_reviewed_at: null,
  client_comment: null,
  session_rpe: null,
  wellbeing: null,
  discomfort: false,
  has_pr: false,
  stage_id: null,
  stage_title: null,
  version: 1,
  total_count: 1,
  exercises: [],
}

test('client workout month calendar stays usable in iPhone WebKit', async ({ page }) => {
  await page.route('**/rest/v1/rpc/list_workouts', async (route) => {
    const body = route.request().postDataJSON() as { p_from?: string | null; p_to?: string | null }
    const visible = (!body.p_from || historyRow.workout_date >= body.p_from)
      && (!body.p_to || historyRow.workout_date <= body.p_to)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(visible ? [historyRow] : []) })
  })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/me/workouts')
  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByRole('grid', { name: 'История тренировок за Август 2026' })).toBeVisible()
  const day = page.getByRole('button', { name: '10 августа 2026 г., 1 тренировка' })
  await expect(day).toBeVisible()
  await day.click()
  await expect(page.locator('.client-history-calendar-selection')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Список' })).toHaveCSS('min-height', '44px')
})

const trainerId = '90000000-0000-4000-8000-000000000009'
const clientHistoryPath = `/clients/${historyRow.client_id}/workouts`
const detailPath = `/workouts/${historyRow.id}`
const fixtureExercise = {
  id: 'c2000000-0000-4000-8000-000000000001', position: 0,
  exercise_source: 'system', exercise_ref: 'plank', custom_exercise_id: null,
  exercise_name: 'Планка с длительным удержанием и контролем положения корпуса',
  muscle_group: 'core', input_kind: 'timed', block_id: 'c3000000-0000-4000-8000-000000000001',
  block_type: 'single', block_preset: 'set', block_rounds: 1,
  rest_between_exercises_sec: 0, rest_between_rounds_sec: 0, rest_between_sets_sec: 60, trainer_comment: null,
}
const fixtureSet = {
  id: 'c4000000-0000-4000-8000-000000000001', workout_exercise_id: fixtureExercise.id, position: 0,
  plan_duration_sec: 60, fact_duration_sec: 60, confirmed_at: '2026-08-10T15:01:00Z', version: 1,
}

async function mockNavigationWorkouts(page: Page) {
  const state = { status: 'done', version: 1, deleted: false, createdId: historyRow.id, monthError: false, delayMonth: false, count: 1 }
  const row = () => ({ ...historyRow, id: state.createdId, trainer_id: trainerId, created_by: trainerId,
    status: state.status, version: state.version, workout_date: state.status !== 'done' ? '2026-08-16' : historyRow.workout_date,
    exercises: [{ ...fixtureExercise, sets: [fixtureSet] }],
  })
  await page.route('**/rest/v1/rpc/list_workouts', async (route) => {
    const body = route.request().postDataJSON() as { p_from?: string; p_to?: string; p_offset?: number; p_limit?: number }
    if (body.p_from && body.p_to && body.p_from.endsWith('-01')) {
      if (state.delayMonth) await new Promise((resolve) => setTimeout(resolve, 700))
      if (state.monthError) { await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test calendar unavailable"}' }); return }
    }
    const item = row()
    const visible = !state.deleted && (!body.p_from || item.workout_date >= body.p_from) && (!body.p_to || item.workout_date <= body.p_to)
    const rows = Array.from({ length: state.count }, (_, index) => ({ ...item, id: index === 0 ? item.id : `c1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }))
    const offset = body.p_offset ?? 0
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(visible ? rows.slice(offset, offset + (body.p_limit ?? 51)) : []) })
  })
  await page.route('**/rest/v1/workouts?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(row()) }))
  await page.route('**/rest/v1/workout_exercises?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([fixtureExercise]) }))
  await page.route('**/rest/v1/workout_sets?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([fixtureSet]) }))
  for (const rpc of ['list_latest_exercise_results', 'list_workout_personal_records', 'list_exercise_progress', 'list_workout_summaries']) {
    await page.route(`**/rest/v1/rpc/${rpc}`, (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  }
  for (const rpc of ['save_workout', 'save_completed_workout', 'record_planned_workout_result']) {
    await page.route(`**/rest/v1/rpc/${rpc}`, (route) => {
      const body = route.request().postDataJSON() as { p_workout: { id?: string } }
      state.createdId = body.p_workout.id ?? 'c1000000-0000-4000-8000-000000000002'
      state.version += 1
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.createdId) })
    })
  }
  await page.route('**/rest/v1/rpc/start_workout', (route) => {
    state.status = 'in_progress'; state.version += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.version) })
  })
  await page.route('**/rest/v1/rpc/finish_workout', (route) => {
    state.status = 'done'; state.version += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.version) })
  })
  await page.route('**/rest/v1/rpc/soft_delete_workout', (route) => {
    state.deleted = true
    return route.fulfill({ contentType: 'application/json', body: 'null' })
  })
  return state
}

async function loginForHistory(page: Page, role: 'trainer' | 'client') {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(`${role}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(role === 'trainer' ? /\/today$/ : /\/me$/)
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible()
  await dismissVisibleHints(page)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
}

async function dismissVisibleHints(page: Page) {
  const buttons = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true })
  while (await buttons.count()) await buttons.first().click()
}

async function dismissCalendarHint(page: Page) {
  if (!new URL(page.url()).pathname.startsWith('/clients/')) return
  const hint = page.locator('.coachmark-bubble').filter({ hasText: 'История по датам' })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Понятно' }).click()
  await dismissVisibleHints(page)
}

for (const role of ['trainer', 'client'] as const) {
  test(`${role}: Live exercise removal confirms, recovers and persists on reload`, async ({ page }, testInfo) => {
    const state = await mockNavigationWorkouts(page)
    state.status = 'in_progress'
    let deleted = false
    let fail = true
    let calls = 0
    await page.route('**/rest/v1/workout_exercises?*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify(deleted ? [] : [fixtureExercise]),
    }))
    await page.route('**/rest/v1/rpc/remove_live_exercise', async (route) => {
      calls += 1
      expect(route.request().postDataJSON()).toEqual({
        p_workout_id: historyRow.id, p_exercise_id: fixtureExercise.id, p_expected_version: state.version,
      })
      if (fail) {
        fail = false
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PT409', message: 'workout_conflict' }) })
      } else {
        deleted = true; state.version += 1
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.version) })
      }
    })
    await loginForHistory(page, role)
    await page.goto(`${detailPath}/live`)
    await page.locator('.live-exercise-collapsed').click()
    await page.locator('.live-exercise').getByRole('button', { name: 'Ещё действия', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('включая выполненные')
    for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
      await page.setViewportSize({ width, height: 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-delete-${width}.png`) })
    }
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(calls).toBe(0)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.locator('.live-exercise').getByRole('button', { name: 'Ещё действия', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click()
      await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
      if (attempt === 0) await expect(page.getByText(/Тренировка изменилась в другом окне/)).toBeVisible()
    }
    await expect(page.locator('.live-exercise')).toHaveCount(0)
    expect(calls).toBe(2)
    await page.reload()
    await expect(page.getByRole('button', { name: '＋ Ещё упражнение', exact: true })).toBeVisible()
    await expect(page.locator('.live-exercise, .live-exercise-collapsed')).toHaveCount(0)
  })
}

for (const role of ['trainer', 'client'] as const) {
  test(`${role}: completed exercise removal confirms, retries and persists on reload`, async ({ page }, testInfo) => {
    const state = await mockNavigationWorkouts(page)
    let deleted = false
    let fail = true
    let calls = 0
    await page.route('**/rest/v1/workout_exercises?*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify(deleted ? [] : [fixtureExercise]),
    }))
    await page.route('**/rest/v1/rpc/remove_live_exercise', async (route) => {
      calls += 1
      expect(route.request().postDataJSON()).toEqual({
        p_workout_id: historyRow.id, p_exercise_id: fixtureExercise.id, p_expected_version: state.version,
      })
      if (fail) {
        fail = false
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PT409', message: 'workout_conflict' }) })
      } else {
        deleted = true
        state.version += 1
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.version) })
      }
    })
    await loginForHistory(page, role)
    await page.goto(detailPath)
    const actions = page.getByRole('button', { name: `Действия с упражнением «${fixtureExercise.exercise_name}»` })
    await expect(actions).toBeVisible()
    await actions.click()
    await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('вместе со всеми подходами')
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
    const error = page.getByRole('alert').filter({ hasText: 'Не удалось удалить упражнение.' })
    await expect(error).toBeVisible()
    await error.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.locator('.completed-exercise')).toHaveCount(0)
    expect(calls).toBe(2)
    for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-completed-delete-${width}.png`), fullPage: true })
    }
    await page.reload()
    await expect(page.locator('.completed-exercise')).toHaveCount(0)
  })
}

for (const role of ['trainer', 'client'] as const) {
  test(`${role}: calendar and list Back preserve the source without duplicate screens`, async ({ page }, testInfo) => {
    await mockNavigationWorkouts(page)
    await loginForHistory(page, role)
    const path = role === 'trainer' ? clientHistoryPath : '/me/workouts'
    await page.goto(path)
    await dismissCalendarHint(page)
    await page.locator('.workout-chronicle-card').first().click()
    await expect(page).toHaveURL(detailPath)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(path)
    await page.locator('.workout-chronicle-card').first().click()
    await page.goBack()
    await expect(page).toHaveURL(path)
    await page.getByRole('button', { name: 'Календарь', exact: true }).click()
    await page.getByRole('button', { name: '10 августа 2026 г., 1 тренировка' }).click()
    const calendarUrl = page.url()
    const historyIndex = await page.evaluate(() => (window.history.state as { idx: number }).idx)
    await page.locator('.client-history-calendar-selection .workout-chronicle-card').click()
    await page.getByRole('link', { name: /История упражнения/ }).click()
    await expect(page.getByRole('heading', { name: 'Упражнение', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(detailPath)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(calendarUrl)
    expect(await page.evaluate(() => (window.history.state as { idx: number }).idx)).toBe(historyIndex)
    await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible()
    await page.reload()
    await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible()
    for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-calendar-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible()
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
    await page.goto(role === 'trainer' ? '/profile' : '/me/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).click()
    await page.goto(calendarUrl)
    await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible()
    for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-calendar-dark-${width}.png`), fullPage: true })
    }
  })
}

test('trainer: editing, copy and deletion do not reopen a submitted form', async ({ page }) => {
  await mockNavigationWorkouts(page)
  await loginForHistory(page, 'trainer')
  await page.goto(`${clientHistoryPath}?view=calendar&month=2026-08&date=2026-08-10`)
  await dismissCalendarHint(page)
  const source = page.url()
  await page.locator('.workout-chronicle-card').click()
  await page.getByRole('link', { name: 'Изменить результат' }).click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('link', { name: 'Изменить результат' }).click()
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(source)
  await page.locator('.workout-chronicle-card').click()
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL('/workouts/c1000000-0000-4000-8000-000000000002')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page).toHaveURL(source)
})

test('trainer: Live completion returns to the original detail, then its source', async ({ page }) => {
  const state = await mockNavigationWorkouts(page)
  state.status = 'planned'
  await loginForHistory(page, 'trainer')
  await page.goto('/schedule?date=2026-08-16')
  await page.locator(`a[href="${detailPath}"]`).first().click()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page).toHaveURL(`${detailPath}/live`)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('link', { name: 'Продолжить тренировку' }).click()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await expect(page.getByRole('region', { name: 'Тренировка завершена' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL('/schedule?date=2026-08-16')
})

test('trainer: direct detail link falls back to this client history', async ({ page }) => {
  await mockNavigationWorkouts(page)
  await loginForHistory(page, 'trainer')
  // New tab keeps authentication but has no preceding in-app route.
  const direct = await page.context().newPage()
  // page.route mocks do not apply to the new tab.
  await mockNavigationWorkouts(direct)
  await direct.goto(detailPath)
  await expect(direct.getByRole('heading', { name: 'Анна Смирнова', exact: true })).toBeVisible()
  await direct.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(direct).toHaveURL(clientHistoryPath)
  await direct.close()
})

test('trainer: calendar loading, retry, empty month and list pagination', async ({ page }) => {
  const state = await mockNavigationWorkouts(page)
  state.count = 22
  state.delayMonth = true
  await loginForHistory(page, 'trainer')
  await page.goto(clientHistoryPath)
  await dismissCalendarHint(page)
  await expect(page.locator('.workout-chronicle-card')).toHaveCount(20)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.locator('.workout-chronicle-card')).toHaveCount(22)
  await page.locator('.workout-chronicle-card').last().click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.locator('.workout-chronicle-card')).toHaveCount(22)
  state.monthError = true
  await page.getByRole('button', { name: 'Календарь', exact: true }).click()
  await expect(page.getByText('Загружаем месяц…')).toBeVisible()
  await expect(page.getByText('Не удалось загрузить историю за месяц.')).toBeVisible({ timeout: 15_000 })
  state.monthError = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await page.getByRole('button', { name: '10 августа 2026 г., 22 тренировки' }).click()
  await expect(page.locator('.client-history-calendar-selection .workout-chronicle-card')).toHaveCount(22)
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Список', exact: true })).toBeEnabled()
})

test('trainer: Today detail and direct Live keep Today as their source', async ({ page }) => {
  const state = await mockNavigationWorkouts(page)
  await loginForHistory(page, 'trainer')
  await page.reload()
  await page.locator(`a[href="${detailPath}"]`).first().click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL('/today')
  state.status = 'in_progress'
  await page.reload()
  await page.locator(`a[href="${detailPath}/live"]`).first().click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL('/today')
  await page.locator(`a[href="${detailPath}/live"]`).first().click()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page).toHaveURL(detailPath)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL('/today')
})

test('trainer: reload of finished Live does not pop past its detail', async ({ page }) => {
  const state = await mockNavigationWorkouts(page)
  state.status = 'planned'
  await loginForHistory(page, 'trainer')
  await page.goto('/schedule?date=2026-08-16')
  await page.locator(`a[href="${detailPath}"]`).first().click()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page).toHaveURL(`${detailPath}/live`)
  state.status = 'done'
  await page.reload()
  await expect(page).toHaveURL(detailPath)
  await expect(page.getByRole('region', { name: 'Тренировка завершена' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL('/schedule?date=2026-08-16')
})
