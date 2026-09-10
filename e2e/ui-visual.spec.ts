import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { comparisonWorkoutRow, mockResultsHistory, verifyResultsSources } from './progress-results-fixture'
import { expectMonochromeAccessibility } from './accessibility-helpers'

const demoClientId = '11111111-1111-4111-8111-111111111111'


async function mockProgressPeriodSummary(page: VisualPage, periodStart = '2026-08-01', periodEnd = '2026-08-31') {
  const clientSummary = {
    headline: 'В жиме лёжа рабочий вес вырос с 72 до 75 кг.',
    achievements: ['Жим лёжа выполнен в 2 сопоставимых тренировках.'],
    consistency: 'За период выполнено 2 тренировки.',
    encouragement: 'Рост рабочего веса уже подтверждён записями.',
    goal_alignment: '',
    next_steps: ['На следующей тренировке проверить 75 кг с тем же числом повторений.'],
  }
  const displayMetrics = {
    completed_workouts: 2, workouts_per_week: 0.5, active_weeks: 2, longest_gap_days: 7,
    progress_facts: [{ exercise_name: 'Жим лёжа', kind: 'strength', session_count: 2, changes: [
      { metric: 'max_weight', from: 72, to: 75, change_percent: 4, favorable: true },
    ] }],
  }
  await page.route('**/rest/v1/client_published_training_summaries?*', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{
      id: '80000000-0000-4000-8000-000000000001', source_summary_id: '80000000-0000-4000-8000-000000000002',
      client_id: demoClientId, period_start: periodStart, period_end: periodEnd, summary: clientSummary,
      display_metrics: displayMetrics, generated_at: `${periodEnd}T12:00:00Z`, published_at: `${periodEnd}T12:00:00Z`,
    }]),
  }))
  await page.route('**/rest/v1/client_training_summaries?*', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{
      id: '80000000-0000-4000-8000-000000000002', client_id: demoClientId,
      period_start: periodStart, period_end: periodEnd,
      trainer_summary: {
        headline: 'В жиме лёжа рабочий вес вырос с 72 до 75 кг.',
        progress: ['Жим лёжа выполнен в 2 сопоставимых тренировках.'],
        consistency: 'За период выполнено 2 тренировки.',
        attention: [],
      },
      client_summary: clientSummary, display_metrics: displayMetrics,
      generated_at: `${periodEnd}T12:00:00Z`, version: 1,
    }]),
  }))
}

async function mockPeriodComparison(page: VisualPage) {
  await mockProgressPeriodSummary(page)
  await page.route('**/rest/v1/rpc/list_workouts', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([
      comparisonWorkoutRow('81000000-0000-4000-8000-000000000001', '2026-07-05', 50, 5, 1),
      comparisonWorkoutRow('81000000-0000-4000-8000-000000000002', '2026-08-05', 60, 7, 2),
      comparisonWorkoutRow('81000000-0000-4000-8000-000000000003', '2026-08-12', 60, 7, 2),
    ]),
  }))
  await page.route('**/rest/v1/client_progress?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { id: '82000000-0000-4000-8000-000000000001', client_id: demoClientId, created_by: null, recorded_on: '2026-07-10', weight_kg: 60, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
    { id: '82000000-0000-4000-8000-000000000002', client_id: demoClientId, created_by: null, recorded_on: '2026-08-10', weight_kg: 61, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
  ]) }))
  await page.route('**/rest/v1/client_progress_custom?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
}

async function mockAutomaticSummaryGeneration(page: VisualPage) {
  const response = {
    contentType: 'application/json',
    body: JSON.stringify({ data: { generated_at: '2026-08-16T12:00:00Z' }, cached: true }),
  }
  await page.route('**/v1/legacy/summarize-client-training', (route) => route.fulfill(response))
  await page.route('**/functions/v1/summarize-client-training', (route) => route.fulfill(response))
}

test.beforeEach(async ({ page }) => {
  await mockAutomaticSummaryGeneration(page)
})

async function mockTrainerProgressVisual(page: VisualPage) {
  await mockPeriodComparison(page)
  await page.route('**/rest/v1/rpc/get_workout_regularity', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{
      period: 'week', period_start: '2026-08-10', period_end: '2026-08-16',
      planned_count: 2, completed_count: 4, completed_planned_count: 2,
      partial_count: 0, skipped_count: 0, completion_percent: 100,
    }]),
  }))
  await page.route('**/rest/v1/rpc/get_client_goal', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    id: '85000000-0000-4000-8000-000000000001', clientId: demoClientId,
    title: 'Вернуться к бегу', targetDate: null, status: 'active', version: 1, stages: [], criteria: [],
  }) }))
}

async function mockMeasurementProgress(page: VisualPage) {
  await mockProgressPeriodSummary(page)
  await page.route('**/rest/v1/rpc/get_client_goal', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    id: '86000000-0000-4000-8000-000000000001', clientId: demoClientId,
    title: 'Увеличить рабочий вес и сохранить талию', targetDate: null, status: 'active', version: 1, stages: [],
    criteria: [{ id: '86000000-0000-4000-8000-000000000002', goalId: '86000000-0000-4000-8000-000000000001', metric: 'weight', operation: 'increase_to', targetValue: 83, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1 }],
  }) }))
  await page.route('**/rest/v1/client_progress?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { id: '83000000-0000-4000-8000-000000000001', client_id: demoClientId, created_by: null, recorded_on: '2026-07-28', weight_kg: 80, chest_cm: 98, waist_cm: 82, hip_cm: 96, notes: null, version: 1 },
    { id: '83000000-0000-4000-8000-000000000002', client_id: demoClientId, created_by: null, recorded_on: '2026-08-05', weight_kg: 80.8, chest_cm: 99, waist_cm: 81, hip_cm: 96.5, notes: null, version: 1 },
    { id: '83000000-0000-4000-8000-000000000003', client_id: demoClientId, created_by: null, recorded_on: '2026-08-15', weight_kg: 81.4, chest_cm: 100, waist_cm: 80.5, hip_cm: 97, notes: null, version: 1 },
  ]) }))
  await page.route('**/rest/v1/client_custom_metrics?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { id: '84000000-0000-4000-8000-000000000001', client_id: demoClientId, name: 'Плечи', unit: 'см', position: 0, version: 1 },
  ]) }))
  await page.route('**/rest/v1/client_progress_custom?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { progress_id: '83000000-0000-4000-8000-000000000001', metric_id: '84000000-0000-4000-8000-000000000001', value: 112 },
    { progress_id: '83000000-0000-4000-8000-000000000002', metric_id: '84000000-0000-4000-8000-000000000001', value: 113 },
    { progress_id: '83000000-0000-4000-8000-000000000003', metric_id: '84000000-0000-4000-8000-000000000001', value: 114.5 },
  ]) }))
}

