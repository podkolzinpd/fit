import { expect, type Locator, type Page } from '@playwright/test'
import type { WorkoutExercise, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../src/shared/domain'
import type { TrainerFinanceClientBundle, TrainerFinancePackageDraft, TrainerFinancePaymentDraft } from '../src/data/repositories/trainer-finance.repository'
import { computeClientStats } from '../src/data/repositories/workout-rules'
import { workoutHomeSummaries } from '../src/data/repositories/workout-home'
import { localDate } from '../src/shared/local-date'

// Synthetic, page-scoped mocks shared by behavior and visual acceptance.

export async function mockFinancePaymentLifecycle(page: Page) {
  const ledger: TrainerFinanceClientBundle = { clientId, packages: [], payments: [], sessions: [] }
  const receiptIds: string[] = []
  const updateTotals = () => {
    const service = ledger.packages[0]!
    service.paidCents = ledger.payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + payment.amountCents, 0)
    service.dueCents = Math.max(0, service.priceCents - service.paidCents)
    service.paymentStatus = service.dueCents === 0 ? 'paid' : service.paidCents ? 'partial' : 'unpaid'
  }
  await page.route(`**/v1/clients/${clientId}/finance`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ finance: ledger }) }))
  await page.route(`**/v1/clients/${clientId}/finance/packages`, async (route) => {
    const draft = route.request().postDataJSON() as TrainerFinancePackageDraft
    expect(draft.openingReceivedOn).toBe('2026-08-27')
    expect(draft.requestId).toBeTruthy()
    ledger.packages.push({ ...draft, id: newWorkoutId, clientId, trainerId, sessionsUsed: 0, sessionsRemaining: draft.sessionsTotal, paidCents: draft.openingPaidCents, dueCents: draft.priceCents - draft.openingPaidCents, packageStatus: 'active', paymentStatus: 'partial', closedAt: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' })
    ledger.payments.push({ id: messageId, packageId: newWorkoutId, amountCents: draft.openingPaidCents, receivedOn: draft.openingReceivedOn!, source: 'opening', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ package: ledger.packages[0] }) })
  })
  await page.route(`**/v1/finance/packages/${newWorkoutId}/payments`, async (route) => {
    const draft = route.request().postDataJSON() as TrainerFinancePaymentDraft
    expect(draft.requestId).toBeTruthy()
    receiptIds.push(draft.requestId!)
    const payment = { ...draft, id: `20000000-0000-4000-8000-${String(receiptIds.length).padStart(12, '0')}`, packageId: newWorkoutId, source: 'manual' as const, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
    ledger.payments.push(payment)
    updateTotals()
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ payment }) })
  })
  await page.route('**/v1/finance/payments/*', async (route) => {
    const payment = ledger.payments.find((item) => item.id === new URL(route.request().url()).pathname.split('/').pop())!
    if (route.request().method() === 'DELETE') payment.voidedAt = '2026-10-07T00:00:00Z'
    else { Object.assign(payment, route.request().postDataJSON()); payment.version += 1 }
    updateTotals()
    await route.fulfill({ status: route.request().method() === 'DELETE' ? 204 : 200, contentType: 'application/json', body: route.request().method() === 'DELETE' ? '' : JSON.stringify({ payment }) })
  })
  return { ledger, receiptIds }
}

// Prepares the final visual state; business transitions are tested through UI
// in behavior acceptance, not reproduced for every theme/viewport.
export function seedPaidFinanceFixture(ledger: TrainerFinanceClientBundle) {
  const opening = ledger.payments[0]!
  ledger.payments = [opening, {
    ...opening, id: '20000000-0000-4000-8000-000000000002',
    amountCents: 2_000_000, receivedOn: '2026-09-24', source: 'manual',
  }]
  Object.assign(ledger.packages[0]!, {
    paidCents: 3_000_000, dueCents: 0, paymentStatus: 'paid',
  })
}

export async function mockTemplateUncertainSave(page: Page) {
  const rows = new Map<string, object>()
  const commands: Array<{ draft: WorkoutTemplateDraft; expectedVersion: number | null }> = []
  await page.route('http://127.0.0.1:4100/v1/workout-templates', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { templates: [...rows.values()] } })
    const command = route.request().postDataJSON() as typeof commands[number]
    commands.push(command)
    const row = rows.get(command.draft.id) ?? { ...command.draft, trainerId, notes: command.draft.notes ?? null, version: 1, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
    rows.set(command.draft.id, row)
    if (commands.length === 1) return route.abort('connectionreset')
    return route.fulfill({ json: { template: row } })
  })
  return { rows, commands }
}

export async function copyTemplateDiagnostic(page: Page) {
  const alert = page.getByRole('alert')
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: {
      writeText: (text: string) => {
        localStorage.setItem('template-test-diagnostics', text)
        return Promise.resolve()
      },
    },
  }))
  await alert.getByRole('button', { name: 'Скопировать диагностику' }).click()
  await expect(alert.getByRole('status')).toHaveText('Скопировано')
  return page.evaluate(() => localStorage.getItem('template-test-diagnostics'))
}

export const trainerId = '10000000-0000-4000-8000-000000000001'

export const clientId = '10000000-0000-4000-8000-000000000002'

export const workoutId = '10000000-0000-4000-8000-000000000003'

export const conversationId = '10000000-0000-4000-8000-000000000004'

export const messageId = '10000000-0000-4000-8000-000000000005'

export const newWorkoutId = '10000000-0000-4000-8000-000000000006'

export const customExerciseId = '10000000-0000-4000-8000-000000000070'

export const sessionToken = 's'.repeat(43)

export function coachGestureWorkout(grouped = false, count = grouped ? 4 : 3): MockWorkout {
  const source = restTimerWorkout()
  source.exercises[0]!.restBetweenSetsSec = 90
  const base = source.exercises[0]!
  source.exercises = Array.from({ length: count }, (_, position) => ({
    ...base, id: `c0ac0000-6010-4000-8000-0000000001${position}0`, name: ['Приседания', 'Жим', 'Тяга', 'Планка'][position] ?? `Упражнение ${position + 1}`, position,
    blockId: grouped && position === 1 ? base.blockId : position === 0 ? base.blockId : `c0ac0000-6010-4000-8000-0000000002${position}0`,
    blockType: grouped && position < 2 ? 'group' : 'single',
    sets: base.sets.map((set, index) => ({ ...set, id: `c0ac0000-6010-4000-8000-000000000${position}3${index}` })),
  }))
  return source
}

