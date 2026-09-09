import { expect, type Page } from '@playwright/test'

const demoClientId = '11111111-1111-4111-8111-111111111111'

export function comparisonWorkoutRow(id: string, date: string, weight: number, distance: number, strengthSets: number) {
  const baseSet = (suffix: string, position: number, values: { weight?: number, reps?: number, distance?: number, duration?: number }) => ({
    id: `${id}-${suffix}-${position}`, position,
    plan_weight_kg: values.weight ?? null, plan_reps: values.reps ?? null,
    plan_duration_min: values.duration ?? null, plan_duration_sec: null, plan_distance_km: values.distance ?? null, plan_rpe: null,
    fact_weight_kg: values.weight ?? null, fact_reps: values.reps ?? null,
    fact_duration_min: values.duration ?? null, fact_duration_sec: null, fact_distance_km: values.distance ?? null, fact_rpe: null,
    confirmed_at: `${date}T10:00:00Z`, version: 1,
  })
  const exercise = (suffix: string, name: string, muscle: string, kind: string, sets: ReturnType<typeof baseSet>[]) => ({
    id: `${id}-${suffix}`, position: suffix === 'press' ? 0 : 1, exercise_source: 'system', exercise_ref: suffix,
    custom_exercise_id: null, exercise_name: name, muscle_group: muscle, input_kind: kind, block_id: `${id}-${suffix}-block`,
    block_type: 'single', block_preset: 'set', block_rounds: 1, rest_between_exercises_sec: 0,
    rest_between_rounds_sec: 0, rest_between_sets_sec: 60, trainer_comment: null, sets,
  })
  return {
    id, client_id: demoClientId, trainer_id: '00000000-0000-4000-8000-000000000001', client_name: 'Анна Смирнова', created_by: null,
    workout_date: date, start_time: null, end_time: null, started_at: `${date}T09:00:00Z`, completed_at: `${date}T10:00:00Z`,
    status: 'done', notes: null, trainer_review: null, trainer_reaction: null, trainer_review_author_id: null,
    trainer_reviewed_at: null, client_comment: null, session_rpe: null, wellbeing: null, discomfort: null, has_pr: false,
    stage_id: null, stage_title: null, version: 1, total_count: 3,
    exercises: [
      exercise('press', 'Жим лёжа', 'chest', 'strength', Array.from({ length: strengthSets }, (_, index) => baseSet('press-set', index, { weight, reps: 10 }))),
      exercise('run', 'Бег', 'cardio', 'distance', [baseSet('run-set', 0, { distance, duration: 30 })]),
    ],
  }
}

export async function mockResultsHistory(page: Page) {
  const rows = [
    comparisonWorkoutRow('c1000000-0000-4000-8000-000000000001', '2026-07-01', 40, 3, 1),
    comparisonWorkoutRow('c1000000-0000-4000-8000-000000000002', '2026-08-03', 50, 5, 1),
    comparisonWorkoutRow('c1000000-0000-4000-8000-000000000003', '2026-08-10', 45, 4, 1),
    comparisonWorkoutRow('c1000000-0000-4000-8000-000000000004', '2026-08-12', 50, 5, 2),
  ]
  const last = rows[3]!
  last.exercises[0]!.sets[0]!.fact_reps = 12
  const unknown = structuredClone(last.exercises[0]!)
  Object.assign(unknown, { id: `${last.id}-unknown`, position: 2, exercise_ref: 'unmapped-zone', exercise_name: 'Свободное движение', muscle_group: 'other', input_kind: 'reps', block_id: `${last.id}-unknown-block` })
  unknown.sets = [{ ...unknown.sets[0]!, id: `${last.id}-unknown-set`, fact_weight_kg: null, plan_weight_kg: null }]
  last.exercises.push(unknown)
  await page.route('**/rest/v1/workouts?*', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('select') === 'workout_date') return route.fulfill({ json: { workout_date: rows[0]!.workout_date } })
    const row = rows.find((item) => item.id === params.get('id')?.replace(/^eq\./, ''))
    return row ? route.fulfill({ json: row }) : route.fallback()
  })
  await page.route('**/rest/v1/workout_exercises?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('workout_id')?.replace(/^eq\./, '')
    const row = rows.find((item) => item.id === id)
    return row ? route.fulfill({ json: row.exercises }) : route.fallback()
  })
  await page.route('**/rest/v1/workout_sets?*', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('workout_exercise_id') ?? ''
    const exercises = rows.flatMap((row) => row.exercises).filter((item) => ids.includes(item.id))
    return exercises.length ? route.fulfill({ json: exercises.flatMap((exercise) => exercise.sets.map((set) => ({ ...set, workout_exercise_id: exercise.id }))) }) : route.fallback()
  })
  await page.route('**/rest/v1/rpc/list_workouts', (route) => {
    const body = route.request().postDataJSON() as { p_from?: string; p_to?: string; p_offset?: number }
    const selected = rows.filter((row) => (!body.p_from || row.workout_date >= body.p_from) && (!body.p_to || row.workout_date <= body.p_to))
    return route.fulfill({ json: selected.slice(body.p_offset ?? 0).map((row) => ({ ...row, total_count: selected.length })) })
  })
}