async function mockRegularityProgress(page: VisualPage) {
  await mockProgressPeriodSummary(page)
  const current = ['2026-08-03', '2026-08-10', '2026-08-12']
  const previous = ['2026-07-02', '2026-07-05', '2026-07-08', '2026-07-12', '2026-07-16', '2026-07-20', '2026-07-24', '2026-07-28']
  const rows = [...previous, ...current].map((date, index) => comparisonWorkoutRow(
    `87000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    date,
    50 + index,
    5,
    1,
  ))
  await page.route('**/rest/v1/rpc/list_workouts', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(rows),
  }))
}

type VisualPage = import('@playwright/test').Page
type VisualGotoOptions = Parameters<VisualPage['goto']>[1]

async function gotoStable(page: VisualPage, url: string, options?: VisualGotoOptions) {
  const protectedNavigation = !new URL(url, 'http://127.0.0.1').pathname.startsWith('/auth')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, options)
      await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 5_000 })
      if (protectedNavigation) {
        try {
          await page.locator('.phone-frame').waitFor({ state: 'attached', timeout: 5_000 })
        } catch (error) {
          const authRedirect = new URL(page.url()).pathname === '/auth'
          if (attempt < 2 && authRedirect) {
            await page.waitForTimeout(500 * (2 ** attempt))
            continue
          }
          throw error
        }
      }
      return
    } catch (error) {
      const browserInternal = error instanceof Error && error.message.includes('encountered an internal error')
      const emptyAppDocument = !browserInternal && await page.locator('#root > *').count() === 0
      // The pinned runtime can rarely reject a navigation internally or return
      // an empty document without throwing. Retry only those two browser-level
      // states once; populated application, network and assertion failures
      // still surface immediately.
      if (attempt > 1 || (!browserInternal && !emptyAppDocument)) throw error
      await page.waitForTimeout(100)
    }
  }
}

async function signIn(page: import('@playwright/test').Page, email: string, destination: RegExp) {
  await gotoStable(page, '/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  const submit = page.getByRole('button', { name: 'Войти' })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tokenResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/auth/v1/token?grant_type=password')
    ))
    await submit.click()
    const response = await tokenResponse

    if (response.ok()) {
      await expect(page).toHaveURL(destination, { timeout: 15_000 })
      return
    }

    const retryableUpstreamFailure = [502, 503, 504].includes(response.status())
    if (!retryableUpstreamFailure || attempt === 4) {
      await expect(page, `Sign-in returned HTTP ${response.status()}`).toHaveURL(destination, { timeout: 15_000 })
      return
    }

    await expect(submit).toBeEnabled()
    await page.waitForTimeout(500 * (2 ** attempt))
  }
}

async function removeScheduleVisualWorkouts(
  page: import('@playwright/test').Page,
  scheduleDate: string,
  clientName: string,
) {
  await gotoStable(page, `/schedule?date=${scheduleDate}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.schedule-selected-date span')).not.toHaveText('Загружаем…', { timeout: 15_000 })
  const workoutUrls = await page.locator('.day-grid-event').filter({ hasText: clientName }).evaluateAll((events) => (
    [...new Set(events.map((event) => event.getAttribute('href')).filter((href): href is string => Boolean(href)))]
  ))

  for (const workoutUrl of workoutUrls) {
    await gotoStable(page, workoutUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
    await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  }
}

async function mockRoleHomeWorkoutState(page: VisualPage) {
  const emptyRows = (route: import('@playwright/test').Route) => route.fulfill({
    contentType: 'application/json',
    body: '[]',
  })
  await page.route('**/rest/v1/rpc/list_workouts', emptyRows)
  await page.route('**/rest/v1/rpc/list_trainer_attention_workouts', emptyRows)
}

async function mockTrainerClients(page: VisualPage) {
  const names = ['Анна Смирнова', 'Борис Иванов', 'Вера Кузнецова', 'Глеб Орлов', 'Дарья Ершова', 'Егор Панов']
  await page.route('**/rest/v1/rpc/list_clients', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(names.map((fullName, index) => ({
      id: index === 0 ? demoClientId : `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      has_account: index === 0,
      full_name: fullName,
      canonical_full_name: fullName,
      gender: null,
      age_years: 25 + index,
      age_updated_at: '2026-08-01',
      height_cm: 170 + index,
      goal: null,
      note: null,
      current_weight_kg: 65 + index,
      last_activity_at: `2026-08-${String(16 - index).padStart(2, '0')}T10:00:00Z`,
      archived_at: null,
      version: 1,
      membership_version: 1,
    }))),
  }))
}

async function mockClientWorkoutHistory(page: import('@playwright/test').Page, options: { includeBack?: boolean; homeLayout?: boolean; bestResults?: boolean } = {}) {
  const workoutRows = ['2026-08-10', '2026-08-03'].map((workoutDate, index) => ({
    id: `b1000000-0000-4000-8000-00000000000${index + 1}`,
    client_id: demoClientId,
    trainer_id: '22222222-2222-4222-8222-222222222222',
    client_name: 'Анна Смирнова',
    created_by: '92000000-0000-4000-8000-000000000029',
    workout_date: workoutDate,
    start_time: '18:00:00',
    end_time: '19:00:00',
    started_at: `${workoutDate}T15:00:00Z`,
    completed_at: `${workoutDate}T16:00:00Z`,
    status: 'done',
    notes: null,
    trainer_review: index === 0 ? 'Отличная техника и ровный темп.' : null,
    trainer_reaction: index === 0 ? 'strong' : null,
    trainer_review_author_id: index === 0 ? '22222222-2222-4222-8222-222222222222' : null,
    trainer_reviewed_at: index === 0 ? `${workoutDate}T18:00:00Z` : null,
    client_comment: null,
    session_rpe: index === 0 ? 7 : 6,
    wellbeing: 'good',
    discomfort: false,
    has_pr: index === 0,
    stage_id: null,
    stage_title: null,
    version: 1,
    total_count: 2,
    exercises: [{
      id: `b2000000-0000-4000-8000-00000000000${index + 1}`,
      position: 0,
      exercise_source: 'system',
      exercise_ref: 'bench-press',
      custom_exercise_id: null,
      exercise_name: 'Жим лёжа',
      muscle_group: 'chest',
      input_kind: 'strength',
      block_id: `b2000000-0000-4000-8000-00000000000${index + 1}`,
      block_type: 'single',
      block_preset: 'set',
      block_rounds: 1,
      rest_between_exercises_sec: 0,
      rest_between_rounds_sec: 90,
      rest_between_sets_sec: 90,
      trainer_comment: null,
      sets: [{
        id: `b3000000-0000-4000-8000-00000000000${index + 1}`,
        position: 0,
        plan_weight_kg: 40,
        plan_reps: 10,
        plan_duration_min: null,
        plan_duration_sec: null,
        plan_distance_km: null,
        plan_rpe: null,
        fact_weight_kg: 40 + index * 5,
        fact_reps: 10,
        fact_duration_min: null,
        fact_duration_sec: null,
        fact_distance_km: null,
        fact_rpe: null,
        confirmed_at: `${workoutDate}T15:30:00Z`,
        version: 1,
      }],
    }],
  }))
  if (options.includeBack) workoutRows.forEach((workout, index) => workout.exercises.push({
    id: `b2100000-0000-4000-8000-00000000000${index + 1}`,
    position: 1,
    exercise_source: 'system',
    exercise_ref: 'lat-pulldown',
    custom_exercise_id: null,
    exercise_name: 'Тяга верхнего блока',
    muscle_group: 'back',
    input_kind: 'strength',
    block_id: `b2100000-0000-4000-8000-00000000000${index + 1}`,
    block_type: 'single',
    block_preset: 'set',
    block_rounds: 1,
    rest_between_exercises_sec: 0,
    rest_between_rounds_sec: 90,
    rest_between_sets_sec: 90,
    trainer_comment: null,
    sets: [{
      id: `b3100000-0000-4000-8000-00000000000${index + 1}`,
      position: 0,
      plan_weight_kg: 35,
      plan_reps: 10,
      plan_duration_min: null,
      plan_duration_sec: null,
      plan_distance_km: null,
      plan_rpe: null,
      fact_weight_kg: options.bestResults && index === 0 ? 40 : 35,
      fact_reps: 10,
      fact_duration_min: null,
      fact_duration_sec: null,
      fact_distance_km: null,
      fact_rpe: null,
      confirmed_at: `${workout.workout_date}T15:45:00Z`,
      version: 1,
    }],
  }))
  if (options.bestResults) {
    workoutRows[0]!.exercises[0]!.sets[0]!.fact_weight_kg = 45
    workoutRows[1]!.exercises[0]!.sets[0]!.fact_weight_kg = 40
    for (const [position, ref, name, group, currentWeight, previousWeight] of [
      [2, 'lateral-raise', 'Разведение гантелей в стороны', 'shoulders', 16, 14],
      [3, 'barbell-squat', 'Присед со штангой', 'legs', 80, 75],
    ] as const) workoutRows.forEach((workout, index) => {
      const base = workout.exercises[0]!
      workout.exercises.push({ ...base, id: `${workout.id}-${ref}`, exercise_ref: ref, exercise_name: name, muscle_group: group, position,
        block_id: `${workout.id}-${ref}-block`, sets: base.sets.map((set) => ({ ...set, id: `${workout.id}-${ref}-set`, fact_weight_kg: index === 0 ? currentWeight : previousWeight })) })
    })
  }
  if (options.homeLayout) {
    const workout = workoutRows[0]!
    workout.exercises[0]!.exercise_name = 'Жим гантелей лёжа на скамье с длинным названием'
    workout.exercises[0]!.sets[0]!.fact_weight_kg = 50
    for (const [index, name, group] of [[3, 'Разгибание ног', 'legs'], [4, 'Скручивания', 'core'], [5, 'Бег', 'cardio']] as const) {
      const base = workout.exercises[0]!
      workout.exercises.push({ ...base, id: `b2100000-0000-4000-8000-00000000000${index}`, exercise_ref: `home-${index}`,
        exercise_name: name, muscle_group: group, position: index,
        sets: base.sets.map((set) => ({ ...set, id: `b3100000-0000-4000-8000-00000000000${index}` })) })
    }
  }
  await page.route('**/rest/v1/workouts?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id')?.replace(/^eq\./, '')
    const row = workoutRows.find((item) => item.id === id)
    return row ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(row) }) : route.fallback()
  })
  await page.route('**/rest/v1/workout_exercises?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('workout_id')?.replace(/^eq\./, '')
    const row = workoutRows.find((item) => item.id === id)
    return row ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(row.exercises) }) : route.fallback()
  })
  await page.route('**/rest/v1/workout_sets?*', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('workout_exercise_id') ?? ''
    const exercises = workoutRows.flatMap((item) => item.exercises).filter((item) => ids.includes(item.id))
    return exercises.length ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(exercises.flatMap((item) => item.sets.map((set) => ({ ...set, workout_exercise_id: item.id })))) }) : route.fallback()
  })
  await page.route('**/rest/v1/rpc/list_workouts', async (route) => {
    const body = route.request().postDataJSON() as { p_from?: string | null; p_to?: string | null; p_offset?: number }
    const filtered = workoutRows.filter((workout) => (
      (!body.p_from || workout.workout_date >= body.p_from)
      && (!body.p_to || workout.workout_date <= body.p_to)
    ))
    const offset = body.p_offset ?? 0
    const rows = filtered.slice(offset).map((workout) => ({ ...workout, total_count: filtered.length }))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) })
  })
}

async function openClientProgress(page: import('@playwright/test').Page, options: { scheme?: boolean, dark?: boolean } = {}) {
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  if (options.scheme || options.dark) {
    await gotoStable(page, '/me/profile')
    if (options.scheme) {
      const schemeOption = page.getByRole('radio', { name: 'Схема' })
      await schemeOption.click()
      await expect(schemeOption).toHaveAttribute('aria-checked', 'true')
    }
    if (options.dark) {
      const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
      await darkTheme.check()
      await expect(darkTheme).toBeChecked()
    }
  }
  await gotoStable(page, '/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/progress-identity/)
  await expect(page.locator('.client-progress-card')).toBeVisible()
  await expect(page.locator('.client-progress-card .client-current-week')).toBeVisible()
  await expect(page.getByText('Проверяем данные цели…')).toHaveCount(0)
}

async function expectClientFactsOrder(page: VisualPage) {
  await expect(page.locator('.client-progress-card').evaluate((element) => {
    const order = ['.progress-story-period', '.client-current-week', '.client-progress-goal-story', '.period-exercise-results', '.client-progress-measurements-story', '.client-body-map-disclosure', '.weekly-training-load', '.period-rhythm', '.client-progress-comparison']
    const children = Array.from(element.children)
    const positions = order.map((selector) => children.findIndex((child) => child.matches(selector)))
    return positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1]!))
  })).resolves.toBe(true)
}

async function expectVisualBaseline(
  page: import('@playwright/test').Page,
  name: string,
  mask: import('@playwright/test').Locator[] = [],
  fullPage = false,
  maskColor = '#f8f5ef',
) {
  await expectMonochromeAccessibility(page)
  await expect(page.locator('.skeleton-block')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    mask,
    maskColor,
    maxDiffPixelRatio: 0.03,
  })
}

async function expectBodyMapBaseline(map: import('@playwright/test').Locator, name: string) {
  const previousScrollTop = await map.evaluate(() => document.querySelector<HTMLElement>('.content')?.scrollTop ?? 0)
  await map.scrollIntoViewIfNeeded()
  await expect(map.locator('.body-progress-visual')).not.toHaveClass(/discovering/, { timeout: 3_000 })
  try {
    await expect(map).toHaveScreenshot(name, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.015,
      stylePath: 'e2e/visual-body-map.css',
    })
  } finally {
    await map.evaluate((_element, scrollTop) => {
      const content = document.querySelector<HTMLElement>('.content')
      if (content) content.scrollTop = scrollTop
    }, previousScrollTop)
  }
}

async function createStandaloneClient(
  page: import('@playwright/test').Page,
  projectName: string,
  name = 'Визуальный клиент',
  emailPrefix = 'visual-client',
) {
  await gotoStable(page, '/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill(name)
  await page.getByLabel('Email').fill(`${emailPrefix}-${projectName}-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть' }).click()
}

async function openPreviewLiveWorkout(page: import('@playwright/test').Page, fresh = false) {
  await page.clock.install({ time: new Date('2026-08-29T18:00:00+03:00') })
  if (fresh) await createStandaloneClient(page, 'live-notes', 'Live клиент')
  else await signIn(page, 'client@fit.local', /\/me$/)

  await gotoStable(page, '/me/workouts')
  const activeWorkout = page.getByRole('link', { name: /Идёт/ }).first()
  const addAction = page.getByRole('link', { name: /^(?:Добавить|Добавить тренировку)$/ })
  await expect(addAction).toBeVisible()
  if (await activeWorkout.isVisible()) {
    await activeWorkout.click()
    await page.getByRole('link', { name: 'Продолжить тренировку' }).click()
    await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
    await page.keyboard.press('Escape')
    return
  }
  await expect(addAction).toHaveCount(1)
  await addAction.click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

test('visual sign-in retries a transient local auth gateway failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'One profile is enough to verify the shared sign-in helper')
  let tokenRequests = 0
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    tokenRequests += 1
    if (tokenRequests === 1) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'An invalid response was received from the upstream server' }),
      })
      return
    }
    await route.continue()
  })

  await gotoStable(page, '/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  const successfulRetry = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/auth/v1/token?grant_type=password')
    && response.ok()
  ))
  await page.getByRole('button', { name: 'Войти' }).click()
  await successfulRetry
  await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 })
  expect(tokenRequests).toBe(2)

  let linkedClientRequests = 0
  await page.route('**/rest/v1/clients?*', async (route) => {
    linkedClientRequests += 1
    if (linkedClientRequests === 1) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'An invalid response was received from the upstream server' }),
      })
      return
    }
    await route.continue()
  })
  await gotoStable(page, '/profile')
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  expect(linkedClientRequests).toBeGreaterThanOrEqual(2)
})