export async function revealCoachSetDelete(page: Page, row: Locator) {
  const number = row.locator('.live-set-number, .planned-set-number')
  await number.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await expect.poll(() => number.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
  const box = (await number.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(Math.max(1, x - 36), y, { steps: 6 }); await page.mouse.up()
}

export async function holdClientLiveCard(page: Page, blockId: string) {
  const card = page.locator(`[data-workout-block="${blockId}"]`)
  const anchor = card.locator('.circuit-head, .live-exercise-head, .workout-exercise-compact').first()
  await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }))
  const box = (await card.boundingBox())!, header = (await anchor.boundingBox())!
  await page.mouse.move(box.x + 8, header.y + 8)
  await page.mouse.down()
  await expect(card).toHaveClass(/dragging/)
  return card
}

export async function expectContainedButtonText(button: Locator) {
  const geometry = await button.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return { width: bounds.width, height: bounds.height, contained: Array.from(range.getClientRects()).every((rect) =>
      rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom) }
  })
  expect(geometry.width).toBeGreaterThanOrEqual(44)
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  expect(geometry.contained).toBe(true)
}

export async function addEditorExercise(page: Page) {
  await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1', exact: true }).click()
}

export async function checkEditorAction(page: Page, screenshotPath: string) {
  const edit = page.locator('.workout-editor-footer .overflow-trigger')
  await edit.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await expectContainedButtonText(edit)
  const add = page.locator('.workout-editor-footer').getByRole('button', { name: /Упражнение$/ })
  const editBounds = (await edit.boundingBox())!, addBounds = (await add.boundingBox())!
  expect(Math.abs(editBounds.y + editBounds.height / 2 - addBounds.y - addBounds.height / 2)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Сбросить значения', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

export function restTimerWorkout(prepSeconds = 0, timed = false, executionMode?: 'timer' | 'manual'): MockWorkout {
  const exercise: WorkoutExercise = {
    id: '10000000-0000-4000-8000-000000000080', source: 'system', ref: timed ? 'plank' : 'squat',
    name: timed ? 'Планка' : 'Приседания', muscleGroup: 'legs', inputKind: timed ? 'duration' : 'strength', position: 0,
    blockId: '10000000-0000-4000-8000-000000000081', blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 2,
    sets: [82, 83].map((suffix, position) => ({ id: `10000000-0000-4000-8000-0000000000${suffix}`, position,
      ...(timed ? { durationSec: 3 } : { weightKg: 20, reps: 10 }), fact: {}, confirmedAt: null, version: 1 })),
  }
  return { ...workout, status: 'in_progress', startedAt: '2026-10-08T09:00:00Z', ...(prepSeconds > 0 ? { prepSeconds } : {}), ...(executionMode ? { executionMode } : {}), exercises: [exercise] }
}

export const workout = {
  id: workoutId,
  trainerId,
  clientId,
  clientName: 'Алексей Смирнов',
  createdBy: trainerId,
  trainingFormat: 'with_trainer' as const,
  startedBy: null,
  completedBy: null,
  workoutDate: '2026-09-24',
  startTime: '10:00',
  endTime: '11:00',
  status: 'planned',
  notes: null,
  clientComment: null,
  sessionRpe: null,
  wellbeing: null,
  discomfort: null,
  feedbackSubmittedAt: null,
  trainerReaction: null,
  trainerReview: null,
  trainerReviewAuthorId: null,
  trainerReviewedAt: null,
  clientQuestion: null,
  clientQuestionAskedAt: null,
  clientQuestionResolvedAt: null,
  startedAt: null,
  completedAt: null,
  version: 1,
  exercises: [] as WorkoutExercise[],
}

export type MockWorkout = Omit<typeof workout, 'notes' | 'startTime' | 'endTime' | 'startedAt' | 'completedAt' | 'createdBy' | 'trainingFormat' | 'sessionRpe' | 'wellbeing' | 'discomfort' | 'clientComment' | 'feedbackSubmittedAt'> & { notes: string | null; clientComment:string | null; feedbackSubmittedAt:string | null; sessionRpe?: number | null; wellbeing?: 'good' | 'normal' | 'bad' | null; discomfort?: boolean | null; createdBy: string | null; startTime: string | null; endTime: string | null; startedAt: string | null; completedAt: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer'; plannedDate?: string; plannedStartTime?: string | null; plannedEndTime?: string | null; prepSeconds?: number; actualDurationSec?: number | null; activeCaloriesKcal?: number | null; calorieEstimateBasis?: string | null; calorieEstimateNotice?: string | null }

export async function mockPilot(page: Page, options: { role?: 'trainer' | 'client'; profileId?: string; clientTrainerId?: string; pilot?: boolean; fitLime?: boolean; clientLime?: boolean; scheduleDensity?: 'comfortable' | 'compact'; hasClients?: boolean; clientRecords?: Array<{ id: string; fullName: string; archivedAt: string | null; version: number }>; workouts?: MockWorkout[]; withGoal?: boolean; withMeasurements?: boolean; clientGender?: 'male' | 'female'; withCustomExercise?: boolean; failProgress?: boolean; failProfile?: boolean; failFirstProfileSave?: boolean; failFirstCustomExerciseSave?: boolean; failArchive?: boolean; failClients?: boolean; failTrainingData?: boolean; failConnections?: boolean; failWorkspace?: boolean; failThreads?: boolean; questionWorkout?: boolean; failFirstSetConfirm?: boolean; failFirstSave?: boolean; failFirstChatSend?: boolean; failAppendAfterCommitAt?: number; showFeedbackNotice?: boolean; unseenCoachmarks?: string[] } = {}) {
  const profileId = options.profileId ?? trainerId
  const apiOrigin = process.env.VITE_YANDEX_API_BASE_URL ?? 'http://127.0.0.1:4100'
  let snoozedUntil: string | null = null
  let failClients = options.failClients ?? false
  let failTrainingData = options.failTrainingData ?? false
  let failConnections = options.failConnections ?? false
  let failProgress = options.failProgress ?? false
  let failProfile = options.failProfile ?? false
  let failArchive = options.failArchive ?? false
  let failWorkspace = options.failWorkspace ?? false
  let failThreads = options.failThreads ?? false
  let questionAnswered = false
  let unreadCount = 4
  let workouts: MockWorkout[] = options.workouts ?? [{ ...workout,
    ...(options.role !== 'client' ? { trainerId: profileId, createdBy: profileId } : {}),
  }]
  const appendCommands: Array<{ exercise: { source: string; ref: string; name: string; muscleGroup: WorkoutExercise['muscleGroup']; inputKind: WorkoutExercise['inputKind'] }; operationId: string; expectedVersion: number }> = []
  const appendReceipts = new Map<string, number>()
  let appendCount = 0
  let clientRecords = options.clientRecords ?? [{ id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 }]
  let goalRecord: Record<string, unknown> | null = options.withGoal ? {
    id: '10000000-0000-4000-8000-000000000040', clientId, title: 'Подготовка к старту', targetDate: '2026-12-01',
    status: 'active', version: 1, criteria: [], stages: [{ id: '10000000-0000-4000-8000-000000000041', goalId: '10000000-0000-4000-8000-000000000040', title: 'База', startsOn: '2026-09-01', endsOn: '2026-10-01', position: 0, version: 1 }],
  } : null
  let progressEntries = options.withMeasurements ? [{
    id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: profileId, recordedOn: '2026-09-24',
    weightKg: 70 as number | null, chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1,
  }] : []
  let failFirstSetConfirm = options.failFirstSetConfirm ?? false
  let saveAttempts = 0
  let chatSendAttempts = 0
  let profileSaveAttempts = 0
  let customExerciseSaveAttempts = 0
  let customExercises = options.withCustomExercise ? [{ id: customExerciseId, name: 'Мой присед', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: null, equipment: null, description: null, archivedAt: null as string | null, version: 1, createdBy: profileId }] : []
  let scheduleDensity = options.scheduleDensity ?? 'comfortable'
  let professionalProfile = {
    publicId: '10000000-0000-4000-8000-000000000060',
    draft: { displayName: 'Антон', bio: '', specialties: [] as string[], city: '', metroStationIds: [] as string[], customLocations: [] as string[], trainingModes: [] as string[], experienceStartYear: null as number | null, education: '', formats: '', price: '', acceptingClients: false, avatarDataUrl: null as string | null, photos: [], certificates: [] },
    published: null as Record<string, unknown> | null,
    listedInCatalog: false,
    publishedAt: null as string | null,
    updatedAt: '2026-09-24T09:00:00.000Z',
    version: 1,
    isBrandTrainer: false,
  }
  const sentMessages: Array<{ id: string; conversationId: string; senderId: string; body: string; createdAt: string; editedAt: null; replyTo: null; image: null }> = []
  let lastSavedStartTime: string | null = null
  let lastEditedStartTime: string | null = null
  await page.route(`${apiOrigin}/health`, async (route) => {
    await route.fulfill({ status: 200, headers: { 'x-fit-request-id': 'pilot-health-check', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-fit-request-id' }, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.addInitScript(({ token, profileId, showFeedbackNotice, unseenCoachmarks }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
    const coachmarkKey = `fit.coachmarks-seen.${profileId}`
    const seen = JSON.parse(localStorage.getItem(coachmarkKey) ?? '[]') as string[]
    localStorage.setItem(coachmarkKey, JSON.stringify([...seen, ...[
      'assistant-all-trainers-2026-09',
      'client-assistant-2026-09',
      'missed-workout-actions-2026-08',
      'live-timer-2026-09',
      'live-phase-timer-2026-10',
      'live-timer-mode-2026-10',
      'live-timer-mode-pause-2026-10',
      'live-timer-pause-2026-10',
      'coach-workout-gestures-2026-10',
      'coach-live-number-gestures-2026-10',
      'coach-live-set-swipe-2026-10-16',
      'coach-schedule-filters-2026-10-16',
      'coach-schedule-guide-fixed2-2026-10-17',
      'coach-live-finish-top-2026-10',
      'lime-quick-plan-2026-10',
      'lime-direct-client-start-2026-10',
      'lime-day-workspace-2026-10',
      'lime-schedule-history-2026-10',
      'lime-schedule-ownership-2026-10',
      'client-live-multiple-exercises-2026-10',
      'client-live-card-drag-2026-10',
      ...(showFeedbackNotice ? [] : ['workout-feedback-compact-2026-10']),
    ].filter(id => !unseenCoachmarks.includes(id))]))
  }, { token: sessionToken, profileId, showFeedbackNotice: options.showFeedbackNotice ?? false, unseenCoachmarks: options.unseenCoachmarks ?? [] })
  await page.route(`${apiOrigin}/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/assistant/yandex/suggest-goal-criteria' || url.pathname === '/v1/assistant/yandex/parse-workout' || url.pathname === '/v1/assistant/turn' || url.pathname.endsWith('/training-summaries/generate')) return route.fallback()
    let body: unknown
    if (url.pathname === '/v1/auth/yandex/session' && route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else if (url.pathname === '/v1/auth/yandex/session') {
      body = {
        accessMode: 'read_write',
        profile: {
          id: profileId,
          firstName: 'Антон',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: options.role ?? 'trainer',
          ...(options.role === 'client' ? { client: { id: clientId, trainerId: options.clientTrainerId ?? trainerId, fullName: 'Алексей Смирнов' } } : {}),
          experiments: { trainerScheduleV2: options.pilot !== false, fitLime: options.fitLime === true, clientLime: options.role === 'client' && (options.clientLime === true || (options.profileId === clientId && options.clientLime !== false)) },
          preferences: { scheduleDensity },
        },
      }
    } else if (url.pathname === '/v1/profile' && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { scheduleDensity?: 'comfortable' | 'compact' }
      if (draft.scheduleDensity) scheduleDensity = draft.scheduleDensity
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else if (url.pathname === '/v1/trainers/catalog') {
      body = { items: [], totalCount: 0, nextOffset: null }
    } else if (url.pathname === '/v1/me/finance') {
      body = { finance: { trainers: [] } }
    } else if (url.pathname === '/v1/me/sport-profile') {
      body = { sport: { sports: [], bio: null } }
    } else if (url.pathname === '/v1/finance/overview') {
      body = { overview: { month: url.searchParams.get('month'), receivedCents: 0, dueCents: 0, attentionCount: 0, clients: [] } }
    } else if (url.pathname === `/v1/clients/${clientId}/finance`) {
      body = { finance: { clientId, packages: [], payments: [], sessions: [] } }
    } else if (url.pathname === '/v1/workout-templates') {
      body = { templates: [] }
    } else if (url.pathname === '/v1/legal/acceptance') {
      body = { applicable: true, accepted: true, acceptedAt: '2026-09-01T00:00:00.000Z' }
    } else if (url.pathname === '/v1/trainer-profile' && route.request().method() === 'GET') {
      if (failProfile) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile' && route.request().method() === 'PUT') {
      profileSaveAttempts += 1
      if (options.failFirstProfileSave && profileSaveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      professionalProfile = { ...professionalProfile, draft: route.request().postDataJSON() as typeof professionalProfile.draft, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/photos' && route.request().method() === 'POST') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"photo unavailable"}' })
      return
    } else if (url.pathname === '/v1/trainer-profile/publish' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, published: professionalProfile.draft, listedInCatalog: true, publishedAt: '2026-09-24T09:01:00.000Z', version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/unpublish' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, published: null, listedInCatalog: false, publishedAt: null, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === '/v1/trainer-profile/catalog' && route.request().method() === 'POST') {
      professionalProfile = { ...professionalProfile, listedInCatalog: (route.request().postDataJSON() as { listed: boolean }).listed, version: professionalProfile.version + 1 }
      body = professionalProfile
    } else if (url.pathname === `/v1/clients/${clientId}/workout-stats`) {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { stats: computeClientStats(workouts.map((item) => {
        const status = item.status
        if (status !== 'planned' && status !== 'in_progress' && status !== 'done' && status !== 'cancelled') {
          throw new Error('Invalid workout fixture status')
        }
        return { id: item.id, workoutDate: localDate(item.workoutDate), status }
      }),
      localDate(url.searchParams.get('today') ?? '2026-10-06')) }
    } else if (url.pathname === '/v1/workouts/home') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { workouts: workoutHomeSummaries(workouts.map((item) => {
        const status = item.status
        if (status !== 'planned' && status !== 'in_progress' && status !== 'done' && status !== 'cancelled') throw new Error('Invalid workout fixture status')
        return { ...item, status, workoutDate: localDate(item.workoutDate) }
      }), localDate(url.searchParams.get('today') ?? '2026-10-06')) }
    } else if (url.pathname.endsWith('/active-workout')) {
      const active = workouts.find((item) => item.clientId === url.pathname.split('/')[3] && item.status === 'in_progress')
      body = { workout: active ? { id: active.id, workoutDate: active.workoutDate, status: active.status } : null }
    } else if (url.pathname === '/v1/training-data') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const trainingData = {
        accessMode: 'read_only',
        customExercises,
        workouts: options.questionWorkout ? [{
          ...workout,
          status: 'done',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          clientQuestionResolvedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          trainerReview: questionAnswered ? 'Да, можно заменить.' : null,
          trainerReviewedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          completedAt: '2026-09-24T11:00:00.000Z',
          version: questionAnswered ? 2 : 1,
        }] : workouts.map((item) => ({ ...item, exercises: item.exercises.map((exercise) => ({ ...exercise, customExerciseId: exercise.customExerciseId ?? null, trainerComment: exercise.trainerComment ?? null,
          sets: exercise.sets.map((set) => ({ ...set,
            plan: { weightKg: set.weightKg ?? null, reps: set.reps ?? null, durationMin: set.durationMin ?? null, durationSec: set.durationSec ?? null, distanceKm: set.distanceKm ?? null, rpe: set.rpe ?? null },
            fact: { weightKg: set.fact.weightKg ?? null, reps: set.fact.reps ?? null, durationMin: set.fact.durationMin ?? null, durationSec: set.fact.durationSec ?? null, distanceKm: set.fact.distanceKm ?? null, rpe: set.fact.rpe ?? null },
          })),
        })) })),
        attention: options.questionWorkout && !questionAnswered ? [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          workoutDate: '2026-09-24',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          discomfort: false,
          clientComment: null,
          feedbackSubmittedAt: '2026-09-24T11:30:00.000Z',
          version: 1,
        }] : [],
        attentionPreferences: snoozedUntil ? [{ clientId, snoozedUntil }] : [],
        hasMoreWorkouts: false,
        totalWorkouts: workouts.length,
      }
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 100)
      const scope = url.searchParams.get('scope')
      const filtered = trainingData.workouts.filter((item) =>
        (!url.searchParams.has('clientId') || item.clientId === url.searchParams.get('clientId'))
        && (!url.searchParams.has('workoutId') || item.id === url.searchParams.get('workoutId'))
        && (!url.searchParams.has('from') || item.workoutDate >= url.searchParams.get('from')!)
        && (!url.searchParams.has('to') || item.workoutDate <= url.searchParams.get('to')!))
        .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate) || left.id.localeCompare(right.id))
      body = {
        ...trainingData,
        ...(scope === 'workouts' ? { customExercises: [], attention: [], attentionPreferences: [] } : {}),
        workouts: scope === 'metadata' ? [] : filtered.slice(offset, offset + limit),
        hasMoreWorkouts: scope !== 'metadata' && offset + limit < filtered.length,
        totalWorkouts: scope === 'metadata' ? 0 : filtered.length,
      }
    } else if (url.pathname === '/v1/custom-exercises' && route.request().method() === 'POST') {
      customExerciseSaveAttempts += 1
      if (options.failFirstCustomExerciseSave && customExerciseSaveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { name: string; muscleGroup: string; inputKind: string }
      const exercise = { id: customExerciseId, ...draft, primaryMuscleDetail: null, equipment: null, description: null, archivedAt: null, version: 1, createdBy: profileId }
      customExercises = [exercise]
      body = { exercise }
    } else if (url.pathname === `/v1/custom-exercises/${customExerciseId}` && route.request().method() === 'PUT') {
      const command = route.request().postDataJSON() as { draft: { name: string; muscleGroup: string; inputKind: string } }
      customExercises = customExercises.map((item) => ({ ...item, ...command.draft, version: item.version + 1 }))
      body = { exercise: customExercises[0] }
    } else if (url.pathname === `/v1/custom-exercises/${customExerciseId}/archive` && route.request().method() === 'PUT') {
      if (failArchive) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const command = route.request().postDataJSON() as { archived: boolean }
      customExercises = customExercises.map((item) => ({ ...item, archivedAt: command.archived ? '2026-09-24T09:00:00.000Z' : null, version: item.version + 1 }))
      body = { exercise: customExercises[0] }
    } else if (url.pathname === '/v1/clients' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as { fullName: string }
      clientRecords = [...clientRecords, { id: '10000000-0000-4000-8000-000000000030', fullName: input.fullName, archivedAt: null, version: 1 }]
      body = { client: { id: '10000000-0000-4000-8000-000000000030' } }
    } else if (url.pathname === '/v1/clients') {
      if (failClients) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { clients: options.hasClients === false ? [] : clientRecords.filter((client) => url.searchParams.get('archived') === 'true' ? client.archivedAt !== null : client.archivedAt === null).map((client) => ({
        id: client.id,
        canArchive: true,
        hasAccount: true,
        fullName: client.fullName,
        canonicalFullName: client.fullName,
        gender: options.clientGender ?? null,
        ageYears: null,
        ageUpdatedAt: null,
        heightCm: null,
        goal: null,
        note: null,
        currentWeightKg: null,
        archivedAt: client.archivedAt,
        version: client.version,
        membershipVersion: 1,
      })) }
    } else if (url.pathname === '/v1/connections') {
      if (failConnections) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { memberships: clientRecords.map((client) => ({ clientId: client.id, trainerId: profileId, firstName: 'Антон', lastName: null, joinedAt: '2026-09-01T00:00:00.000Z', isRoot: true })), invitations: [] }
    } else if (url.pathname === '/v1/progress' && route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as { draft: { recordedOn: string; weightKg: number | null } }
      progressEntries = [{ id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: profileId, recordedOn: command.draft.recordedOn,
        weightKg: command.draft.weightKg, chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1 }]
      body = { progress: { id: '10000000-0000-4000-8000-000000000050' } }
    } else if (url.pathname === '/v1/progress/10000000-0000-4000-8000-000000000050' && route.request().method() === 'DELETE') {
      progressEntries = []
      body = { progress: { version: 2 } }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress$/.test(url.pathname)) {
      if (failProgress) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { entries: progressEntries, customMetrics: [], goal: goalRecord }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/exercises\//.test(url.pathname)) {
      body = { items: [], nextCursor: null, totalCount: 0 }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/regularity$/.test(url.pathname)) {
      body = { regularity: [{ period: 'week', periodStart: '2026-09-21', periodEnd: '2026-09-27', plannedCount: 1, completedCount: 0, completedPlannedCount: 0, partialCount: 0, skippedCount: 0, completionPercent: null }] }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/progress\/running$/.test(url.pathname)) {
      body = { sessions: [] }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/training-summaries$/.test(url.pathname)) {
      body = { summaries: [] }
    } else if (url.pathname === '/v1/goals' && route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as { draft: { title: string; targetDate: string | null } }
      goalRecord = { id: '10000000-0000-4000-8000-000000000040', clientId, title: command.draft.title, targetDate: command.draft.targetDate, status: 'active', version: 1, criteria: [], stages: [] }
      body = { goal: { id: '10000000-0000-4000-8000-000000000040' } }
    } else if (/^\/v1\/clients\/[0-9a-f-]+\/archive$/.test(url.pathname) && route.request().method() === 'PUT') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { archived: boolean; expectedVersion: number }
      clientRecords = clientRecords.map((client) => client.id === id ? { ...client, archivedAt: command.archived ? '2026-09-24T12:00:00.000Z' : null, version: client.version + 1 } : client)
      body = { client: { id, version: command.expectedVersion + 1 } }
    } else if (url.pathname === `/v1/clients/${clientId}/attention/snooze` && route.request().method() === 'POST') {
      snoozedUntil = '2099-01-01T00:00:00.000Z'
      body = { client: { snoozedUntil } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/question/answer` && route.request().method() === 'PUT') {
      questionAnswered = true
      body = { workout: { version: 2 } }
    } else if (/^\/v1\/workout-sets\/[0-9a-f-]+$/.test(url.pathname) && route.request().method() === 'DELETE') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { expectedVersion: number; expectedSetVersion?: number }
      if (command.expectedSetVersion !== undefined) {
        const item = workouts.find(item => item.exercises.some(exercise => exercise.sets.some(set => set.id === id)))
        const exercise = item?.exercises.find(exercise => exercise.sets.some(set => set.id === id)), set = exercise?.sets.find(set => set.id === id)
        if (!item || !set || command.expectedVersion !== item.version || command.expectedSetVersion !== set.version) {
          await route.fulfill({ status: 409, json: { error: 'workout_conflict' } }); return
        }
        if (!exercise || exercise.sets.length <= 1 || exercise.blockType !== 'single') {
          await route.fulfill({ status: 422, json: { error: 'workout_invalid' } }); return
        }
      }
      workouts = workouts.map((item) => item.exercises.some((exercise) => exercise.sets.some((set) => set.id === id))
        ? { ...item, version: item.version + 1, exercises: item.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.id !== id).map((set, position) => ({ ...set, position })) })) } : item)
      body = { set: { version: workouts.find((item) => item.id === workoutId)!.version } }
    } else if (/^\/v1\/workout-sets\/[0-9a-f-]+\/(draft|confirm)$/.test(url.pathname)) {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { expectedVersion: number; draft?: { reps?: number; weightKg?: number; timerConfirmed?: true } }
      const confirmed = url.pathname.endsWith('/confirm')
      if (confirmed && failFirstSetConfirm) { failFirstSetConfirm = false; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }); return }
      workouts = workouts.map((item) => ({ ...item, exercises: item.exercises.map((exercise) => ({ ...exercise,
        sets: exercise.sets.map((set) => {
          if (set.id !== id) return set
          // Как сервер: пометку ставит только черновик таймера, любое другое сохранение снимает.
          const { timerConfirmed: previousTimer, ...rest } = set as typeof set & { timerConfirmed?: true }
          const timerConfirmed = command.draft ? command.draft.timerConfirmed === true : previousTimer === true
          return { ...rest, fact: command.draft ?? set.fact, ...(timerConfirmed ? { timerConfirmed: true as const } : {}),
            confirmedAt: confirmed ? '2026-09-24T09:01:00Z' : set.confirmedAt, version: command.expectedVersion + 1 }
        }),
      })) }))
      body = { set: { version: command.expectedVersion + 1 } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/blocks\/[0-9a-f-]+\/move$/.test(url.pathname) && route.request().method() === 'POST') {
      const id = url.pathname.split('/')[3]!, blockId = url.pathname.split('/')[5]!
      const command = route.request().postDataJSON() as { targetIndex: number; expectedVersion: number }
      workouts = workouts.map((item) => {
        if (item.id !== id) return item
        const blocks = [...new Set(item.exercises.map((exercise) => exercise.blockId))]
        blocks.splice(blocks.indexOf(blockId), 1); blocks.splice(command.targetIndex, 0, blockId)
        return { ...item, version: item.version + 1,
          exercises: blocks.flatMap((block) => item.exercises.filter((exercise) => exercise.blockId === block)).map((exercise, position) => ({ ...exercise, position })) }
      })
      body = { block: { id: blockId, version: workouts.find((item) => item.id === id)!.version, replayed: false } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/(start|finish)$/.test(url.pathname) && route.request().method() === 'POST') {
      const id = url.pathname.split('/')[3]
      const finished = url.pathname.endsWith('/finish')
      workouts = workouts.map((item) => item.id === id ? { ...item, status: finished ? 'done' : 'in_progress', completedAt: finished ? '2026-09-24T12:00:00Z' : null, version: item.version + 1 } : item)
      body = { workout: { version: workouts.find((item) => item.id === id)!.version } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/pause$/.test(url.pathname) && route.request().method() === 'POST') {
      // Как сервер: пауза запоминает момент, снятие копит её длительность.
      const id = url.pathname.split('/')[3]
      const { paused } = route.request().postDataJSON() as { paused: boolean }
      workouts = workouts.map((item) => {
        if (item.id !== id) return item
        const current = item as typeof item & { pausedAt?: string; pausedSeconds?: number }
        const added = !paused && current.pausedAt ? Math.round((Date.now() - Date.parse(current.pausedAt)) / 1000) : 0
        const { pausedAt: _previous, ...rest } = current
        void _previous
        return { ...rest, ...(paused ? { pausedAt: current.pausedAt ?? new Date().toISOString() } : {}), pausedSeconds: (current.pausedSeconds ?? 0) + added, version: item.version + 1 }
      })
      body = { workout: { version: workouts.find((item) => item.id === id)!.version } }
    } else if (/^\/v1\/workouts\/[^/]+\/feedback$/.test(url.pathname) && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { sessionRpe:number; wellbeing:'good' | 'normal' | 'bad'; discomfort:boolean; comment:string; expectedVersion:number }
      const current = workouts.find((item) => item.id === url.pathname.split('/')[3])!
      current.sessionRpe = draft.sessionRpe; current.wellbeing = draft.wellbeing; current.discomfort = draft.discomfort
      current.clientComment = draft.comment.trim() || null; current.feedbackSubmittedAt = '2026-10-10T12:00:00Z'
      current.version += 1
      body = { workout: { version:current.version } }
    } else if (url.pathname === '/v1/workouts/quick-start' && route.request().method() === 'POST') {
      workouts = [{ ...workout, id: newWorkoutId, status: 'in_progress' }]
      body = { workout: { id: newWorkoutId, resumed: false } }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/exercises$/.test(url.pathname) && route.request().method() === 'POST') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as (typeof appendCommands)[number]
      appendCommands.push(command)
      const receipt = appendReceipts.get(command.operationId)
      if (receipt) { body = { workout: { version: receipt } } }
      else {
        const current = workouts.find((item) => item.id === id)!
        if (current.version !== command.expectedVersion) { await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' }); return }
        appendCount++
        const exercise: WorkoutExercise = { ...command.exercise, source: command.exercise.source as 'system',
          id: `10000000-0000-4000-8000-${String(500 + appendCount).padStart(12, '0')}`,
          blockId: `10000000-0000-4000-8000-${String(600 + appendCount).padStart(12, '0')}`,
          position: current.exercises.length, blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenSetsSec: 90, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0,
          sets: [{ id: `10000000-0000-4000-8000-${String(700 + appendCount).padStart(12, '0')}`, position: 0, fact: {}, confirmedAt: null, version: 1 }],
        }
        const version = current.version + 1
        workouts = workouts.map((item) => item.id === id ? { ...item, version, exercises: [...item.exercises, exercise] } : item)
        appendReceipts.set(command.operationId, version)
        if (appendCount === options.failAppendAfterCommitAt) { await route.abort('failed'); return }
        body = { workout: { version } }
      }
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/duration$/.test(url.pathname) && route.request().method() === 'PUT') {
      const id = url.pathname.split('/')[3]
      const command = route.request().postDataJSON() as { actualDurationSec: number | null; expectedVersion: number }
      const current = workouts.find((item) => item.id === id)!
      if (current.version !== command.expectedVersion && current.actualDurationSec !== command.actualDurationSec) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' })
        return
      }
      workouts = workouts.map((item) => item.id === id ? { ...item, actualDurationSec: command.actualDurationSec, version: item.version + 1 } : item)
      body = { workout: { id, version: workouts.find((item) => item.id === id)!.version } }
    } else if ((url.pathname === '/v1/workouts' || url.pathname === '/v1/workouts/completed') && route.request().method() === 'POST') {
      saveAttempts += 1
      if (options.failFirstSave && saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const completed = url.pathname.endsWith('/completed')
      const draft = route.request().postDataJSON() as { clientId?: string; workoutDate: string; startTime?: string | null; endTime?: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer'; prepSeconds?: number; executionMode?: 'timer' | 'manual'; actualDurationSec?: number | null; exercises?: WorkoutExerciseDraft[] }
      lastSavedStartTime = draft.startTime ?? null
      const exercises: WorkoutExercise[] = (draft.exercises ?? []).map((exercise, index) => ({ ...exercise,
        id: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`, blockId: `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
        blockType: exercise.blockType ?? 'single', blockPreset: exercise.blockPreset ?? 'set', blockRounds: exercise.blockRounds ?? 1,
        restBetweenExercisesSec: exercise.restBetweenExercisesSec ?? 0, restBetweenRoundsSec: exercise.restBetweenRoundsSec ?? 0, restBetweenSetsSec: exercise.restBetweenSetsSec ?? 60,
        sets: exercise.sets.map((set, setIndex) => ({ ...set, id: `10000000-0000-4000-8000-${String(300 + index * 10 + setIndex).padStart(12, '0')}`, fact: completed ? set : {}, confirmedAt: completed ? '2026-09-24T12:00:00Z' : null, version: 1 })),
      }))
      workouts = [...workouts.filter((item) => item.id !== newWorkoutId), { ...workout, clientId: draft.clientId ?? workout.clientId, exercises, trainingFormat: draft.trainingFormat, id: newWorkoutId, title: draft.title, workoutDate: draft.workoutDate, startTime: draft.startTime ?? null, endTime: draft.endTime ?? null,
        createdBy: profileId, status: completed ? 'done' : 'planned', ...(draft.prepSeconds ? { prepSeconds: draft.prepSeconds } : {}), ...(draft.executionMode ? { executionMode: draft.executionMode } : {}), actualDurationSec: draft.actualDurationSec,
        completedAt: completed ? '2026-09-24T12:00:00Z' : null }]
      body = { workout: { id: newWorkoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}` && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null }
      lastEditedStartTime = draft.startTime ?? null
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', endTime: draft.endTime || '11:00', version: item.version + 1 }
        : item)
      body = { workout: { id: workoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/reschedule` && route.request().method() === 'POST') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null }
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', version: item.version + 1 }
        : item)
      body = { workout: { version: 2 } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/cancel` && route.request().method() === 'POST') {
      workouts = workouts.map((item) => item.id === workoutId ? { ...item, status: 'cancelled', version: item.version + 1 } : item)
      body = { workout: { version: 2 } }
    } else if (url.pathname === '/v1/assistant/conversations' && route.request().method() === 'POST') {
      body = { conversation: { id: conversationId, title: null, createdAt: '2026-09-27T12:00:00.000Z' } }
    } else if (url.pathname === '/v1/assistant/conversations') {
      body = { conversations: [] }
    } else if (url.pathname === `/v1/assistant/conversations/${conversationId}/messages`) {
      body = { messages: [] }
    } else if (url.pathname === '/v1/assistant/actions') {
      body = { actions: [] }
    } else if (url.pathname === '/v1/trainer-workspace') {
      if (failWorkspace) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = {
        summary: {
          pendingActionCount: 3,
          unresolvedQuestionCount: questionAnswered ? 0 : 1,
          unreadChatMessageCount: unreadCount,
          inboxCount: (questionAnswered ? 0 : 1) + unreadCount,
          updatedAt: '2026-09-24T12:00:00.000Z',
        },
        questions: questionAnswered ? [] : [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          question: 'Можно заменить приседания?',
          askedAt: '2026-09-24T11:30:00.000Z',
        }],
      }
    } else if (url.pathname === '/v1/chat/threads') {
      if (failThreads) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { threads: [{
        conversationId,
        clientId,
        trainerId,
        partnerUserId: clientId,
        partnerName: 'Алексей Смирнов',
        activeConnection: true,
        lastMessageBody: 'Спасибо!',
        lastMessageAt: '2026-09-24T11:45:00.000Z',
        lastMessageSenderId: clientId,
        unreadCount,
        canMessage: true,
        blockedByMe: false,
        blockedByPartner: false,
      }] }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages` && route.request().method() === 'POST') {
      chatSendAttempts += 1
      if (options.failFirstChatSend && chatSendAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { id: string; body: string }
      const message = { id: draft.id, conversationId, senderId: profileId, body: draft.body, createdAt: '2026-09-24T12:00:00.000Z', editedAt: null, replyTo: null, image: null }
      sentMessages.push(message)
      body = { message }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages`) {
      body = { messages: [{ id: messageId, conversationId, senderId: clientId, body: 'Спасибо!', createdAt: '2026-09-24T11:45:00.000Z', editedAt: null, replyTo: null, image: null }, ...sentMessages], nextCursor: null }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/unread`) {
      body = { unread: { firstMessageId: unreadCount > 0 ? messageId : null, firstCreatedAt: unreadCount > 0 ? '2026-09-24T11:45:00.000Z' : null, unreadCount } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/connection`) {
      body = { state: { activeConnection: true, invitationPending: false, invitedAt: null, canInvite: false, canAccept: false, trainerSwitchRequired: false } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/read` && route.request().method() === 'PUT') {
      unreadCount = 0
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return {
    getAppendCommands() { return appendCommands },
    getWorkouts() { return workouts },
    setClientsFailure(value: boolean) { failClients = value },
    setTrainingDataFailure(value: boolean) { failTrainingData = value },
    setConnectionsFailure(value: boolean) { failConnections = value },
    setProgressFailure(value: boolean) { failProgress = value },
    setProfileFailure(value: boolean) { failProfile = value },
    getProfileSaveAttempts() { return profileSaveAttempts },
    setArchiveFailure(value: boolean) { failArchive = value },
    getCustomExerciseSaveAttempts() { return customExerciseSaveAttempts },
    setWorkspaceFailure(value: boolean) { failWorkspace = value },
    setThreadsFailure(value: boolean) { failThreads = value },
    getSaveAttempts() { return saveAttempts },
    getLastSavedStartTime() { return lastSavedStartTime },
    getLastEditedStartTime() { return lastEditedStartTime },
    getChatSendAttempts() { return chatSendAttempts },
  }
}

export function scheduleVisibilityRows(): MockWorkout[] {
  return [
    { ...workout, title: 'Занятие с тренером' },
    { ...workout, id: newWorkoutId, title: 'Самостоятельный план', trainingFormat: 'self' },
    { ...workout, id: '10000000-0000-4000-8000-000000000007', title: 'Самостоятельный без времени', trainingFormat: 'self', startTime: null, endTime: null },
    { ...workout, id: '10000000-0000-4000-8000-000000000008', title: 'Создано спортсменом', clientName: 'Сам клиент', createdBy: clientId, trainingFormat: 'self', status: 'done' },
    { ...workout, id: '10000000-0000-4000-8000-000000000009', title: 'Старое занятие тренера', createdBy: null, startTime: '12:00', endTime: '13:00' },
  ]
}

export const limeClients = [
  { id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000021', fullName: 'Борис Иванов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000022', fullName: 'Вера Кузнецова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000023', fullName: 'Глеб Орлов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000024', fullName: 'Дарья Ершова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000025', fullName: 'Егор Панов', archivedAt: null, version: 1 },
]

export async function beginClientGesture(page: Page, surface: Locator, browserName: string, origin?: Locator) {
  await surface.scrollIntoViewIfNeeded()
  const initialBox = await surface.boundingBox()
  if (!initialBox) throw new Error('Client surface is not visible')
  let box = initialBox
  const originBox = origin ? await origin.boundingBox() : null
  if (origin && !originBox) throw new Error('Gesture origin is not visible')
  let from = originBox ? { x: originBox.x + originBox.width / 2, y: originBox.y + originBox.height / 2 }
    : { x: box.x + box.width * 0.88, y: box.y + box.height / 2 }
  // Expanded content can still be clipped by its height transition. Keep the
  // hit-target assertion, but wait for the actual point before sending a touch.
  await expect.poll(async () => {
    const currentBox = await surface.boundingBox()
    const currentOrigin = origin ? await origin.boundingBox() : null
    if (!currentBox || (origin && !currentOrigin)) return false
    const currentFrom = currentOrigin ? { x: currentOrigin.x + currentOrigin.width / 2, y: currentOrigin.y + currentOrigin.height / 2 }
      : { x: currentBox.x + currentBox.width * 0.88, y: currentBox.y + currentBox.height / 2 }
    const reachable = await surface.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), currentFrom)
    if (reachable) { box = currentBox; from = currentFrom }
    return reachable
  }).toBe(true)
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
  let position = from
  return {
    width: box.width,
    async move(distance: number, vertical = 0) {
      const to = { x: from.x - distance, y: from.y + vertical }
      const previous = position
      for (let step = 1; step <= 8; step += 1) {
        position = { x: previous.x + (to.x - previous.x) * step / 8, y: previous.y + (to.y - previous.y) * step / 8 }
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [position] })
        else await page.mouse.move(position.x, position.y)
      }
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    },
    async end(cancel = false) {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
        await cdp.detach()
      } else if (cancel) {
        // WebKit cancellation state is tested separately from its mouse path.
        await surface.dispatchEvent('pointercancel', { pointerId: 1 })
        await page.mouse.up()
      } else await page.mouse.up()
    },
  }
}

export async function openSwipeFixture(page: Page, fitLime: boolean, width = 390, theme = 'light') {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 })
  await mockPilot(page, { fitLime, clientRecords: limeClients.map((item, index) => index === 5 ? { ...item, fullName: 'Александра Константинопольская-Оченьдлиннаяфамилия' } : item) })
  await page.addInitScript((theme) => localStorage.setItem('fit.appTheme', theme), theme)
  await page.goto('/clients')
  await expect(page.locator('.client-swipe-surface').first()).toBeVisible()
  const tip = page.getByRole('status').filter({ hasText: /В архив одним свайпом|Чат — по нажатию, архив — свайпом/ })
  if (await tip.isVisible()) await tip.getByRole('button', { name: 'Понятно' }).click()
  return page.locator(`[data-client-swipe-id="${clientId}"]`)
}

