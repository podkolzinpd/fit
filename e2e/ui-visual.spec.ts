import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expectMonochromeAccessibility } from './accessibility-helpers'

const demoClientId = '11111111-1111-4111-8111-111111111111'

function comparisonWorkoutRow(id: string, date: string, weight: number, distance: number, strengthSets: number) {
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

async function mockPeriodComparison(page: VisualPage) {
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

async function mockMeasurementProgress(page: VisualPage) {
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, options)
      await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 5_000 })
      return
    } catch (error) {
      const browserInternal = error instanceof Error && error.message.includes('encountered an internal error')
      const emptyAppDocument = !browserInternal && await page.locator('#root > *').count() === 0
      // The pinned runtime can rarely reject a navigation internally or return
      // an empty document without throwing. Retry only those two browser-level
      // states once; populated application, network and assertion failures
      // still surface immediately.
      if (attempt > 0 || (!browserInternal && !emptyAppDocument)) throw error
      await page.waitForTimeout(100)
    }
  }
}

async function signIn(page: import('@playwright/test').Page, email: string, destination: RegExp) {
  await gotoStable(page, '/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(destination, { timeout: 15_000 })
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

async function mockClientWorkoutHistory(page: import('@playwright/test').Page) {
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
  await expect(page.locator('.client-progress-main-now')).toBeVisible()
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

async function openPreviewLiveWorkout(page: import('@playwright/test').Page) {
  await page.clock.install({ time: new Date('2026-08-29T18:00:00+03:00') })
  await signIn(page, 'client@fit.local', /\/me$/)

  await gotoStable(page, '/me/workouts')
  const activeWorkout = page.getByRole('link', { name: /Идёт/ }).first()
  const addAction = page.getByRole('link', { name: /^(?:Добавить|Добавить тренировку)$/ })
  await expect(addAction).toBeVisible()
  if (await activeWorkout.isVisible()) {
    await activeWorkout.click()
    await page.getByRole('link', { name: 'Продолжить тренировку' }).click()
    await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
    return
  }
  await expect(addAction).toHaveCount(1)
  await addAction.click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

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
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить план' }).click()

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
  await openClientProgress(page)
  await expect(page.locator('.client-progress-card .body-progress-map')).toBeVisible()
  await expectBodyMapBaseline(page.locator('.client-progress-card .body-progress-map'), `client-body-map-female-${process.platform}.png`)
  await expect(page.locator('.client-progress-main-now').getByText('Главное сейчас', { exact: true })).toBeVisible()
  const progressStats = page.locator('.client-progress-card .ai-progress-stats')
  await expect(progressStats.getByText(/трениров/).first()).toBeVisible()
  await expect(progressStats.getByText(/недел/).first()).toBeVisible()
  await expect(page.getByText(/\/ нед\./)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нагрузка', exact: true })).toBeVisible()
  await expect(page.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(page.getByText('Прогресс уже заметен, ты на верном пути.')).toHaveCount(0)
  await expect(page.getByText('Проверяем цель…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  await expect(page.locator('.client-progress-main-now').evaluate((element) => {
    const goal = document.querySelector('.client-progress-goal-story')
    const map = document.querySelector('.body-progress-map')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(goal && map && summary
      && (element.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (goal.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (map.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).resolves.toBe(true)
  const progressCoachmark = page.getByRole('button', { name: 'Понятно' })
  if (await progressCoachmark.isVisible()) await progressCoachmark.click()
  await expectVisualBaseline(page, `client-progress-${process.platform}.png`)
})

test('exercise catalog and technique detail keep their visual baselines in both themes', async ({ page }) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await gotoStable(page, '/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
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
  await openClientProgress(page, { scheme: true })
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectBodyMapBaseline(page.locator('.client-progress-card .body-progress-map'), `client-body-map-scheme-${process.platform}.png`)
  await expectVisualBaseline(page, `client-progress-scheme-${process.platform}.png`)
})

test('client Progress scheme keeps its dark visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client Progress uses mobile visual profiles')
  await openClientProgress(page, { scheme: true, dark: true })
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible({ timeout: 15_000 })
  await expectBodyMapBaseline(page.locator('.client-progress-card .body-progress-map'), `client-body-map-scheme-dark-${process.platform}.png`)
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
  await expect(goal.locator('.goal-criterion-progress-row')).toHaveCount(1)
  await expect(goal.getByText(/из 2 выполнено/)).toBeVisible()
  await expect(goal.getByRole('button', { name: 'Показать все критерии · 2' })).toBeVisible()
  await goal.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expectVisualBaseline(page, `client-progress-composite-${process.platform}.png`, [], true)
  await goal.getByRole('button', { name: 'Показать все критерии · 2' }).click()
  await expect(goal.locator('.goal-criterion-progress-row')).toHaveCount(2)
  await goal.getByRole('button', { name: 'Показать только основной критерий' }).click()

  await gotoStable(page, '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/me/progress')
  const darkGoal = page.locator('.client-progress-goal-story')
  await expect(darkGoal.locator('.goal-criterion-progress-row')).toHaveCount(1)
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
  await expect(comparison.locator('.period-comparison-facts > div')).toHaveCount(4)
  await expect(comparison.getByRole('button', { name: /Показать ещё/ })).toBeVisible()
  await expect(comparison.locator('.period-comparison-conclusions > div')).toHaveCount(2)
  expect(await comparison.evaluate((element) => {
    const map = document.querySelector('.body-progress-map')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(map && summary
      && (map.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
  expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await comparison.getByRole('button', { name: /Показать ещё/ }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
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
  await expect(comparison.locator('.period-comparison-facts > div')).toHaveCount(4)
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
  }

  let measurements = page.locator('.client-progress-measurements-story')
  await expect(measurements.getByRole('heading', { name: 'Тренд по значениям' })).toBeVisible()
  await expect(measurements.getByRole('tab', { name: /Вес/ })).toBeVisible()
  await expect(measurements.getByRole('tab', { name: /Плечи/ })).toBeVisible()
  await expect(measurements.getByLabel('График показателя «Вес»')).toBeVisible()
  await expect(measurements.locator('.recharts-tooltip-wrapper')).toHaveCount(0)
  await expect(measurements.getByText('5 августа 2026 г.', { exact: true })).toHaveCount(0)
  expect(await measurements.evaluate((element) => {
    const comparison = document.querySelector('.client-progress-comparison')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(comparison && summary
      && (comparison.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
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
  await expect(measurements.getByRole('heading', { name: 'Тренд по значениям' })).toBeVisible()
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
  }

  let regularity = page.locator('.client-progress-regularity-story')
  await expect(regularity.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await expect(regularity.getByText('3 тренировки', { exact: true })).toBeVisible()
  await expect(regularity.getByText('2 из 3', { exact: true })).toBeVisible()
  await expect(regularity.getByText('Снижение частоты', { exact: true })).toBeVisible()
  await expect(regularity.getByRole('list', { name: 'Завершённые тренировки по неделям' }).locator('li')).toHaveCount(3)
  await expect(regularity.locator('li[aria-label*="Без тренировок"]')).toHaveCount(1)
  await expect(regularity.locator('li[aria-label*="Текущая неделя"]')).toHaveCount(0)
  expect(await regularity.evaluate((element) => {
    const measurements = document.querySelector('.client-progress-measurements-story')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(measurements && summary
      && (measurements.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
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
  regularity = page.locator('.client-progress-regularity-story')
  await expect(regularity.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await regularity.scrollIntoViewIfNeeded()
  await expect(regularity).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-workout-regularity-dark-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015,
  })
})

test('next-step suggestion stays concise and explicit for client and trainer in both themes', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  const initialViewport = page.viewportSize()
  await mockMeasurementProgress(page)
  if (trainer) {
    await signIn(page, 'trainer@fit.local', /\/today$/)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await gotoStable(page, `/progress/${demoClientId}`)
  } else {
    await openClientProgress(page, { scheme: true })
  }

  let nextStep = page.locator('.client-progress-next-step')
  await expect(nextStep.getByText(/Подобрал помощник|Подобрано по данным/)).toBeVisible()
  await expect(nextStep.getByRole('button', { name: 'Выбрать этот шаг' })).toBeVisible()
  await expect(nextStep.getByRole('button', { name: 'Другой вариант' })).toBeVisible()
  await expect(nextStep.getByRole('button', { name: 'Не сейчас' })).toBeVisible()
  await expect(nextStep.locator('.progress-next-step-evidence')).toContainText('Учтено:')
  expect(await nextStep.evaluate((element) => {
    const summary = element.closest('.client-progress-card')?.querySelector('.progress-story-summary')
    const details = element.closest('.client-progress-card')?.querySelector('.client-progress-details-toggle')
    return Boolean(summary && details
      && (summary.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
  if (!trainer) {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await nextStep.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
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
  await nextStep.scrollIntoViewIfNeeded()
  await expect(nextStep).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-progress-next-step-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.025,
  })
  await nextStep.getByRole('button', { name: 'Выбрать этот шаг' }).click()
  await expect(nextStep.getByText('Данные не изменены.', { exact: false })).toBeVisible()
  await expect(nextStep).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-progress-next-step-confirmed-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.025,
  })

  await gotoStable(page, trainer ? '/profile' : '/me/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, trainer ? `/progress/${demoClientId}` : '/me/progress')
  nextStep = page.locator('.client-progress-next-step')
  await expect(nextStep.getByRole('button', { name: 'Выбрать этот шаг' })).toBeVisible()
  await nextStep.getByRole('button', { name: 'Выбрать этот шаг' }).click()
  await nextStep.scrollIntoViewIfNeeded()
  await expect(nextStep).toHaveScreenshot(`${trainer ? 'trainer' : 'client'}-progress-next-step-confirmed-dark-${process.platform}.png`, {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.025,
  })
})

test('client measurement management keeps its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'visual-trainer-1440', 'Client measurement management uses mobile visual profiles')
  await mockMeasurementProgress(page)
  await openClientProgress(page, { scheme: true })
  const management = page.locator('.client-progress-measurement')
  await management.scrollIntoViewIfNeeded()
  await expect(management.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await expect(management.getByRole('button', { name: /История/ })).toBeVisible()
  await expect(management.getByRole('button', { name: /Настроить/ })).toBeVisible()
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
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
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

async function openWorkoutForDetailReview(page: import('@playwright/test').Page, trainer: boolean) {
  if (!trainer) {
    await openPreviewLiveWorkout(page)
    return
  }
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await gotoStable(page, `/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Жим лёжа')
  await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByRole('button', { name: /^Сохранить(?: план)?$/ }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible()
}

test('workout detail, completion and exercise history keep their visual baselines', async ({ page }, testInfo) => {
  const trainer = testInfo.project.name === 'visual-trainer-1440'
  await openWorkoutForDetailReview(page, trainer)
  await page.getByLabel('Фактический вес').first().fill('42.5')
  await page.getByLabel('Фактические повторы').first().fill('9')
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.locator('.live-set-compact.confirmed')).toBeVisible()
  // Добавляем реальное незавершённое упражнение, чтобы деталь стабильно
  // покрывала partial независимо от числа подходов в исходном плане.
  await page.getByRole('button', { name: '＋ Ещё упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill('Берпи')
  await page.getByRole('button', { name: /^Берпи/ }).click()
  await expect(page.getByRole('heading', { name: 'Берпи' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  const partialFinish = page.getByRole('button', { name: 'Завершить', exact: true })
  if (await partialFinish.isVisible()) await partialFinish.click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  const detailPath = new URL(page.url()).pathname
  await expectVisualBaseline(page, `workout-detail-completion-${process.platform}.png`)

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
  await expect(detailedAnalysis.getByRole('heading', { name: 'Результат периода' })).toBeVisible()
  await expect(detailedAnalysis.getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
  await expect(detailedAnalysis.getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
  await detailedAnalysis.getByRole('button', { name: 'Закрыть' }).click()
})

test('trainer Progress and measurements form keep their visual baselines in both themes', async ({ page }, testInfo) => {
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  const profile = testInfo.project.name === 'visual-trainer-1440' ? 'desktop' : 'mobile'

  await gotoStable(page, `/progress/${demoClientId}`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByLabel('ИИ-анализ тренировок')).toBeVisible()
  const coachmark = page.getByRole('button', { name: 'Понятно' })
  if (await coachmark.isVisible()) await coachmark.click()
  await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
  await expectVisualBaseline(page, `trainer-progress-${profile}-${process.platform}.png`, [], true)
  await page.getByRole('button', { name: 'Подробный анализ' }).click()
  const lightDetails = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(lightDetails.getByRole('heading', { name: 'Результат периода' })).toBeVisible()
  await expect(lightDetails.getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
  await expect(lightDetails.getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-progress-details-${profile}-${process.platform}.png`, [], true)
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
  await expect(darkDetails.getByRole('heading', { name: 'Результат периода' })).toBeVisible()
  await expect(darkDetails.getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
  await expect(darkDetails.getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
  await expectVisualBaseline(page, `trainer-progress-details-${profile}-dark-${process.platform}.png`, [], true, '#1d1e21')
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
  await signIn(page, 'trainer@fit.local', /\/today$/)
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await gotoStable(page, '/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expect(page.getByRole('link', { name: /Анна Смирнова/ }).first()).toBeVisible()
  await expectVisualBaseline(page, `trainer-clients-mobile-${process.platform}.png`, [], true)

  await gotoStable(page, '/profile')
  await page.getByRole('switch', { name: 'Тёмная тема' }).check()
  await gotoStable(page, '/clients')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-clients-identity/)
  await expectVisualBaseline(page, `trainer-clients-mobile-dark-${process.platform}.png`, [], true, '#1d1e21')
})

test('trainer Client Detail keeps its visual baselines', async ({ page }, testInfo) => {
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
    await page.getByRole('button', { name: /Жим лёжа/ }).first().click()
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