test('auth family keeps light and dark visual baselines', async ({ page }) => {
  await gotoStable(page, '/auth')
  await expect(page.locator('.auth-flow-identity')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expectVisualBaseline(page, `auth-login-${process.platform}.png`, [], true)

  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
  await expectVisualBaseline(page, `auth-register-${process.platform}.png`, [], true)

  await gotoStable(page, '/auth/reset')
  await expect(page.getByRole('heading', { name: 'Новый пароль' })).toBeVisible()
  await expectVisualBaseline(page, `auth-reset-${process.platform}.png`, [], true)

  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await gotoStable(page, '/auth/forgot')
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible()
  await expectVisualBaseline(page, `auth-forgot-dark-${process.platform}.png`, [], true, '#111214')

  await gotoStable(page, '/auth')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await expectVisualBaseline(page, `auth-login-dark-${process.platform}.png`, [], true, '#111214')

  await gotoStable(page, '/auth/callback')
  await expect(page.getByRole('heading', { name: 'Завершаем вход' })).toBeVisible()
  await expectVisualBaseline(page, `auth-callback-dark-${process.platform}.png`, [], true, '#111214')
})

test('Join keeps manual and invitation states in the auth family', async ({ page }) => {
  await signIn(page, 'client@fit.local', /\/me$/)
  await gotoStable(page, '/join')
  await expect(page.locator('.phone-frame')).toHaveClass(/auth-join-identity/)
  await expect(page.getByRole('heading', { name: 'Введите код приглашения' })).toBeVisible()
  await expectVisualBaseline(page, `auth-join-${process.platform}.png`, [], true)

  await gotoStable(page, '/join?code=ABCDEF123456')
  await expect(page.getByRole('heading', { name: 'Тренер пригласил вас в Fit' })).toBeVisible()
  await expectVisualBaseline(page, `auth-join-invitation-${process.platform}.png`, [], true)

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/join')
  await expect(page.locator('.phone-frame')).toHaveClass(/auth-join-identity/)
  await expect(page.locator('.tab-bar')).toHaveCSS('background-color', 'rgb(17, 18, 20)')
  await expect(page.locator('.tab-bar')).toHaveCSS('border-top-color', 'rgb(48, 49, 54)')
  await expectVisualBaseline(page, `auth-join-dark-${process.platform}.png`, [], true, '#111214')
})

test('current role home keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await mockRoleHomeWorkoutState(page)
  await signIn(page, trainer ? 'trainer@fit.local' : 'client@fit.local', trainer ? /\/today$/ : /\/me$/)
  // Фиксируем время только после auth: приветствие и недельный период не
  // должны менять committed screenshot в зависимости от часа запуска CI.
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, trainer ? '/today' : '/me')

  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  if (!trainer) {
    await expect(page.getByText('Загружаем прогресс недели…')).toHaveCount(0)
    await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)
  } else {
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/client-home-identity/)
    await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
    await expect(page.locator('.trainer-attention')).toBeVisible()
  }
  await expect(page.locator('.phone-frame')).toBeVisible()
  await expectVisualBaseline(page, trainer ? `trainer-today-${process.platform}.png` : 'role-home.png', [], true)

  if (!trainer) {
    await gotoStable(page, '/me/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await gotoStable(page, '/me')
    await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)
    await expectVisualBaseline(page, 'role-home-dark.png', [], true)
  } else {
    await page.getByRole('button', { name: 'Ввести текстом' }).click()
    await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
    await expectVisualBaseline(page, `trainer-today-composer-${process.platform}.png`, [], true)
    await gotoStable(page, '/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await gotoStable(page, '/today')
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
    await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
    await expectVisualBaseline(page, `trainer-today-dark-${process.platform}.png`, [], true, '#1d1e21')
  }
})

test('trainer Today keeps its mobile visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Trainer desktop is covered by the role-home baseline')
  await mockRoleHomeWorkoutState(page)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/today')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
  await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
  await expect(page.locator('.trainer-attention')).toBeVisible()
  await expectVisualBaseline(page, `trainer-today-mobile-${process.platform}.png`, [], true)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await expectVisualBaseline(page, `trainer-today-mobile-composer-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/today')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-today-identity/)
  await expect(page.locator('.trainer-attention-loading')).toHaveCount(0)
  await expectVisualBaseline(page, `trainer-today-mobile-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('future standalone plan stays compact on client home', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Home uses mobile visual profiles')
  await createStandaloneClient(page, `future-${testInfo.project.name}`)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/workouts/new?date=2026-08-17')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  // Дожидаемся сохранения: переход на Home раньше ответа может прервать запись.
  await expect(page).toHaveURL(/\/workouts\/[a-f0-9-]+$/)

  await gotoStable(page, '/me')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)
  await expect(page.getByRole('heading', { name: 'Следующая тренировка' })).toBeVisible()
  await expect(page.getByText('Завтра · без времени')).toBeVisible()
  await expect(page.getByRole('link', { name: /Следующая тренировка/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть план' })).toHaveCount(0)
  await expectVisualBaseline(page, 'client-home-future-plan.png', [], true)
})

test('client key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client routes use mobile visual profiles')
  await mockClientWorkoutHistory(page)
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await openClientProgress(page)
  await expect(page.locator('.client-body-map-disclosure')).not.toHaveAttribute('open')
  await page.locator('.client-body-map-disclosure > summary').click()
  const bodyMap = page.locator('.client-progress-card .body-progress-map')
  await expect(bodyMap).toBeVisible()
  await bodyMap.getByRole('button', { name: 'Прогресс', exact: true }).click()
  await expect(bodyMap.getByRole('heading', { name: 'Где выросли результаты' })).toBeVisible()
  await expect(bodyMap.getByText('Изменения по подтверждённым результатам упражнений')).toHaveCount(0)
  await expect(bodyMap.getByText('Лучший результат зоны')).toHaveCount(0)
  await expect(bodyMap.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).resolves.toBeGreaterThanOrEqual(16)
  await expectBodyMapBaseline(bodyMap, `client-body-map-female-${process.platform}.png`)
  await expect(page.locator('.client-current-week')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Текущая неделя' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Лучшие результаты за период' })).toBeVisible()
  await expect(page.getByText('Твоя цель', { exact: true })).toBeVisible()
  await expect(page.locator('.client-progress-main-now')).toHaveCount(0)
  await expect(page.locator('.progress-story-period').getByRole('button', { name: 'Открыть анализ' })).toBeVisible()
  await expectClientFactsOrder(page)
  const progressCoachmark = page.getByRole('button', { name: 'Понятно' })
  if (await progressCoachmark.isVisible()) await progressCoachmark.click()
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `client-progress-${process.platform}.png`)
})

test('exercise catalog and technique detail keep their visual baselines in both themes', async ({ page }) => {
  // Keep the catalog snapshot independent from custom exercises created by
  // behavior tests and from unrelated first-visit navigation coachmarks.
  await page.route('**/rest/v1/custom_exercises?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await gotoStable(page, '/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await page.keyboard.press('Escape')
  const search = page.getByLabel('Поиск упражнения')
  await search.fill('face pull')
  const result = page.locator('.catalog-media-card').first()
  await expect(result.locator('.exercise-image')).toBeVisible()
  await search.blur()
  await expectVisualBaseline(page, `exercise-catalog-${process.platform}.png`, [page.locator('.catalog-custom-results')], true)

  await result.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectVisualBaseline(page, `exercise-catalog-detail-${process.platform}.png`, [], true)
  await page.getByRole('dialog').locator('button.secondary').click()

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await page.getByLabel('Поиск упражнения').fill('face pull')
  await expect(page.locator('.catalog-media-card').first()).toBeVisible()
  await page.getByLabel('Поиск упражнения').blur()
  await expectVisualBaseline(page, `exercise-catalog-dark-${process.platform}.png`, [page.locator('.catalog-custom-results')], true, '#1d1e21')

  await page.locator('.catalog-media-card').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectVisualBaseline(page, `exercise-catalog-detail-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Profile and feedback keep their visual baselines in both themes', async ({ page }) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await gotoStable(page, '/profile')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-profile-${process.platform}.png`, [], true)

  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await expect(page.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-profile-feedback-${process.platform}.png`, [], true)
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `trainer-profile-dark-${process.platform}.png`, [], true, '#1d1e21')

  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await expect(page.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-profile-feedback-dark-${process.platform}.png`, [], true, '#1d1e21')
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('client Progress scheme keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await mockClientWorkoutHistory(page)
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await openClientProgress(page, { scheme: true })
  await page.locator('.client-body-map-disclosure > summary').click()
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectBodyMapBaseline(page.locator('.client-progress-card .body-progress-map'), `client-body-map-scheme-${process.platform}.png`)
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `client-progress-scheme-${process.platform}.png`)
})

test('client Progress scheme keeps its dark visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await mockClientWorkoutHistory(page)
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await openClientProgress(page, { scheme: true, dark: true })
  await page.locator('.client-body-map-disclosure > summary').click()
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectBodyMapBaseline(page.locator('.client-progress-card .body-progress-map'), `client-body-map-scheme-dark-${process.platform}.png`)
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `client-progress-scheme-dark-${process.platform}.png`)
})