export async function expectSwipeActionReadable(row: Locator) {
  const ratio = await row.locator('.client-swipe-actions').evaluate((rail) => {
    const luminance = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        const channel = v / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const foreground = luminance(getComputedStyle(rail.querySelector('button')!).color)
    const background = luminance(getComputedStyle(rail).backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

export async function mockClientStreamingVoice(page: import('@playwright/test').Page, transcript = 'Жим лёжа три подхода по десять 80 килограммов') {
  await page.addInitScript((recognizedText) => {
    const track = { stop() {} }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) } })
    class FakeAudioContext {
      sampleRate = 48_000
      destination = {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
      async close() {}
    }
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      binaryType = 'arraybuffer'
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor(url: string) { void url; window.setTimeout(() => this.onopen?.(), 0) }
      send(data: string | ArrayBuffer) {
        if (typeof data !== 'string') return
        const message = JSON.parse(data) as { type?: string }
        if (message.type === 'config') window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'partial', text: recognizedText.slice(0, 22) }) }), 20)
        if (message.type === 'stop') window.setTimeout(() => { this.onmessage?.({ data: JSON.stringify({ type: 'final', text: recognizedText }) }); this.onmessage?.({ data: JSON.stringify({ type: 'done' }) }) }, 20)
      }
      close() { this.readyState = 3 }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket })
  }, transcript)
}