export async function verifyAnalysisShortcutKeepsShell(page: Page) {
  await page.getByRole('button', { name: 'Открыть анализ' }).click()
  expect(new URL(page.url()).hash).toBe('')
  const dialog = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(dialog).toBeVisible()
  await expect(page.locator('.client-tab-bar')).toBeInViewport()
  await expect(page.locator('.client-tab-bar').evaluate((tabBar) => {
    const rect = tabBar.getBoundingClientRect()
    return {
      rootScroll: Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop),
      staysAtBottom: rect.top > window.innerHeight / 2 && rect.bottom <= window.innerHeight,
    }
  })).resolves.toEqual({ rootScroll: 0, staysAtBottom: true })
  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('button', { name: 'Открыть анализ' })).toBeFocused()
}

export async function verifyResultsSources(page: Page) {
  const center = page.locator('#results-center')
  await expect(page.locator('.period-exercise-results #results-center')).toHaveCount(1)
  await verifyAnalysisShortcutKeepsShell(page)
  for (const control of await page.locator('.progress-details-toggle:visible').all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await expect(center).not.toHaveAttribute('open')
  await expect(page.locator('.weekly-training-load')).not.toHaveAttribute('open')
  await center.getByText('Все результаты', { exact: true }).click()
  await center.scrollIntoViewIfNeeded()
  const scrollBeforeFilters = await page.locator('.content').evaluate((element) => element.scrollTop)
  expect(scrollBeforeFilters).toBeGreaterThan(0)
  await center.getByRole('combobox', { name: 'Упражнение', exact: true }).selectOption('system:press:strength')
  await expect(page).toHaveURL(/resultExercise=system%3Apress%3Astrength/)
  await expect(page.locator('.content').evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(0)
  await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('weight')
  await expect(page).toHaveURL(/resultMetric=weight/)
  await expect(page.locator('.content').evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(0)
  for (const field of await center.getByRole('combobox').all()) expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const resultRows = center.locator('.center-result-row')
  await expect(resultRows).toHaveCount(3)
  const record = resultRows.filter({ hasText: 'Личный рекорд' })
  await expect(record).toHaveCount(1)
  await expect(resultRows.filter({ hasText: 'Результат снизился' })).toHaveCount(1)
  await record.getByRole('link', { name: 'Ранее · 1 июля 2026 г.' }).click()
  await expect(page).toHaveURL(/workouts\/c1000000-0000-4000-8000-000000000001$/)
  await expect(page.locator('.workout-detail-page')).toBeVisible()
  await expect(page.locator('.workout-detail-page').getByRole('article').getByText('Жим лёжа', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(/resultExercise=system%3Apress%3Astrength.*resultMetric=weight/)
  await expect(center).toHaveAttribute('open')
  await expect(center.getByRole('combobox', { name: 'Упражнение', exact: true })).toHaveValue('system:press:strength')
  await expect(center.getByRole('combobox', { name: 'Показатель', exact: true })).toHaveValue('weight')
  await expect(page).toHaveURL(/#results-center$/)
  await expect(center).toContainText('17 июля 2026 г. — 16 августа 2026 г.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