test('client Progress shows composite goal facts in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await page.route('**/rest/v1/rpc/get_client_goal', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    id: 'a1000000-0000-4000-8000-000000000001', clientId: demoClientId,
    title: 'Держать вес и тренироваться регулярно', targetDate: null, status: 'active', version: 1, stages: [],
    criteria: [
      { id: 'a2000000-0000-4000-8000-000000000002', goalId: 'a1000000-0000-4000-8000-000000000001', metric: 'weight', operation: 'maintain_range', targetValue: null, rangeMin: 58.5, rangeMax: 59.5, unit: 'кг', baselineValue: null, baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1 },
      { id: 'a2000000-0000-4000-8000-000000000003', goalId: 'a1000000-0000-4000-8000-000000000001', metric: 'workout_regularity', operation: 'increase_to', targetValue: 2, rangeMin: null, rangeMax: null, unit: 'трен.', baselineValue: null, baselineRecordedOn: null, regularityPeriod: 'week', regularityMode: 'each_period', confirmationStatus: 'confirmed', position: 1, version: 1 },
    ],
  }) }))
  await page.route('**/rest/v1/client_progress?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { id: 'a4000000-0000-4000-8000-000000000004', client_id: demoClientId, created_by: null, recorded_on: '2026-08-15', weight_kg: 59, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
  ]) }))
  await page.route('**/rest/v1/client_progress_custom?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await openClientProgress(page)
  const goal = page.locator('.client-progress-goal-story')
  await expect(goal.locator('.goal-criterion-progress-row:visible')).toHaveCount(2)
  await expect(goal.getByText('2 показателя · каждый оценивается отдельно', { exact: true })).toHaveCount(0)
  await expect(goal.getByText(/из 2 выполнено/)).toHaveCount(0)
  await expect(goal.getByRole('button', { name: /критери/ })).toHaveCount(0)
  await goal.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expectVisualBaseline(page, `client-progress-composite-${process.platform}.png`, [], true)

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/me/progress')
  const darkGoal = page.locator('.client-progress-goal-story')
  await expect(darkGoal.locator('.goal-criterion-progress-row:visible')).toHaveCount(2)
  await darkGoal.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expectVisualBaseline(page, `client-progress-composite-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('period comparison stays compact for client and trainer in both themes', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  const initialViewport = page.viewportSize()
  await mockPeriodComparison(page)
  if (trainer) {
    await signIn(page, 'trainer@fit.local', /\/today$/)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await gotoStable(page, `/progress/${demoClientId}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  } else {
    await openClientProgress(page)
  }

  let comparison = page.locator('.client-progress-comparison')
  if (!trainer) await comparison.locator(':scope > summary').click()
  await expect(comparison.locator('.period-comparison-facts > div')).toHaveCount(trainer ? 3 : 8)
  if (trainer) await expect(comparison.getByText('июль → август 2026', { exact: true })).toBeVisible()
  await expect(comparison.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0)
  await expect(comparison.getByText('Главное изменение', { exact: true })).toHaveCount(0)
  if (trainer) await expect(comparison.locator('.period-comparison-limitation')).toHaveCount(1)
  if (trainer) await expect(comparison.getByText('Мало данных: в одном из периодов только 1 завершённая тренировка.', { exact: true })).toBeVisible()
  if (!trainer) await expectClientFactsOrder(page)
  else {
  expect(await comparison.evaluate((element) => {
    const map = document.querySelector('.client-body-map-disclosure') ?? document.querySelector('.body-progress-map')
    const summary = document.querySelector('.progress-story-summary')
    const client = Boolean(document.querySelector('.client-body-map-disclosure'))
    return Boolean(map && summary
      && (client ? summary.compareDocumentPosition(map) : map.compareDocumentPosition(element)) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(summary && element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  }
  expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (!trainer) {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    if (initialViewport) await page.setViewportSize(initialViewport)
  }
  await comparison.scrollIntoViewIfNeeded()
  await expect(comparison).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-period-comparison-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, trainer ? `/progress/${demoClientId}` : '/me/progress')
  comparison = page.locator('.client-progress-comparison')
  if (!trainer) await comparison.locator(':scope > summary').click()
  await expect(comparison.locator('.period-comparison-facts > div')).toHaveCount(trainer ? 3 : 8)
  await comparison.scrollIntoViewIfNeeded()
  await expect(comparison).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-period-comparison-dark-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })
})

test('measurement trends stay readable for client and trainer in both themes', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  const initialViewport = page.viewportSize()
  await mockMeasurementProgress(page)
  if (trainer) {
    await signIn(page, 'trainer@fit.local', /\/today$/)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await gotoStable(page, `/progress/${demoClientId}`)
  } else {
    await openClientProgress(page, { scheme: true })
  await page.locator('.client-body-map-disclosure > summary').click()
  }

  let measurements = page.locator('.client-progress-measurements-story')
  await expect(measurements.getByRole('heading', { name: trainer ? 'Тренд по значениям' : 'Замеры' })).toBeVisible()
  await expect(measurements.getByRole('tab', { name: /Вес/ })).toBeVisible()
  await expect(measurements.getByRole('tab', { name: /Плечи/ })).toBeVisible()
  await expect(measurements.getByLabel('График показателя «Вес»')).toBeVisible()
  await expect(measurements.getByText('Цель · 83 кг').first()).toBeVisible()
  await expect(measurements.locator('.recharts-tooltip-wrapper')).toHaveCount(0)
  await expect(measurements.getByText('5 августа 2026 г.', { exact: true })).toHaveCount(0)
  if (!trainer) await expectClientFactsOrder(page)
  else {
  expect(await measurements.evaluate((element) => {
    const comparison = document.querySelector('.client-progress-comparison')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(comparison && summary
      && (comparison.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
  }
  expect(await measurements.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await measurements.getByRole('tab', { name: /Вес/ }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  if (!trainer) {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await measurements.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    if (initialViewport) await page.setViewportSize(initialViewport)
  }
  await measurements.scrollIntoViewIfNeeded()
  await expect(measurements).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-measurement-trends-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, trainer ? `/progress/${demoClientId}` : '/me/progress')
  measurements = page.locator('.client-progress-measurements-story')
  await expect(measurements.getByRole('heading', { name: trainer ? 'Тренд по значениям' : 'Замеры' })).toBeVisible()
  await measurements.scrollIntoViewIfNeeded()
  await expect(measurements).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-measurement-trends-dark-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })
})

test('weekly training rhythm stays visual and readable for client and trainer in both themes', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  const initialViewport = page.viewportSize()
  await mockRegularityProgress(page)
  if (trainer) {
    await signIn(page, 'trainer@fit.local', /\/today$/)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await gotoStable(page, `/progress/${demoClientId}`)
  } else {
    await openClientProgress(page, { scheme: true })
  await page.locator('.client-body-map-disclosure > summary').click()
  }

  if (!trainer) await page.getByText('Регулярность тренировок', { exact: true }).click()
  let regularity = page.locator('.client-progress-regularity-story')
  await expect(regularity.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await expect(regularity.getByText(trainer ? '3 тренировки' : '6 тренировок', { exact: true })).toBeVisible()
  await expect(regularity.getByText(trainer ? 'Активные: 2 из 3' : 'Активные: 4 из 5', { exact: true })).toBeVisible()
  await expect(regularity.getByText('Серия', { exact: true })).toBeVisible()
  await expect(regularity.getByText(trainer ? '2 нед.' : '4 нед.', { exact: true })).toBeVisible()
  await expect(regularity.getByText('Интервал', { exact: true })).toBeVisible()
  await expect(regularity.getByText(trainer ? '4,5 дн.' : '4,6 дн.', { exact: true })).toBeVisible()
  await expect(regularity.getByText('Макс. перерыв', { exact: true })).toBeVisible()
  await expect(regularity.getByText('7 дн.', { exact: true })).toBeVisible()
  await expect(regularity.getByText('Регулярность', { exact: true })).toHaveCount(0)
  await expect(regularity.getByText('Частота к прошлому периоду', { exact: true })).toHaveCount(0)
  await expect(regularity.locator('.regularity-story-explanation')).toHaveCount(0)
  await expect(regularity.getByRole('list', { name: 'Завершённые тренировки по неделям' }).locator('li')).toHaveCount(trainer ? 3 : 5)
  await expect(regularity.locator('li[aria-label*="Нет записей"]')).toHaveCount(1)
  await expect(regularity.locator('li[aria-label*="Текущая неделя"]')).toHaveCount(0)
  if (!trainer) {
    await expectClientFactsOrder(page)
    expect(await regularity.evaluate((element) => element.clientWidth / element.parentElement!.clientWidth)).toBeGreaterThan(0.85)
  }
  else {
  expect(await regularity.evaluate((element) => {
    const measurements = document.querySelector('.client-progress-measurements-story')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(measurements && summary
      && (measurements.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
  }
  expect(await regularity.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (!trainer) {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await regularity.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    if (initialViewport) await page.setViewportSize(initialViewport)
  }
  await regularity.scrollIntoViewIfNeeded()
  await expect(regularity).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-workout-regularity-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, trainer ? `/progress/${demoClientId}` : '/me/progress')
  if (!trainer) await page.getByText('Регулярность тренировок', { exact: true }).click()
  regularity = page.locator('.client-progress-regularity-story')
  await expect(regularity.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await regularity.scrollIntoViewIfNeeded()
  await expect(regularity).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-workout-regularity-dark-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })
})

test('next-step suggestion stays off the main progress screen for client and trainer', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  const initialViewport = page.viewportSize()
  await mockMeasurementProgress(page)
  if (trainer) {
    await signIn(page, 'trainer@fit.local', /\/today$/)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await gotoStable(page, `/progress/${demoClientId}`)
  } else {
    await openClientProgress(page, { scheme: true })
  await page.locator('.client-body-map-disclosure > summary').click()
  }

  await expect(page.locator('.client-progress-next-step')).toHaveCount(0)
  await expect(page.getByText('Следующий шаг', { exact: true })).toHaveCount(0)
  if (!trainer) {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const measurementActions = page.getByRole('navigation', { name: 'Действия с замерами' })
      await measurementActions.scrollIntoViewIfNeeded()
      const [actionsBox, navigationBox] = await Promise.all([
        measurementActions.boundingBox(),
        page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox(),
      ])
      expect(actionsBox).not.toBeNull()
      expect(navigationBox).not.toBeNull()
      expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(navigationBox!.y)
    }
    if (initialViewport) await page.setViewportSize(initialViewport)
  }

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, trainer ? `/progress/${demoClientId}` : '/me/progress')
  await expect(page.locator('.client-progress-next-step')).toHaveCount(0)
  await expect(page.getByText('Следующий шаг', { exact: true })).toHaveCount(0)
})

test('client measurement management keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client measurement management uses mobile visual profiles')
  await mockMeasurementProgress(page)
  await openClientProgress(page, { scheme: true })
  const management = page.locator('.client-progress-measurements-story')
  await management.evaluate((element) => {
    element.scrollIntoView({ block: 'start' })
    const content = document.querySelector<HTMLElement>('.content')
    if (content) content.scrollTop = Math.max(0, content.scrollTop - 12)
  })
  await expect(management.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await expect(management.getByRole('button', { name: /История/ })).toBeVisible()
  await expect(management.getByRole('button', { name: /Настроить/ })).toBeVisible()
  await expect(management.locator('.measurement-story-management')).toBeVisible()
  await expect(page.locator('.client-progress-measurement')).toHaveCount(0)
  await expectVisualBaseline(page, `client-measurements-${process.platform}.png`)
})

test('client workouts keep their visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workouts use mobile visual profiles')
  await mockClientWorkoutHistory(page)
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/me/workouts')
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workouts-identity/)
  await expect(page.getByRole('heading', { name: 'История' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Календарь' })).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-${process.platform}.png`)

  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByRole('grid', { name: /История тренировок за/ })).toBeVisible()
  const calendarDate = page.locator('.client-history-calendar-day.has-workout button').first()
  await expect(calendarDate).toBeVisible()
  await calendarDate.click()
  await expect(page.locator('.client-history-calendar-selection')).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-calendar-${process.platform}.png`, [], true)

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/me/workouts')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-workouts-identity/)
  await expect(page.getByRole('heading', { name: 'История' })).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-dark-${process.platform}.png`)

  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByRole('grid', { name: /История тренировок за/ })).toBeVisible()
  const darkCalendarDate = page.locator('.client-history-calendar-day.has-workout button').first()
  await expect(darkCalendarDate).toBeVisible()
  await darkCalendarDate.click()
  await expect(page.locator('.client-history-calendar-selection')).toBeVisible()
  await expectVisualBaseline(page, `client-workouts-calendar-dark-${process.platform}.png`, [], true, '#1d1e21')

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('client Profile keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Profile uses mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await gotoStable(page, '/me/profile')
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-profile-shell-identity/)
  await expect(page.getByRole('link', { name: 'Изменить данные' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Вид карты тела' })).toBeVisible()
  await expectVisualBaseline(page, `client-profile-${process.platform}.png`)

  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await page.getByRole('form', { name: 'Напишите команде Fit' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('textbox', { name: 'Сообщение' })).toBeVisible()
  await expectVisualBaseline(page, `client-profile-feedback-${process.platform}.png`)
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-profile-shell-identity/)
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `client-profile-dark-${process.platform}.png`)
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('client card edit keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Card Edit uses mobile visual profiles')
  await signIn(page, 'client@fit.local', /\/me$/)
  await gotoStable(page, '/me/edit')
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/client-card-edit-identity/)
  await expect(page.getByLabel('Имя')).toHaveValue('Анна Смирнова')
  await expect(page.getByLabel('Цель')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
  await expectVisualBaseline(page, `client-card-edit-${process.platform}.png`, [], true)

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/me/edit')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-card-edit-identity/)
  await expectVisualBaseline(page, `client-card-edit-dark-${process.platform}.png`, [], true, '#1d1e21')

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

async function openWorkoutCreate(page: import('@playwright/test').Page, dark = false) {
  await signIn(page, 'client@fit.local', /\/me$/)
  await gotoStable(page, '/me/profile')
  const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
  if (dark) await darkTheme.check()
  else await darkTheme.uncheck()
  await gotoStable(page, '/workouts/new')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
}

async function addCompletedBenchPress(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Выбрать упражнения' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('60')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.locator('.workout-form-exercises').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Записать тренировку' })).toBeEnabled()
}

async function openWorkoutReview(page: import('@playwright/test').Page, trainer: boolean, dark = false) {
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Жим лёжа 3×10 — 60 кг',
          exerciseRef: 'bench-press',
          confidence: 1,
          sets: [{ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }],
        }],
        unmatched: [],
      }),
    })
  })
  await signIn(page, trainer ? 'trainer@fit.local' : 'client@fit.local', trainer ? /\/today$/ : /\/me$/)
  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
  if (dark) await darkTheme.check()
  else await darkTheme.uncheck()
  await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('fit.today-draft.'))
    .forEach((key) => localStorage.removeItem(key)))
  await gotoStable(page, trainer ? '/today' : '/me')
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа 3×10 — 60 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
}