export const publicTrainerId = '10000000-0000-4000-8000-000000000060'

export const publicTrainerDraft = {
  displayName: 'Тестовый тренер', bio: 'Анкета для проверки интерфейса без реальных пользовательских данных.',
  specialties: ['Тренажёрный зал / силовой тренинг'], city: 'Москва', metroStationIds: [], customLocations: ['Тестовый зал'],
  trainingModes: ['online', 'in_person'], experienceStartYear: 2020, education: 'Тестовое образование', formats: 'Индивидуальные занятия', price: 'По договорённости', acceptingClients: true,
  avatarDataUrl: null,
  photos: [0, 1].map((index) => ({ id: `10000000-0000-4000-8000-00000000006${index + 1}`, url: 'http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg', thumbnailUrl: 'http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg', mimeType: 'image/jpeg', width: 940, height: 1673 })),
  certificates: [{ title: 'Тестовый сертификат', organization: 'Фикстура', year: 2020 }],
}

export async function mockPublicTrainer(page: Page) {
  await page.route(`**/v1/trainers/${publicTrainerId}/public-profile`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ publicId: publicTrainerId, draft: publicTrainerDraft, published: publicTrainerDraft, listedInCatalog: true, publishedAt: '2026-09-24T09:00:00.000Z', updatedAt: '2026-09-24T09:00:00.000Z', version: 1, isBrandTrainer: false }) }))
  await page.route('**/v1/trainers/catalog*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ publicId: publicTrainerId, profile: publicTrainerDraft, isBrandTrainer: false }], totalCount: 1, nextOffset: null }) }))
}