test('workout create keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page)
  await expect(page.getByRole('button', { name: 'Сохранить план' })).toBeDisabled()
  await expectVisualBaseline(page, `workout-create-${process.platform}.png`)
})

test('workout completed-entry keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page)
  await addCompletedBenchPress(page)
  await expectVisualBaseline(page, `workout-create-fact-${process.platform}.png`)
})

test('workout create dark keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client workout form uses mobile visual profiles')
  await openWorkoutCreate(page, true)
  await expectVisualBaseline(page, `workout-create-dark-${process.platform}.png`, [], false, '#1d1e21')
})

test('workout review keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer)
  await expectVisualBaseline(page, `workout-review-${process.platform}.png`)
})

test('workout save keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer)
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-create-edit-identity/)
  await expectVisualBaseline(page, `workout-save-${process.platform}.png`)
})

test('workout review dark keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer, true)
  await expectVisualBaseline(page, `workout-review-dark-${process.platform}.png`, [], false, '#1d1e21')
})

test('workout save dark keeps its visual baseline', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutReview(page, trainer, true)
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await expectVisualBaseline(page, `workout-save-dark-${process.platform}.png`, [], false, '#1d1e21')
})

async function openWorkoutForDetailReview(page: import('@playwright/test').Page, trainer: boolean, resume = false) {
  if (!trainer) {
    await openPreviewLiveWorkout(page)
    return
  }
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await gotoStable(page, `/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByRole('button', { name: /^Сохранить(?: план)?$/ }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  if (resume) {
    const resumeAction = page.getByRole('button', { name: 'Открыть незавершённую' })
    await expect(page.locator('.live-timer').or(resumeAction)).toBeVisible()
    if (await resumeAction.isVisible()) await resumeAction.click()
  }
  await expect(page.locator('.live-timer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

test('workout detail, completion and exercise history keep their visual baselines', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await page.route('**/rest/v1/rpc/list_workout_personal_records', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      exercise_name: 'Жим лёжа (Штанга)', exercise_ref: 'bench-press', input_kind: 'strength',
      metric: 'weight_reps', primary_value: 382.5, reps: 9, weight_kg: 42.5,
    }]),
  }))
  await openWorkoutForDetailReview(page, trainer)
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-set.confirmed')).toBeVisible()
  // Добавляем реальное незавершённое упражнение, чтобы деталь стабильно
  // покрывала partial независимо от числа подходов в исходном плане.
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Добавить: Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  const partialFinish = page.getByRole('button', { name: 'Завершить', exact: true })
  if (await partialFinish.isVisible()) await partialFinish.click()
  await expect(page.getByRole('heading', { name: trainer ? 'Тренировка завершена' : 'Тренировка сохранена частично' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  if (trainer) {
    await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  } else {
    await expect(page.getByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute('aria-valuenow', '33')
    await expect(page.getByText('Осталось выполнить')).toBeVisible()
    await expect(page.locator('.workout-completion-recorded')).not.toHaveAttribute('open')
    await expect(page.getByRole('link', { name: 'Готово' })).toHaveAttribute('href', '/me')
    await expect(page.getByRole('link', { name: 'Посмотреть прогресс' })).toHaveAttribute('href', '/me/progress')
  }
  const detailPath = new URL(page.url()).pathname
  await expectVisualBaseline(page, `workout-detail-completion-${process.platform}.png`)
  if (!trainer) {
    await page.locator('.content').evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expectVisualBaseline(page, `workout-completion-report-actions-${process.platform}.png`)
    await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
    await page.evaluate(() => {
      localStorage.setItem('fit.appTheme', 'dark')
      window.dispatchEvent(new Event('fit-theme-change'))
    })
    await expect(page.locator('html')).not.toHaveClass(/theme-light/)
    await expectVisualBaseline(page, `workout-completion-report-dark-${process.platform}.png`, [], false, '#1d1e21')
    await page.evaluate(() => {
      localStorage.setItem('fit.appTheme', 'light')
      window.dispatchEvent(new Event('fit-theme-change'))
    })
  }

  if (!trainer) await page.locator('.workout-completion-recorded > summary').click()
  await page.locator('.exercise-history-link').first().click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  const historyPath = new URL(page.url()).pathname
  await gotoStable(page, historyPath)
  await expectVisualBaseline(page, `workout-exercise-history-${process.platform}.png`)
  await page.getByRole('tab', { name: 'История' }).click()
  await expectVisualBaseline(page, `workout-exercise-history-list-${process.platform}.png`)

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, detailPath)
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  if (!trainer) await expect(page.locator('.workout-completion-report')).toHaveCount(0)
  await expectVisualBaseline(page, `workout-detail-dark-${process.platform}.png`, [], false, '#1d1e21')
  await gotoStable(page, historyPath)
  await expectVisualBaseline(page, `workout-exercise-history-dark-${process.platform}.png`, [], false, '#1d1e21')

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
  await gotoStable(page, detailPath)
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  const deleteConfirmation = page.getByRole('alertdialog', { name: 'Удалить тренировку?' })
  await deleteConfirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
})

test('trainer Live keeps desktop controls accessible in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer desktop acceptance')
  await openWorkoutForDetailReview(page, true, true)
  const livePath = new URL(page.url()).pathname
  await expect(page.locator('.live-set')).toHaveCount(2)
  await expectMonochromeAccessibility(page)
  await page.screenshot({ path: testInfo.outputPath('trainer-live-light.png') })
  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, livePath)
  await page.getByRole('button', { name: 'Таймер отдыха', exact: true }).click()
  await expectMonochromeAccessibility(page)
  await page.screenshot({ path: testInfo.outputPath('trainer-live-timer-dark.png') })
  await page.getByRole('button', { name: 'Закрыть таймер' }).click()
  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
  await gotoStable(page, livePath.replace(/\/live$/, ''))
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
})

test('client Live keeps row geometry, notes and timer independent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-client-390', 'One iPhone profile for the session transition contract')
  await openPreviewLiveWorkout(page, true)
  const path = new URL(page.url()).pathname
  await page.locator('.live-exercise-note summary').click()
  const note = page.getByLabel(/^Заметка:/)
  await note.fill('Скамья 3, удобная высота')
  const saved = page.waitForResponse((response) => response.url().includes('/rpc/set_exercise_comment') && response.ok())
  await page.locator('.live-timer').click()
  await saved
  await page.reload()
  await expect(page.locator('.live-note-preview')).toHaveText('Скамья 3, удобная высота')
  const rows = page.locator('.live-set-table > .live-set')
  const firstBefore = await rows.first().boundingBox()
  const secondBefore = await rows.nth(1).boundingBox()
  const secondInput = rows.nth(1).getByLabel('Фактический вес')
  await secondInput.fill('43')
  await expect(secondInput).toBeFocused()
  await page.clock.runFor(1500)
  await expect(secondInput).toBeFocused()
  await expect(secondInput).toHaveValue('43')
  expect((await rows.nth(1).boundingBox())!.height).toBe(secondBefore!.height)
  await rows.first().getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(rows.first()).toHaveClass(/confirmed/)
  expect((await rows.first().boundingBox())!.height).toBe(firstBefore!.height)
  expect(Math.abs((await rows.nth(1).boundingBox())!.y - secondBefore!.y)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: /^Таймер отдыха:/ }).click()
  await expect(page.getByRole('dialog', { name: 'Таймер отдыха' })).toBeVisible()
  await expectMonochromeAccessibility(page)
  await page.screenshot({ path: testInfo.outputPath('live-timer-sheet-390.png') })
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Таймер отдыха', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.locator('[data-exercise-ref="running"]').click()
  await expect(page.locator('.live-exercise-upcoming')).toContainText('Бег')
  await rows.nth(1).getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.locator('.live-exercise-collapsed')).toContainText('Жим')
  const nextCard = page.locator('.live-exercise.current')
  await expect(nextCard).toContainText('Бег')
  const nextPosition = await nextCard.boundingBox()
  await page.clock.runFor(2000)
  expect(Math.abs((await nextCard.boundingBox())!.y - nextPosition!.y)).toBeLessThanOrEqual(1)
  await expect(page.locator('.live-exercise-upcoming')).toHaveCount(0)
  await gotoStable(page, path.replace(/\/live$/, ''))
  await expect(page.getByText('Заметка: Скамья 3, удобная высота')).toBeVisible()
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
})

test('client live workout keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Live uses mobile visual profiles')
  await openPreviewLiveWorkout(page)
  await expect(page.locator('.live-exercise.current')).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/live-identity/)
  await expectVisualBaseline(page, 'client-live.png', [page.locator('.live-timer')])

  const livePath = new URL(page.url()).pathname
  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, livePath)
  await expect(page.locator('.phone-frame')).toHaveClass(/live-identity/)
  await expect(page.locator('.live-exercise.current')).toBeVisible()
  await expectVisualBaseline(page, 'client-live-dark.png', [page.locator('.live-timer')], false, '#1d1e21')

  // Visual projects share the seeded preview account. Restore both appearance
  // and product data so later projects still exercise their committed fixtures.
  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
  await gotoStable(page, livePath.replace(/\/live$/, ''))
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click()
  const deleteConfirmation = page.getByRole('alertdialog', { name: 'Удалить тренировку?' })
  await deleteConfirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/workouts$/)
})

test('trainer key routes keep their visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer routes use the desktop visual profile')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })

  await gotoStable(page, '/profile')
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toBeVisible()
  await expect(page.getByText('Ваш выбор для карт прогресса спортсменов')).toBeVisible()
  await page.getByRole('radio', { name: 'Схема' }).click()

  await gotoStable(page, '/schedule')
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
  await expectVisualBaseline(page, 'trainer-schedule.png')

  await gotoStable(page, `/progress/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByText('Анна Смирнова', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
  const trainerAnalysis = page.getByLabel('ИИ-анализ тренировок')
  await expect(trainerAnalysis).toBeVisible()
  await expect(trainerAnalysis.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(trainerAnalysis.locator('.body-progress-map')).toBeVisible()
  await trainerAnalysis.getByRole('button', { name: 'Прогресс', exact: true }).click()
  await expect(trainerAnalysis.getByRole('heading', { name: 'Где выросли результаты' })).toBeVisible()
  await expectBodyMapBaseline(trainerAnalysis.locator('.body-progress-map'), `trainer-body-map-scheme-${process.platform}.png`)
  await expect(trainerAnalysis.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await expect(trainerAnalysis.getByRole('group', { name: 'Атлетичная женщина, вид спереди' })).toHaveCount(0)
  await expect(trainerAnalysis.locator('.client-progress-main-now').evaluate((element) => {
    const card = element.closest('.client-progress-card')
    const goal = card?.querySelector('.client-progress-goal-story')
    const map = card?.querySelector('.body-progress-map')
    const summary = card?.querySelector('.progress-story-summary')
    return Boolean(goal && map && summary
      && (element.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (goal.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (map.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).resolves.toBe(true)
  await expect(page.getByText(/AI-анализ/)).toHaveCount(0)
  const coachmark = page.getByRole('button', { name: 'Понятно' })
  if (await coachmark.isVisible()) await coachmark.evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await expectVisualBaseline(page, 'trainer-progress.png')

  await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByRole('button', { name: 'Настроить показатели' })).toBeVisible()
  await page.locator('.trainer-measurements-workspace .measurement-actions').evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await page.locator('.content').evaluate((element) => element.scrollBy({ top: 180 }))
  await page.locator('.trainer-measurements-workspace .chart h2').click({ position: { x: 4, y: 4 } })
  await expectVisualBaseline(page, 'trainer-measurements.png')
  await gotoStable(page, `/progress/${demoClientId}`)
  const analysis = page.getByLabel('ИИ-анализ тренировок')
  await expect(analysis.locator('.body-progress-map')).toBeVisible()
  await expect(analysis.getByRole('heading', { name: 'Период', exact: true })).toBeVisible()
  await expect(analysis.getByText('Динамика упражнений')).toHaveCount(0)
  await analysis.getByRole('button', { name: 'Подробный анализ' }).click()
  const detailedAnalysis = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(detailedAnalysis.getByRole('heading', { name: 'Главное сейчас' })).toHaveCount(0)
  await expect(detailedAnalysis.getByRole('heading', { name: 'Почему' })).toBeVisible()
  await expect(detailedAnalysis.getByRole('heading', { name: 'На следующей тренировке' })).toBeVisible()
  await detailedAnalysis.getByRole('button', { name: 'Закрыть' }).click()
})

test('trainer Progress and measurements form keep their visual baselines in both themes', async ({ page }, testInfo) => {
  // This full-page baseline must not depend on records left by another visual
  // scenario. Pin the goal and workout history before the first navigation.
  await mockTrainerProgressVisual(page)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'

  await gotoStable(page, `/progress/${demoClientId}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByLabel('ИИ-анализ тренировок')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вернуться к бегу' })).toBeVisible()
  await expect(page.locator('.client-progress-comparison .period-comparison-facts > div')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Подробный анализ' }).evaluate((element) => {
    const mainNow = element.closest('.client-progress-main-now')
    return Boolean(mainNow?.querySelector('.client-progress-main-now-head')?.contains(element))
  })).resolves.toBe(true)
  await expect(page.locator('.client-progress-details-toggle')).toHaveCount(0)
  await expect(page.locator('.ai-progress-footer')).toHaveCount(0)
  const coachmark = page.getByRole('button', { name: 'Понятно' })
  if (await coachmark.isVisible()) await coachmark.click()
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `trainer-progress-${profile}-${process.platform}.png`, [], true)
  await page.getByRole('button', { name: 'Подробный анализ' }).click()
  const lightDetails = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(lightDetails.getByRole('heading', { name: 'Главное сейчас' })).toBeVisible()
  await expect(lightDetails.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(lightDetails.getByRole('heading', { name: 'Почему' })).toHaveCount(0)
  await expect(lightDetails.locator('.progress-detailed-analysis')).toBeVisible()
  await lightDetails.getByRole('button', { name: 'Закрыть' }).click()

  await gotoStable(page, `/progress/${demoClientId}?view=measurements`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-measurements-form-${profile}-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, `/progress/${demoClientId}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByLabel('ИИ-анализ тренировок')).toBeVisible()
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `trainer-progress-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
  await page.getByRole('button', { name: 'Подробный анализ' }).click()
  const darkDetails = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(darkDetails.getByRole('heading', { name: 'Главное сейчас' })).toBeVisible()
  await expect(darkDetails.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(darkDetails.getByRole('heading', { name: 'Почему' })).toHaveCount(0)
  await expect(darkDetails.locator('.progress-detailed-analysis')).toBeVisible()
  await darkDetails.getByRole('button', { name: 'Закрыть' }).click()

  await gotoStable(page, `/progress/${demoClientId}?view=measurements`)
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-measurements-form-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('trainer Clients list keeps its desktop visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'visual-trainer-1440', 'Trainer desktop uses the desktop visual profile')
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Clients list keeps its mobile visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Trainer desktop has a dedicated visual test')
  await mockTrainerClients(page)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expectVisualBaseline(page, `trainer-clients-mobile-${process.platform}.png`, [], true)
  const search = page.getByRole('searchbox', { name: 'Поиск клиента' })
  await page.mouse.move(0, 0)
  await search.focus()
  const searchGeometry = await search.evaluate((element) => {
    const inputStyle = getComputedStyle(element)
    const shell = element.closest<HTMLElement>('.clients-search')!
    const shellStyle = getComputedStyle(shell)
    const inputBox = element.getBoundingClientRect()
    const shellBox = shell.getBoundingClientRect()
    return {
      inputBorderWidth: inputStyle.borderWidth,
      inputMarginBottom: inputStyle.marginBottom,
      inputOutlineStyle: inputStyle.outlineStyle,
      shellBorderWidth: shellStyle.borderWidth,
      contained: inputBox.top >= shellBox.top && inputBox.bottom <= shellBox.bottom,
    }
  })
  expect(searchGeometry).toEqual({ inputBorderWidth: '0px', inputMarginBottom: '0px', inputOutlineStyle: 'none', shellBorderWidth: '1px', contained: true })
  await expect(search).toBeFocused()
  await expect(page).toHaveScreenshot(`trainer-clients-mobile-search-focus-${process.platform}.png`, { animations: 'disabled', caret: 'hide', fullPage: true, maxDiffPixelRatio: 0.03 })

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-mobile-dark-${process.platform}.png`, [], true, '#1d1e21')
  const darkSearch = page.getByRole('searchbox', { name: 'Поиск клиента' })
  await page.mouse.move(0, 0)
  await darkSearch.focus()
  await expect(darkSearch).toBeFocused()
  await expect(page).toHaveScreenshot(`trainer-clients-mobile-search-focus-dark-${process.platform}.png`, { animations: 'disabled', caret: 'hide', fullPage: true, maxDiffPixelRatio: 0.03 })
})

test('exercise picker keeps search, filters and technique readable', async ({ page }, testInfo) => {
  // The baseline represents a new plan without a goal. Isolate it from goal
  // records written by other scenarios sharing the local demo client.
  await page.route('**/rest/v1/rpc/get_client_goal', (route) => route.fulfill({ contentType: 'application/json', body: 'null' }))
  await signIn(page, 'trainer@fit.local', /\/today$/)
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : testInfo.project.name.replace('visual-client-', 'mobile-')
  await gotoStable(page, `/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()

  const search = page.getByLabel('Поиск упражнения')
  await search.fill('Болгарский')
  await expect(page.getByRole('button', { name: 'Очистить поиск' })).toBeVisible()
  await expect(page.getByText(/Найдено: \d+/)).toBeVisible()
  await expectVisualBaseline(page, `exercise-picker-search-${profile}-${process.platform}.png`, [page.locator('.picker-item-media')])

  await page.getByRole('button', { name: 'Проиграть технику: Болгарский сплит-присед со штангой', exact: true }).click()
  await expect(page.locator('.picker-item.playing video')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть технику: Болгарский сплит-присед со штангой', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Техника' })).toBeVisible()
  await expect(page.getByText('Как выполнять')).toBeVisible()
  await expectVisualBaseline(page, `exercise-picker-technique-${profile}-${process.platform}.png`, [page.locator('.picker-technique-view .exercise-image-technique')])
  await page.getByRole('button', { name: 'Назад к выбору' }).click()
  await expect(search).toHaveValue('Болгарский')

  await page.getByRole('button', { name: 'Очистить поиск' }).click()
  await page.getByRole('button', { name: 'Фильтры' }).click()
  await page.getByLabel('Группа мышц').selectOption('legs')
  await page.getByLabel('Мышца').selectOption('Передняя поверхность бедра')
  await expect(page.getByLabel('Настройки фильтров')).toBeVisible()
  await expectVisualBaseline(page, `exercise-picker-filters-${profile}-${process.platform}.png`, [page.locator('.picker-item-media')])
  await page.getByRole('button', { name: /^Показать \d+ упражн/ }).click()
  await expect(page.getByLabel('Выбранные фильтры')).toContainText('Ноги')
  await expect(page.getByLabel('Выбранные фильтры')).toContainText('Передняя поверхность бедра')
  expect((await page.locator('.picker-list').boundingBox())?.height ?? 0).toBeGreaterThan(280)
})

test('trainer Client Detail keeps its visual baselines', async ({ page }, testInfo) => {
  await page.route('**/rest/v1/rpc/list_workout_summaries', (route) => route.fulfill({
    contentType: 'application/json', body: '[]',
  }))
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, `/clients/${demoClientId}`)
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Сводка по спортсмену' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Запланировать тренировку' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы спортсмена' }).getByRole('link')).toHaveCount(2)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  await expectVisualBaseline(page, `trainer-client-detail-${profile}-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, `/clients/${demoClientId}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-detail-identity/)
  await expectVisualBaseline(page, `trainer-client-detail-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Create and Edit keep their visual baselines', async ({ page }, testInfo) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'

  await gotoStable(page, '/clients/new')
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expect(page.getByLabel('Начальный вес, кг')).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-create-${profile}-${process.platform}.png`, [], true)

  await gotoStable(page, `/clients/${demoClientId}/edit`)
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await expect(page.getByLabel('Имя в моём списке')).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-edit-${profile}-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expectVisualBaseline(page, `trainer-client-create-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
  await gotoStable(page, `/clients/${demoClientId}/edit`)
  await expectVisualBaseline(page, `trainer-client-edit-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Goal keeps its real create, stage and edit states in both themes', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  const clientName = 'Марина Орлова'

  // Отдельный спортсмен на каждый browser-project не даёт параллельным
  // visual-проверкам делить одну active goal и менять состояние друг друга.
  await gotoStable(page, '/clients/new')
  await page.getByLabel('Имя', { exact: true }).fill(clientName)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('29')
  await page.getByLabel('Рост, см').fill('168')
  await page.getByLabel('Начальный вес, кг').fill('63')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  const clientId = page.url().split('/').pop()!

  await gotoStable(page, `/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await expect(page.getByLabel('Цель')).toBeVisible()
  await page.getByLabel('Цель').fill('Держать вес и тренироваться регулярно')
  await page.getByLabel('Дата достижения').fill('2026-12-20')
  await page.getByRole('switch', { name: 'Автоматическая оценка' }).check()
  await page.getByLabel('Способ оценки').selectOption('maintain_range')
  await page.getByLabel('Минимум, кг').fill('62.5')
  await page.getByLabel('Максимум, кг').fill('63.5')
  await page.getByRole('button', { name: '＋ Добавить критерий' }).click()
  const regularity = page.locator('.goal-criterion-item').nth(1)
  await regularity.getByLabel('Показатель').selectOption('workout_regularity')
  await regularity.locator('select').nth(2).selectOption('each_period')
  await regularity.getByLabel('Способ оценки').selectOption('increase_to')
  await regularity.getByLabel('Значение, трен.').fill('3')
  await expectVisualBaseline(page, `trainer-client-goal-create-${profile}-${process.platform}.png`, [], true)

  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Этапы' })).toBeVisible()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
  await page.getByRole('button', { name: '＋ Добавить' }).click()
  await page.getByLabel('Название этапа').fill('Стабильные 5 км')
  await page.getByLabel('Начало').fill('2026-08-16')
  await page.getByLabel('Конец').fill('2026-09-20')
  await page.getByRole('button', { name: 'Добавить этап' }).click()
  await expect(page.getByText('Стабильные 5 км', { exact: true })).toBeVisible()
  await expectVisualBaseline(page, `trainer-client-goal-detail-${profile}-${process.platform}.png`, [], true)

  // Открываем и закрываем обе реальные edit-формы: визуальный контракт форм
  // тот же, а данные и версии не меняем ради снимка.
  await page.getByRole('button', { name: 'Изменить' }).first().click()
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Изменить' }).last().click()
  await expect(page.getByLabel('Название этапа')).toHaveValue('Стабильные 5 км')
  await page.getByRole('button', { name: 'Отмена' }).click()

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, `/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-goal-identity/)
  await expectVisualBaseline(page, `trainer-client-goal-detail-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')

  await page.getByRole('button', { name: 'Архивировать цель' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Архивировать' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  await page.getByRole('button', { name: 'Архивировать клиента' }).click()
  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).uncheck()
})

test('trainer Schedule keeps its compact workspace in both themes', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'
  const scheduleDate = testInfo.project.name === 'visual-client-390' ? '2027-02-02'
    : testInfo.project.name === 'visual-client-430' ? '2027-02-03' : '2027-02-04'
  const clientName = 'Анна Смирнова'
  let workoutUrl: string | null = null

  try {
    // A browser crash or a test timeout can interrupt cleanup after the record
    // has already been saved. Remove any record left by an earlier retry before
    // creating the single event used by this visual baseline.
    await removeScheduleVisualWorkouts(page, scheduleDate, clientName)
    await gotoStable(page, `/workouts/new?client=${demoClientId}&date=${scheduleDate}`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Начало').fill('18:30')
    await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
    await page.getByRole('button', { name: /^Силовая/ }).click()
    await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
    await page.getByRole('button', { name: /^(?:Выбрать|Добавить): Жим штанги лёжа$/ }).click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]+$/)
    workoutUrl = page.url()

    await gotoStable(page, `/schedule?date=${scheduleDate}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
    await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
    await expect(page.locator('.week-day')).toHaveCount(7)
    await expect(page.locator('.day-grid-hour')).toHaveCount(24)
    await expect(page.locator('.schedule-selected-date')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
    await expect(page.locator('.day-grid-event').filter({ hasText: clientName })).toHaveCount(1)
    await expectVisualBaseline(page, `trainer-schedule-${profile}-${process.platform}.png`)

    await gotoStable(page, '/profile')
    await page.getByRole('switch', { name: 'Тёмная тема' }).check()
    await gotoStable(page, `/schedule?date=${scheduleDate}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
    await expectVisualBaseline(page, `trainer-schedule-${profile}-dark-${process.platform}.png`, [], false, '#1d1e21')
  } finally {
    try {
      if (workoutUrl) await removeScheduleVisualWorkouts(page, scheduleDate, clientName)
    } finally {
      await gotoStable(page, '/profile', { waitUntil: 'domcontentloaded' })
      const darkTheme = page.getByRole('switch', { name: 'Тёмная тема' })
      if (await darkTheme.isChecked()) await darkTheme.uncheck()
    }
  }
})

test('Home body map keeps its front and back switch aligned', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Home')
  await mockClientWorkoutHistory(page, { includeBack: true, homeLayout: true })
  await page.route('**/rest/v1/workouts?*', (route) => new URL(route.request().url()).searchParams.get('select') === 'workout_date'
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout_date: '2026-08-03' }) }) : route.fallback())
  await page.route('**/rest/v1/client_published_training_summaries?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const map = page.getByRole('region', { name: 'Последняя тренировка' }).getByRole('region', { name: 'Распределение подходов' })
  const sides = map.locator('.body-progress-sides')
  await expect(sides).toBeVisible()
  const coachmark = page.getByRole('button', { name: 'Понятно' })
  if (await coachmark.isVisible()) await coachmark.click()

  const geometry = await map.evaluate((element) => {
    const sideControl = element.querySelector<HTMLElement>('.body-progress-sides')!
    const visual = element.querySelector<HTMLElement>('.body-progress-visual')!
    const buttons = Array.from(sideControl.querySelectorAll<HTMLElement>('button')).map((button) => button.getBoundingClientRect())
    const control = sideControl.getBoundingClientRect()
    const figure = visual.getBoundingClientRect()
    const mapRect = element.getBoundingClientRect()
    const zones = element.querySelector<HTMLElement>('.workout-load-map-zones')!.getBoundingClientRect()
    const card = element.closest<HTMLElement>('.personal-workout-result')!
    const cardRect = card.getBoundingClientRect()
    const cardStyle = getComputedStyle(card)
    return {
      controlHeight: control.height,
      buttonHeights: buttons.map((button) => button.height),
      buttonWidths: buttons.map((button) => button.width),
      buttonTops: buttons.map((button) => button.top),
      gapToFigure: figure.top - control.bottom,
      centersDelta: Math.abs((figure.left + figure.right) / 2 - (control.left + control.right) / 2),
      topDelta: Math.abs(figure.top - zones.top),
      rightDelta: Math.abs(mapRect.right - zones.right),
      cardWidthDelta: Math.abs(mapRect.width - (cardRect.width - parseFloat(cardStyle.paddingLeft) - parseFloat(cardStyle.paddingRight) - 2)),
    }
  })
  expect(geometry.controlHeight).toBeGreaterThanOrEqual(44)
  expect(geometry.buttonHeights.every((height) => height >= 44)).toBe(true)
  expect(Math.abs(geometry.buttonWidths[0]! - geometry.buttonWidths[1]!)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.buttonTops[0]! - geometry.buttonTops[1]!)).toBeLessThanOrEqual(1)
  expect(geometry.gapToFigure).toBeGreaterThanOrEqual(8)
  expect(geometry.centersDelta).toBeLessThanOrEqual(1)
  expect(geometry.topDelta).toBeLessThanOrEqual(1)
  expect(geometry.rightDelta).toBeLessThanOrEqual(1)
  expect(geometry.cardWidthDelta).toBeLessThanOrEqual(1)
  await expectBodyMapBaseline(page.getByRole('region', { name: 'Последняя тренировка' }), `home-result-alignment-${process.platform}.png`)
  await expectBodyMapBaseline(map, `home-body-map-side-switch-${process.platform}.png`)
  await expect(map).toContainText('Всего 5 подходов')
  await expect(map).toContainText('Кардио: 1 подход')
  await map.getByText('Показать все группы', { exact: true }).click()
  await expect(map.getByRole('button', { name: 'Передняя поверхность бедра: 1 подход' })).toBeVisible()
  await expectBodyMapBaseline(map, `home-body-map-expanded-${process.platform}.png`)

  await map.getByRole('button', { name: 'Сзади' }).click()
  await expect(map.getByRole('button', { name: 'Сзади' })).toHaveAttribute('aria-pressed', 'true')
  await expect(map.getByRole('button', { name: 'Верх спины: 1 подход' })).toHaveAttribute('aria-pressed', 'true')
  await map.getByRole('button', { name: 'Спереди' }).click()
  await expect(map.getByRole('button', { name: 'Грудь: 1 подход' })).toHaveAttribute('aria-pressed', 'true')
  await map.getByText('Показать все группы', { exact: true }).click()

  await page.evaluate(() => {
    window.localStorage.setItem('fit.appTheme', 'dark')
    window.dispatchEvent(new Event('fit-theme-change'))
  })
  await expectBodyMapBaseline(map, `home-body-map-side-switch-dark-${process.platform}.png`)
  for (const viewport of [{ width: 360, height: 800 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(sides).toHaveCSS('height', '44px')
    for (const button of await sides.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})


test('personal workout result stays on Home and remains available in Progress history without AI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client result')
  await mockClientWorkoutHistory(page)
  await page.route('**/rest/v1/workouts?*', (route) => new URL(route.request().url()).searchParams.get('select') === 'workout_date'
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout_date: '2026-08-03' }) }) : route.fallback())
  await page.route('**/rest/v1/client_published_training_summaries?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.route('https://functions.yandexcloud.net/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily unavailable' }) }))
  await page.route('**/v1/legacy/summarize-client-training', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily unavailable' }) }))
  await page.route('**/functions/v1/summarize-client-training', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily unavailable' }) }))
  await signIn(page, 'client@fit.local', /\/me$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const result = page.getByRole('region', { name: 'Последняя тренировка' })
  await expect(result.getByRole('heading', { name: 'Результат снизился' })).toBeVisible()
  await expect(result).toContainText('45 → 40 кг · −5 кг')
  await expect(result).toContainText('К прошлому результату')
  await expect(result.getByRole('link', { name: 'Сравнить' })).toHaveCount(0)
  await expect(result.getByRole('link', { name: 'Открыть тренировку' })).toHaveAttribute('href', '/workouts/b1000000-0000-4000-8000-000000000001')
  const homeMap = result.getByRole('region', { name: 'Распределение подходов' })
  await expect(homeMap.getByRole('button', { name: 'Грудь: 1 подход' })).toBeVisible()
  const mapCoachmark = page.getByRole('button', { name: 'Понятно' })
  if (await mapCoachmark.isVisible()) await mapCoachmark.click()
  await expectBodyMapBaseline(result, `personal-result-home-${process.platform}.png`)
  await homeMap.getByRole('link', { name: 'Разбор нагрузки' }).click()
  await expect(page).toHaveURL(/mapWorkout=b1000000-0000-4000-8000-000000000001.*mapMode=load.*mapFrom=2026-08-10.*mapTo=2026-08-10.*mapZone=chest/)
  const disclosure = page.locator('.client-body-map-disclosure')
  await expect(disclosure).toHaveAttribute('open')
  await expect(disclosure).toContainText('10 августа 2026 г. · тренировка')
  await expect(disclosure).toContainText('Жим лёжа: 1 подход')
  await disclosure.getByRole('link', { name: 'Открыть тренировку' }).click()
  await expect(page).toHaveURL(/\/workouts\/b1000000-0000-4000-8000-000000000001$/)
  await expect(page.getByRole('article').getByText('Жим лёжа', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(disclosure).toHaveAttribute('open')
  await expect(disclosure.getByRole('button', { name: 'Грудь: 1 подход' })).toHaveAttribute('aria-pressed', 'true')
  const mapViewport = page.viewportSize()!
  await page.setViewportSize({ ...mapViewport, height: 1400 })
  await expectBodyMapBaseline(disclosure, `home-map-detail-${process.platform}.png`)
  await page.setViewportSize(mapViewport)
  await gotoStable(page, '/me/progress')
  await expect(page.locator('.period-exercise-results')).toContainText('За этот период новых достижений нет.')
  await expect(page.locator('.personal-workout-result')).toHaveCount(0)
  await expect(page.locator('.ai-progress-auto-error')).toBeVisible()
  await expect(page.locator('.client-progress-main-now')).toHaveCount(0)
  await page.getByRole('heading', { name: 'Мой прогресс' }).scrollIntoViewIfNeeded()
  await expectVisualBaseline(page, `personal-result-progress-${process.platform}.png`)
  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/me')
  await expectBodyMapBaseline(result, `personal-result-home-dark-${process.platform}.png`)
  await gotoStable(page, '/me/progress')
  await expect(page.locator('.period-exercise-results')).toContainText('За этот период новых достижений нет.')
  await expectVisualBaseline(page, `personal-result-progress-dark-${process.platform}.png`)
})

test('best results show several real records and keep the remaining achievements available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client result')
  await mockClientWorkoutHistory(page, { includeBack: true, bestResults: true })
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await openClientProgress(page)
  const results = page.locator('.period-exercise-results')
  await expect(results.locator(':scope > .period-exercise-result')).toHaveCount(3)
  await expect(results).toContainText('45 кг × 10 повторов')
  await expect(results).toContainText('Новый максимум веса · +5 кг')
  await expect(results).toContainText('Прежний рекорд — 40 кг')
  await expect(results.getByRole('link', { name: 'Открыть тренировку' })).toHaveCount(3)
  await expect(results).toHaveScreenshot(`best-results-${process.platform}.png`, { animations: 'disabled' })
  await results.getByText('Ещё достижения · 1', { exact: true }).click()
  await expect(results.getByRole('link', { name: 'Открыть тренировку' })).toHaveCount(4)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
})


test('results center preserves sources and explains weekly work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client analytics')
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await mockResultsHistory(page)
  await openClientProgress(page)
  await verifyResultsSources(page)
  const center = page.locator('#results-center')
  const viewport = page.viewportSize()!
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('fixed_reps')
  await expect(center.locator('.center-result-row').first()).toContainText('Повторы при 50 кг: 12 повт.')
  await expect(center.locator('.center-result-row').first()).toContainText('Было 10 повт.')
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('volume')
  const volume = center.locator('.center-result-row').first()
  await volume.getByText('Подходы, вес и повторы', { exact: true }).click()
  await expect(volume).toContainText('1 → 2')
  await expect(volume).toContainText('50 кг × 12 повт.')
  await expect(volume).toContainText('50 кг × 10 повт.')
  await expect(volume).toContainText('45 кг × 10 повт.')
  await expect(volume).toContainText('Итого: 1 100 кг')
  await expect(volume).toContainText('Итого: 450 кг')
  await expect(volume).not.toContainText('не равно изменению силы')
  const weekly = page.locator('.weekly-training-load')
  await weekly.getByText('Нагрузка по неделям', { exact: true }).click()
  await expect(weekly.locator('.weekly-load-list > li').first()).toContainText('6 подходов')
  await expect(weekly.locator('.weekly-load-list > li').first()).toContainText('Кардио: 2 · Без группы: 1')
  await expect(weekly).toContainText('Часть недели')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ ...viewport, height: 1500 })
  await expect.soft(weekly).toHaveScreenshot(`weekly-load-${process.platform}.png`, { animations: 'disabled' })
  await expect.soft(volume).toHaveScreenshot(`result-volume-${process.platform}.png`, { animations: 'disabled' })
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('weight')
  await expect.soft(center).toHaveScreenshot(`results-center-${process.platform}.png`, { animations: 'disabled' })
})

test('results center keeps detailed analytics in dark theme', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client analytics')
  await mockProgressPeriodSummary(page, '2026-07-17', '2026-08-16')
  await mockResultsHistory(page)
  await openClientProgress(page, { dark: true })
  const center = page.locator('#results-center')
  await center.getByText('Все результаты', { exact: true }).click()
  await center.getByRole('combobox', { name: 'Упражнение', exact: true }).selectOption('system:press:strength')
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('volume')
  const weekly = page.locator('.weekly-training-load')
  const viewport = page.viewportSize()!
  const darkVolume = center.locator('.center-result-row').first()
  await expect(darkVolume).toContainText('Объём: 1 100 кг')
  await darkVolume.getByText('Подходы, вес и повторы', { exact: true }).click()
  await weekly.getByText('Нагрузка по неделям', { exact: true }).click()
  await page.setViewportSize({ ...viewport, height: 1500 })
  await expect.soft(darkVolume).toHaveScreenshot(`result-volume-dark-${process.platform}.png`, { animations: 'disabled' })
  await expect.soft(weekly).toHaveScreenshot(`weekly-load-dark-${process.platform}.png`, { animations: 'disabled' })
})
