import { expect, test, type Page } from '@playwright/test'
import { buildFitLimeCalendarPlan } from '../services/api/src/db/fit-lime-calendar-plan'
import type { WorkoutExercise, WorkoutExerciseDraft } from '../src/shared/domain'

const trainerId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const workoutId = '10000000-0000-4000-8000-000000000003'
const conversationId = '10000000-0000-4000-8000-000000000004'
const messageId = '10000000-0000-4000-8000-000000000005'
const newWorkoutId = '10000000-0000-4000-8000-000000000006'
const customExerciseId = '10000000-0000-4000-8000-000000000070'
const sessionToken = 's'.repeat(43)

const workout = {
  id: workoutId,
  trainerId,
  clientId,
  clientName: 'Алексей Смирнов',
  createdBy: trainerId,
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

type MockWorkout = Omit<typeof workout, 'startTime' | 'endTime' | 'completedAt'> & { startTime: string | null; endTime: string | null; completedAt: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer' }

async function mockPilot(page: Page, options: { profileId?: string; pilot?: boolean; fitLime?: boolean; scheduleDensity?: 'comfortable' | 'compact'; hasClients?: boolean; clientRecords?: Array<{ id: string; fullName: string; archivedAt: string | null; version: number }>; workouts?: MockWorkout[]; withGoal?: boolean; withMeasurements?: boolean; withCustomExercise?: boolean; failProgress?: boolean; failProfile?: boolean; failFirstProfileSave?: boolean; failFirstCustomExerciseSave?: boolean; failArchive?: boolean; failClients?: boolean; failTrainingData?: boolean; failConnections?: boolean; failWorkspace?: boolean; failThreads?: boolean; questionWorkout?: boolean; failFirstSave?: boolean; failFirstChatSend?: boolean } = {}) {
  const profileId = options.profileId ?? trainerId
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
  let workouts: MockWorkout[] = options.workouts ?? [workout]
  let clientRecords = options.clientRecords ?? [{ id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 }]
  let goalRecord: Record<string, unknown> | null = options.withGoal ? {
    id: '10000000-0000-4000-8000-000000000040', clientId, title: 'Подготовка к старту', targetDate: '2026-12-01',
    status: 'active', version: 1, criteria: [], stages: [{ id: '10000000-0000-4000-8000-000000000041', goalId: '10000000-0000-4000-8000-000000000040', title: 'База', startsOn: '2026-09-01', endsOn: '2026-10-01', position: 0, version: 1 }],
  } : null
  let progressEntries = options.withMeasurements ? [{
    id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: profileId, recordedOn: '2026-09-24',
    weightKg: 70 as number | null, chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1,
  }] : []
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
  await page.route('http://127.0.0.1:4100/health', async (route) => {
    await route.fulfill({ status: 200, headers: { 'x-fit-request-id': 'pilot-health-check', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-fit-request-id' }, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.addInitScript(({ token, profileId }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
    localStorage.setItem(`fit.coachmarks-seen.${profileId}`, JSON.stringify([
      'assistant-all-trainers-2026-09',
      'missed-workout-actions-2026-08',
      'live-timer-2026-09',
      'lime-quick-plan-2026-10',
      'lime-direct-client-start-2026-10',
      'lime-day-workspace-2026-10',
      'lime-schedule-history-2026-10',
    ]))
  }, { token: sessionToken, profileId })
  await page.route('http://127.0.0.1:4100/v1/**', async (route) => {
    const url = new URL(route.request().url())
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
          accountRole: 'trainer',
          experiments: { trainerScheduleV2: options.pilot !== false, fitLime: options.fitLime === true },
          preferences: { scheduleDensity },
        },
      }
    } else if (url.pathname === '/v1/profile' && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { scheduleDensity?: 'comfortable' | 'compact' }
      if (draft.scheduleDensity) scheduleDensity = draft.scheduleDensity
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
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
    } else if (url.pathname === '/v1/training-data') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = {
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
        gender: null,
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
    } else if (/^\/v1\/workouts\/[0-9a-f-]+\/(start|finish)$/.test(url.pathname) && route.request().method() === 'POST') {
      const id = url.pathname.split('/')[3]
      const finished = url.pathname.endsWith('/finish')
      workouts = workouts.map((item) => item.id === id ? { ...item, status: finished ? 'done' : 'in_progress', completedAt: finished ? '2026-09-24T12:00:00Z' : null, version: item.version + 1 } : item)
      body = { workout: { version: workouts.find((item) => item.id === id)!.version } }
    } else if (url.pathname === '/v1/workouts/quick-start' && route.request().method() === 'POST') {
      workouts = [{ ...workout, id: newWorkoutId, status: 'in_progress' }]
      body = { workout: { id: newWorkoutId, resumed: false } }
    } else if (url.pathname === '/v1/workouts' && route.request().method() === 'POST') {
      saveAttempts += 1
      if (options.failFirstSave && saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null; title?: string | null; trainingFormat?: 'self' | 'with_trainer'; exercises?: WorkoutExerciseDraft[] }
      lastSavedStartTime = draft.startTime ?? null
      const exercises: WorkoutExercise[] = (draft.exercises ?? []).map((exercise, index) => ({ ...exercise,
        id: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`, blockId: `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
        blockType: exercise.blockType ?? 'single', blockPreset: exercise.blockPreset ?? 'set', blockRounds: exercise.blockRounds ?? 1,
        restBetweenExercisesSec: exercise.restBetweenExercisesSec ?? 0, restBetweenRoundsSec: exercise.restBetweenRoundsSec ?? 0, restBetweenSetsSec: exercise.restBetweenSetsSec ?? 60,
        sets: exercise.sets.map((set, setIndex) => ({ ...set, id: `10000000-0000-4000-8000-${String(300 + index * 10 + setIndex).padStart(12, '0')}`, fact: {}, confirmedAt: null, version: 1 })),
      }))
      workouts = [...workouts.filter((item) => item.id !== newWorkoutId), { ...workout, exercises, trainingFormat: draft.trainingFormat, id: newWorkoutId, title: draft.title, workoutDate: draft.workoutDate, startTime: draft.startTime ?? null, endTime: draft.endTime ?? null }]
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

test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

for (const width of [320, 390, 430, 1440]) {
  test(`Lime filled calendar audit with the production seed recipe at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-10-03T12:00:00+03:00'))
    const profileId = width === 430 ? '10000000-0000-4000-8000-000000000010' : trainerId
    const plan = buildFitLimeCalendarPlan(profileId, '2026-09-28', '2026-10-03')
    await mockPilot(page, { profileId, fitLime: true,
      clientRecords: plan.clients.map((item) => ({ ...item, archivedAt: null, version: 1 })),
      workouts: plan.workouts.map((item) => ({ ...workout, ...item, trainerId: profileId,
        clientName: plan.clients.find((client) => client.id === item.clientId)!.fullName,
        completedAt: item.status === 'done' ? `${item.workoutDate}T12:00:00Z` : null,
      })),
    })
    await page.goto('/schedule?week=2026-09-28')
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    for (const select of await page.locator('.fit-lime-schedule-filters select').all()) {
      const size = await select.boundingBox()
      expect(size!.height).toBeGreaterThanOrEqual(44)
      expect(await select.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    }
    const shell = await page.locator('.phone-frame').boundingBox()
    const fab = await page.locator('.schedule-v2-fab').boundingBox()
    expect(fab!.x).toBeGreaterThanOrEqual(shell!.x)
    expect(fab!.x + fab!.width).toBeLessThanOrEqual(shell!.x + shell!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('filled-week.png'), fullPage: true })
    await page.getByRole('button', { name: 'Список', exact: true }).click()
    const list = page.getByRole('region', { name: 'Список тренировок' })
    await expect(list.getByRole('link')).toHaveCount(60)
    await page.getByRole('combobox', { name: 'Фильтр по клиенту' }).selectOption(plan.clients[12]!.id)
    await expect(list.getByRole('link')).toHaveCount(4)
    await expect(list.getByRole('link').first()).toContainText('Константинопольская-Рождественская')
    await page.screenshot({ path: testInfo.outputPath('filled-history-long-name.png'), fullPage: true })
    const lastRow = list.getByRole('link').last()
    await lastRow.scrollIntoViewIfNeeded()
    await expect(lastRow).toBeInViewport()
    const lastBox = await lastRow.boundingBox()
    const navBox = await page.locator('.trainer-tab-bar').boundingBox()
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(navBox!.y)
    await page.goto('/today?date=2026-09-30&week=2026-09-28')
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await expect(page.locator('.schedule-v2-event').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('filled-dense-day.png'), fullPage: true })
    await page.locator('.schedule-v2-fab').click()
    await expect(page.getByRole('button', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('filled-calendar-entry.png') })
  })
}

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime notification settings separate permission, device connection and retry for ${profileId}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockPilot(page, { profileId, fitLime: true })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
      Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
      Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true })
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        getRegistration: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://push.example/device', toJSON: () => ({ keys: { p256dh: 'public-test', auth: 'test-auth' } }) }) } }),
        addEventListener() {}, removeEventListener() {},
      } })
    })
    let fail = false
    let endpointChecks = 0
    await page.route('http://127.0.0.1:4100/v1/push-notifications/**', async (route) => {
      if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/subscription/status')) {
        endpointChecks += 1
        expect(route.request().postDataJSON()).toEqual({ endpoint: 'https://push.example/device' })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.endsWith('/subscription/status') ? { subscribed: true } : { status: { subscribed: true, preferences: { workout_reminder: false, workout_scheduled: true, chat_message: true } } }) })
    })
    await page.goto('/profile/settings')
    await expect(page.getByText('Fit открыт как приложение', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Как установить Fit' })).toHaveCount(0)
    await expect(page.getByText('Разрешено', { exact: true })).toBeVisible()
    await expect(page.getByText('Уведомления включены', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Включить', exact: true })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Напоминать о незавершённой тренировке' })).not.toBeChecked()
    expect(endpointChecks).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('lime-notification-settings.png'), fullPage: true })
    fail = true
    await page.getByRole('button', { name: 'Повторить проверку' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'подписку устройства' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('switch', { name: 'Новые сообщения' })).toBeDisabled()
    fail = false
    await page.getByRole('button', { name: 'Повторить проверку' }).click()
    await expect(page.getByText('Уведомления включены', { exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Новые сообщения' })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [390, 430, 1440]) {
  test(`Lime history preserves completed, untimed and filtered calendar context at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const otherClient = '10000000-0000-4000-8000-000000000099'
    await mockPilot(page, { fitLime: true, profileId: width === 430 ? '10000000-0000-4000-8000-000000000010' : trainerId, workouts: [
      { ...workout, status: 'done', completedAt: '2026-09-24T08:00:00.000Z', title: 'Силовая' },
      { ...workout, id: newWorkoutId, clientId: otherClient, clientName: 'Александра Константинопольская-Рождественская', status: 'done', workoutDate: '2026-08-01', startTime: null, endTime: null, completedAt: '2026-08-01T08:00:00.000Z' },
      { ...workout, id: '10000000-0000-4000-8000-000000000080', status: 'cancelled' },
      { ...workout, id: '10000000-0000-4000-8000-000000000081', workoutDate: '2026-10-10' },
    ] })
    await page.goto('/schedule?week=2026-09-21')
    await page.getByRole('button', { name: 'Список', exact: true }).click()
    const list = page.getByRole('region', { name: 'Список тренировок' })
    await expect(list.getByRole('link')).toHaveCount(4)
    await expect(list.getByText('Без времени', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('done')
    await expect(list.getByRole('link')).toHaveCount(2)
    await expect(list.getByText('Проведена', { exact: true })).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('lime-history.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('combobox', { name: 'Фильтр по клиенту' }).selectOption(clientId)
    await expect(list.getByRole('link')).toHaveCount(1)
    await list.getByRole('button', { name: '24 сентября 2026 г.' }).click()
    await expect(page).toHaveURL(/date=2026-09-24/)
    await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
    await page.goBack()
    await expect(list.getByRole('link')).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Фильтр по клиенту' })).toHaveValue(clientId)
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('in_progress')
    await expect(page.getByText('По этим фильтрам тренировок нет.')).toBeVisible()
    await page.getByRole('combobox', { name: 'Фильтр по статусу' }).selectOption('cancelled')
    await expect(list.getByRole('link')).toHaveCount(1)
    await expect(list.getByText('Отменена', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Календарь', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
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

for (const width of [390, 430, 1440]) {
  test(`Lime window typography and client step stay bounded at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true, clientRecords: [{ id: clientId, fullName: 'Александра Константинопольская-Рождественская', archivedAt: null, version: 1 }] })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await page.evaluate(() => document.fonts.ready)
    await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveCSS('font-size', '16px')
    await expect(plan.getByRole('button', { name: 'Надиктовать тренировку' })).toHaveCSS('font-size', '14px')
    expect(await plan.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('YS Geo')
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    await expect(picker).toBeFocused()
    await expect(plan.getByRole('button', { name: 'Сохранить план' })).not.toBeVisible()
    const box = await picker.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(12)
    expect(box!.width).toBeLessThanOrEqual(375)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.keyboard.press('Shift+Tab')
    expect(await picker.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(plan.getByRole('button', { name: 'Сохранить план' })).toBeVisible()
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('button', { name: /Александра Константинопольская/ }).click()
    expect(await plan.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('lime-window-type.png') })
  })
}

test('Lime retained plan offers old date and preserves it when starting a new plan', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  const key = `fit.workout-form-draft.${trainerId}.new--2026-09-24--quick`
  await page.evaluate(({ key, clientId }) => localStorage.setItem(key, JSON.stringify({ clientId, workoutDate: '2026-10-05', title: 'Старый план', requestId: 'retained-plan', startTime: '13:30', endTime: '', notes: '', stageId: '', recordCompleted: false, exercises: [] })), { key, clientId })
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const choice = page.getByRole('dialog', { name: 'Черновик плана' })
  await expect(choice).toContainText('5 октября')
  await expect(choice).toContainText('Алексей Смирнов')
  await page.screenshot({ path: testInfo.outputPath('lime-retained-plan.png') })
  await choice.getByRole('button', { name: 'Создать новый план' }).click()
  const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
  await expect(plan.getByRole('button', { name: 'Выбрать дату и время' })).toContainText('24 сентября')
  await expect(plan).toContainText('Без времени')
  await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('')
  await plan.getByRole('button', { name: 'Самостоятельно', exact: true }).click()
  await plan.getByRole('textbox', { name: 'Название тренировки' }).fill('Новый план')
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(`${key}.saved.retained-plan`)!) as { title: string }, key)).toMatchObject({ title: 'Старый план' })
  await plan.getByRole('button', { name: 'Закрыть создание' }).click()
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await expect(choice.getByRole('button', { name: 'Продолжить черновик' })).toHaveCount(2)
  await choice.getByRole('button', { name: 'Продолжить черновик' }).first().click()
  await expect(plan.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Новый план')
  await expect(plan.getByRole('button', { name: 'Самостоятельно', exact: true })).toHaveAttribute('aria-pressed', 'true')
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

test('Lime plan keeps actions reachable with enlarged text on a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await mockPilot(page, { fitLime: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
  // Model enlarged text independently of device scale; not a physical OS setting.
  await plan.evaluate((element) => {
    const text = Array.from(element.querySelectorAll<HTMLElement>('h2, input, button, p, button span'))
      .map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }))
    for (const { node, size } of text) { node.style.fontSize = `${size * 1.3}px`; node.style.lineHeight = '1.3' }
  })
  await page.screenshot({ path: testInfo.outputPath('lime-enlarged-text-before-scroll.png') })
  expect(await plan.evaluate((element) => Array.from(element.querySelectorAll('*')).filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1).map((child) => child.className))).toEqual([])
  expect(await plan.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await plan.getByRole('button', { name: 'Сохранить план' }).scrollIntoViewIfNeeded()
  await expect(plan.getByRole('button', { name: 'Сохранить план' })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('lime-enlarged-text.png') })
  await plan.getByRole('button', { name: 'Закрыть создание' }).click()
  await expect(plan).toHaveCount(0)
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

for (const profileId of [trainerId, '10000000-0000-4000-8000-000000000010']) {
  test(`Lime plus resumes live without writing and preserves plan input for ${profileId}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout, status: 'in_progress' }] })
    const mutations: string[] = []
    page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/workouts')) mutations.push(request.url()) })
    await page.goto('/today?date=2026-09-29')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    const choice = page.getByRole('dialog', { name: 'Новая тренировка', exact: true })
    await expect(choice.getByRole('button', { name: 'Начать сейчас' })).toBeVisible()
    await expect(choice.getByRole('button', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-entry-choice.png') })
    await choice.getByRole('button', { name: 'Начать сейчас' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
    expect(mutations).toHaveLength(0)
    await page.goto('/today?date=2026-09-29')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const plan = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await plan.getByRole('textbox', { name: 'Название тренировки' }).fill('Сила и баланс')
    await plan.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    const sourceKey = `fit.workout-form-draft.${profileId}.new--2026-09-29--quick`
    const source = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as { requestId: string }, sourceKey)
    await plan.getByRole('button', { name: 'Ввести текстом' }).click()
    await expect(page).toHaveURL(/view=compose&entry=text&date=2026-09-29/)
    await expect.poll(async () => page.evaluate((id) => JSON.parse(localStorage.getItem(`fit.today-draft.${id}`)!) as unknown, profileId)).toMatchObject({ workoutDate: '2026-09-29', clientId, title: 'Сила и баланс', requestId: source.requestId, sourceFormDraftKey: sourceKey })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Выбрать упражнения вручную' })).toBeVisible()
    expect(mutations).toHaveLength(0)
  })
  test(`Lime day removes duplicate blocks but keeps live and draft access for ${profileId}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [{ ...workout, status: 'in_progress', workoutDate: '2026-09-26' }] })
    await page.addInitScript((id) => localStorage.setItem(`fit.today-draft.${id}`, JSON.stringify({ screen: 'compose', text: 'Приседания 3 по 10', choices: {}, items: [], clientId: '' })), profileId)
    await page.goto('/today?date=2026-09-26')
    await expect(page.getByRole('link', { name: 'День', exact: true })).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Установка и уведомления' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '2 Незавершённые действия', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '2 Незавершённые действия', exact: true }).click()
    const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
    await expect(queue.getByRole('link', { name: /Тренировка идёт/ })).toHaveAttribute('href', `/workouts/${workoutId}/live`)
    await expect(queue.getByRole('link', { name: /Черновик тренировки/ })).toHaveAttribute('href', '/today?view=compose')
    await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
    await expect(page).toHaveURL(/date=2026-09-27/)
    await expect(page.getByText('На этот день тренировок нет')).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('lime-clean-day.png'), fullPage: true })
    await page.evaluate((id) => {
      const key = `fit.coachmarks-seen.${id}`
      const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      localStorage.setItem(key, JSON.stringify(seen.filter((item) => item !== 'lime-day-workspace-2026-10')))
    }, profileId)
    await page.getByRole('link', { name: 'Расписание', exact: true }).click()
    await page.getByRole('link', { name: 'День', exact: true }).click()
    const guidance = page.getByRole('status').filter({ hasText: 'Все дела — в календаре' })
    await expect(guidance).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('lime-day-guidance.png'), fullPage: true })
    await guidance.getByRole('button', { name: 'Понятно' }).click()
    await expect(guidance).not.toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '2 Незавершённые действия', exact: true })).toBeVisible()
  })
}

for (const width of [390, 430]) {
  test(`Lime keyboard visual viewport keeps composer above keyboard at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    // Model Safari's separate layout/visual viewports, not a physical OS keyboard.
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      Object.defineProperties(viewport, {
        height: { get: () => Number(document.documentElement.dataset.testVisibleHeight ?? window.innerHeight) },
        offsetTop: { get: () => Number(document.documentElement.dataset.testViewportTop ?? 0) },
      })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    const trigger = page.getByRole('button', { name: 'Новая тренировка', exact: true })
    await trigger.click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    const input = dialog.getByRole('textbox', { name: 'Название тренировки' })
    await expect(input).not.toBeFocused()
    await input.fill('Тренировка над клавиатурой')
    for (const offset of [0, 24]) {
      await page.evaluate((top) => {
        document.documentElement.dataset.testVisibleHeight = '400'
        document.documentElement.dataset.testViewportTop = String(top)
        window.visualViewport?.dispatchEvent(new Event('resize'))
      }, offset)
      await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return box ? box.y + box.height : 1000
      }).toBeLessThanOrEqual(400 + offset)
      const box = await dialog.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(offset)
      await expect(dialog).toHaveCSS('transform', 'none')
    }
    await page.screenshot({ path: testInfo.outputPath('lime-keyboard-visible-form.png') })
    await dialog.getByRole('button', { name: 'Закрыть создание' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeVisible()
    await page.evaluate(() => {
      delete document.documentElement.dataset.testVisibleHeight
      delete document.documentElement.dataset.testViewportTop
      window.visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/)
  })

  test(`Figma long client name and constrained-height picker at ${width}`, async ({ page }, testInfo) => {
    const fullName = 'Александр Константинопольский-Рождественский'
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true, clientRecords: [{ id: clientId, fullName, archivedAt: null, version: 1 }] })
    await page.goto('/workouts/new?date=2026-09-24')
    await page.locator('.client-picker-trigger').click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    const search = picker.getByRole('textbox', { name: 'Поиск клиента' })
    await search.focus()
    // Model reduced available space; this is not a claim to emulate an OS keyboard.
    await page.setViewportSize({ width, height: 400 })
    await search.fill('Константинопольский')
    await expect(search).toBeFocused()
    const option = picker.getByRole('button', { name: new RegExp(fullName) })
    await option.scrollIntoViewIfNeeded()
    await expect(option).toBeVisible()
    const bounds = await option.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400)
    await page.screenshot({ path: testInfo.outputPath('figma-picker-constrained-height.png') })
    await option.click()
    await expect(picker).not.toBeVisible()
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.client-picker-trigger')).toContainText(fullName)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
test('Figma workout second pilot keeps quick-plan guidance and completed draft', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Завершённая', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Записать тренировку', exact: true })).toBeDisabled()
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
  await expect(page).toHaveURL(/workouts\/new\?date=2026-09-24&entry=quick$/)
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Записать тренировку', exact: true })).toBeDisabled()
})

for (const width of [390, 430, 1440]) {
  test(`Figma quick start preserves the finance format choice at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    const fullName = 'Александр Константинопольский-Рождественский'
    await mockPilot(page, { fitLime: true, workouts: [], clientRecords: [{ id: clientId, fullName, archivedAt: null, version: 1 }] })
    await page.goto(`/clients/${clientId}`)
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    const format = page.locator('.quick-start-format')
    await expect(page.getByRole('heading', { name: fullName, exact: true })).toBeVisible()
    await expect(format).toContainText('Формат тренировки')
    await expect(format.getByRole('button', { name: 'С тренером', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await format.getByRole('button', { name: 'Самостоятельно', exact: true }).click()
    await expect(format.getByRole('button', { name: 'Самостоятельно', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const start = format.getByRole('button', { name: 'Начать', exact: true })
    await expect(start).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await start.scrollIntoViewIfNeeded()
    for (const button of await format.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('figma-quick-start-format.png') })
    await format.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(format).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeVisible()
  })

  test(`Figma trainer routes include finance and templates at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true })
    for (const route of ['/finance', `/clients/${clientId}/finance`, '/schedule/templates', '/schedule/templates/new/editor', '/profile', '/clients', '/chat', '/assistant']) {
      await page.goto(route)
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`routes-${route.replace(/[^a-z]+/g, '-')}.png`) })
    }
    await mockPilot(page, { fitLime: false })
    for (const route of ['/finance', `/clients/${clientId}/finance`, '/schedule/templates', '/schedule/templates/new/editor']) {
      await page.goto(route)
      await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
      await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
      await expect(page.locator('[data-original-icon]')).toHaveCount(0)
    }
  })
  test(`Figma workout quick empty plan at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true, workouts: [], failFirstSave: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    const composer = page.getByRole('dialog', { name: 'Быстрое создание тренировки' })
    await expect(composer).toBeVisible()
    await composer.getByRole('textbox', { name: 'Название тренировки' }).fill('Всё тело')
    await composer.getByRole('button', { name: 'Клиент: Выберите клиента' }).click()
    await page.getByRole('dialog', { name: 'Выбор клиента' }).getByRole('button', { name: /Алексей Смирнов/ }).click()
    await composer.getByRole('button', { name: 'Выбрать дату и время' }).click()
    const dates = page.getByRole('dialog', { name: 'Дата и время' })
    await dates.getByLabel('Начало', { exact: true }).fill('12:00')
    await dates.getByRole('button', { name: 'Применить дату' }).click()
    await expect(composer.locator('.fit-lime-plan-exercises svg')).toHaveCSS('width', '24px')
    await expect(composer.locator('.fit-lime-plan-exercises svg')).toHaveCSS('height', '24px')
    const composerBox = await composer.boundingBox()
    expect(composerBox!.height).toBeLessThanOrEqual(876)
    await expect(composer.getByRole('button', { name: 'Сохранить план' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('figma-quick-plan.png') })
    const sent: Array<{ title?: string; requestId: string; exercises: unknown[] }> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/workouts') sent.push(request.postDataJSON() as typeof sent[number])
    })
    await composer.getByRole('button', { name: 'Сохранить план' }).click()
    await expect(composer.getByRole('alert')).toBeVisible()
    await expect(composer.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Всё тело')
    await composer.getByRole('button', { name: 'Сохранить план' }).click()
    await expect(composer).not.toBeVisible()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ title: 'Всё тело', exercises: [] })
    expect(sent[1]?.requestId).toBe(sent[0]?.requestId)
    await expect(page.locator('.schedule-v2-event')).toContainText('Всё тело')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })

  test(`Figma workout quick draft survives editor handoff at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
    await page.getByRole('textbox', { name: 'Название тренировки' }).fill('План с очень длинным названием для проверки переноса')
    await page.getByRole('button', { name: 'Добавить упражнения', exact: true }).click()
    await expect(page).toHaveURL(/workouts\/new\?date=2026-09-24/)
    await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('План с очень длинным названием для проверки переноса')
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('План с очень длинным названием для проверки переноса')
  })

  test(`Figma workout editor and client picker at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/workouts/new?date=2026-09-24')
    await expect(page.locator('.workout-form-page')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.workout-header-contract h2')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.workout-header-contract h2')).toHaveCSS('font-weight', '500')
    await expect(page.locator('.workout-composer-card')).toHaveCSS('border-radius', '32px')
    await page.screenshot({ path: testInfo.outputPath('figma-workout-editor.png'), fullPage: true })
    await page.locator('.client-picker-trigger').click()
    const picker = page.getByRole('dialog', { name: 'Выбор клиента' })
    await expect(picker).toBeVisible()
    await expect(picker).toHaveCSS('border-top-left-radius', '40px')
    await expect(picker.locator('.client-picker-avatar').first()).toHaveCSS('width', '40px')
    await picker.getByRole('textbox', { name: 'Поиск клиента' }).fill('Алексей')
    await page.screenshot({ path: testInfo.outputPath('figma-workout-client-picker.png') })
    await picker.getByRole('button', { name: /Алексей Смирнов/ }).click()
    await expect(picker).not.toBeVisible()
    await expect(page.locator('.client-picker-trigger')).toContainText('Алексей Смирнов')
    await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
  test(`Figma calendar month chooser applies and cancels at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await mockPilot(page, { fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Выбрать дату', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Выбрать дату' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.fit-lime-date-selected')).toHaveCSS('font-size', '14px')
    await dialog.getByRole('button', { name: '30 сентября 2026 г.', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(/date=2026-09-24/)
    await expect(page.getByRole('button', { name: 'Выбрать дату', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Выбрать дату', exact: true }).click()
    await dialog.getByRole('button', { name: 'Следующий месяц' }).click()
    await dialog.getByRole('button', { name: '2 октября 2026 г.', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-month.png') })
    await dialog.getByRole('button', { name: 'Применить дату' }).click()
    await expect(page).toHaveURL(/date=2026-10-02/)
    await expect(dialog).not.toBeVisible()
  })
  test(`Figma calendar geometry and event states at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { fitLime: true })
    const ready = async () => page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.querySelectorAll('svg image')].map(async (node) => {
        const image = new Image()
        image.src = node.getAttribute('href')!
        await image.decode()
      }))
    })
    await page.goto('/today?date=2026-09-24')
    await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).not.toHaveClass(/is-active/)
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toHaveClass(/is-active/)
    await expect(page.locator('.schedule-v2-summary > button').first()).toHaveCSS('border-radius', '32px')
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'День', exact: true })).toBeVisible()
    await ready()
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-day.png') })
    const fab = await page.locator('.schedule-v2-fab').boundingBox()
    const nav = await page.locator('.trainer-tab-bar').boundingBox()
    expect(fab!.width).toBe(68)
    await expect(page.locator('.schedule-v2-fab svg')).toHaveCSS('filter', 'brightness(0)')
    expect(fab!.y + fab!.height).toBeLessThanOrEqual(nav!.y)
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    const grid = await page.locator('.schedule-v2-card-grid').boundingBox()
    const sunday = await page.locator('.schedule-v2-day-card').nth(6).boundingBox()
    expect(sunday!.width).toBeCloseTo(grid!.width, 0)
    await ready()
    const settings = await page.getByRole('button', { name: 'Настройки расписания' }).boundingBox()
    expect(settings!.x + settings!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('figma-calendar-week.png') })
    await page.getByRole('button', { name: '2 недели', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  })

  test(`Figma foundation preserves native icons, fonts and pilot isolation at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await mockPilot(page, { fitLime: true, workouts: [] })
    await page.goto('/clients')
    await expect(page.locator('.fit-lime-shell')).toBeVisible()
    await expect(page.locator('.trainer-tab-bar [data-original-icon="users"]')).toBeVisible()
    await expect(page.locator('.trainer-tab-bar')).toHaveCSS('backdrop-filter', 'blur(22px)')
    await expect(page.locator('.page-header h1')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.page-header h1')).toHaveCSS('font-weight', '500')
    await expect(page.locator('.fit-lime-shell')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    if (process.env.FIT_LIME_FONTS_REQUIRED === 'true') {
      expect(await page.evaluate(async () => {
        const regular = await document.fonts.load('400 16px "YS Geo"', 'АаЁё123')
        const medium = await document.fonts.load('500 24px "YS Geo"', 'Клиенты')
        const counter = await document.fonts.load('700 32px REM', '123')
        return [...regular, ...medium, ...counter].map((font) => font.status)
      })).toEqual(['loaded', 'loaded', 'loaded'])
    }
    for (const asset of await page.locator('.trainer-tab-bar image').all()) {
      await expect(asset).toHaveAttribute('width', '24')
      await expect(asset).toHaveAttribute('height', '24')
      const source = await asset.getAttribute('href')
      expect(await page.evaluate(async (url) => {
        const img = new Image()
        img.src = url!
        await img.decode()
        return [img.naturalWidth, img.naturalHeight]
      }, source)).toEqual([24, 24])
    }
    await page.screenshot({ path: testInfo.outputPath('figma-foundation.png'), fullPage: true })
    await mockPilot(page, { fitLime: false, workouts: [] })
    await page.reload()
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
    await expect(page.locator('[data-original-icon]')).toHaveCount(0)
  })
}

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

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} trainer receives Fit Lime shell on released routes only`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-shell-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-shell-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.reload()
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await page.goto('/clients')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await page.goto('/today?view=compose')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime today keeps the reference hierarchy and working entry paths`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-summary/)
    await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await expect(page.locator('.schedule-v2-home-actions')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Новая тренировка', exact: true })).toBeVisible()
    await expect(page.locator('.schedule-v2-now')).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.goto('/today?view=compose&entry=text')
    await expect(page).toHaveURL(/\/today\?view=compose&entry=text/)
    await expect(page.locator('.fit-lime-shell')).toBeVisible()
  })
}

test('Fit Lime stage 4 keeps workout and assistant routes scoped to the pilot trainer', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  for (const [route, surface] of [
    ['/workouts/new?date=2026-09-24', '.workout-form-page'],
    ['/today?view=compose&entry=text', '.today-text-fallback'],
    [`/workouts/${workoutId}`, '.workout-detail-page'],
    [`/workouts/${workoutId}/live`, '.live-workout-page'],
    [`/workouts/${workoutId}/history/fedb-barbell-squat`, '.exercise-card-tabs'],
    ['/assistant', '.assistant-page'],
  ] as const) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await expect(page.locator(surface)).toBeVisible()
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    if (route === '/assistant') await expect(page.getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeVisible()
    const screenshotPath = testInfo.outputPath(`stage4-${surface.slice(1)}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach(`stage4-${surface.slice(1)}`, { path: screenshotPath, contentType: 'image/png' })
  }
})

test('workout and assistant routes keep the previous presentation outside Fit Lime', async ({ page }) => {
  await mockPilot(page, { fitLime: false })
  for (const route of ['/workouts/new?date=2026-09-24', '/today?view=compose&entry=text', `/workouts/${workoutId}`, `/workouts/${workoutId}/live`, '/assistant']) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
  }
})

test('Fit Lime trainer screens fit a narrow phone without horizontal page clipping', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
  await mockPilot(page, { fitLime: true })
  for (const route of [
    '/today?date=2026-09-24',
    '/schedule?week=2026-09-21',
    '/chat',
    `/chat/${conversationId}`,
    '/clients',
    `/clients/${clientId}`,
    '/clients/new',
    `/clients/${clientId}/goal`,
    `/progress/${clientId}`,
    `/clients/${clientId}/workouts`,
    '/profile',
    '/profile/settings',
    '/profile/trainer',
    '/exercises',
    '/workouts/new?date=2026-09-24',
    `/workouts/${workoutId}`,
    `/workouts/${workoutId}/live`,
    `/workouts/${workoutId}/history/fedb-barbell-squat`,
    '/assistant',
  ]) {
    await page.goto(route)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    if (route.startsWith('/today')) await expect(page.locator('.fit-lime-today')).toBeVisible()
    if (route.startsWith('/schedule')) await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    if (route.startsWith('/workouts/new')) await expect(page.locator('.workout-form-page')).toBeVisible()
    if (route === '/assistant') await expect(page.locator('.assistant-page')).toBeVisible()
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(documentWidth, `Horizontal overflow on ${route}`).toBeLessThanOrEqual(320)
    const clippedControls = await page.evaluate(() => {
      const selectors = [
        '.trainer-tab-bar a',
        '.workout-form-section',
        '.workout-form-section .client-picker-trigger',
        '.workout-form-section .workout-record-mode button',
        '.workout-form-section .workout-time-row input',
        '.workout-form-section .workout-notes summary',
        '.schedule-v2-period strong',
        '.assistant-composer textarea',
      ]
      return [...document.querySelectorAll<HTMLElement>(selectors.join(', '))]
        .filter((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.right > window.innerWidth + 1 || bounds.left < -1 || element.scrollWidth > element.clientWidth + 1
        })
        .map((element) => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`)
    })
    expect(clippedControls, `Clipped controls on ${route}`).toEqual([])
    if (route.startsWith('/workouts/') || route.startsWith('/today')
      || route.startsWith('/schedule') || route === '/assistant') {
      const label = `narrow-${route.replace(/[^a-z0-9]+/gi, '-')}`
      const screenshotPath = testInfo.outputPath(`${label}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach(label, { path: screenshotPath, contentType: 'image/png' })
    }
  }
})

test('trainer without Fit Lime keeps the existing day hierarchy', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.fit-lime-today')).toHaveCount(0)
  await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-home-actions/)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime schedule keeps week, fortnight and selected date`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    const weekstripSurface = await page.locator('.schedule-v2-weekdays').first().evaluate((element) => ({
      labelBackground: getComputedStyle(element).backgroundColor,
      numberStripBackground: getComputedStyle(element, '::before').backgroundColor,
    }))
    expect(weekstripSurface).toEqual({ labelBackground: 'rgba(0, 0, 0, 0)', numberStripBackground: 'rgb(37, 54, 12)' })
    await expect(page.locator('.schedule-v2-period-summary')).toHaveText('1 тренировка · 1 клиент')
    await expect(page.locator('.schedule-v2-day-card').first()).toContainText('Свободный день')
    await expect(page.locator('.schedule-v2-day-card').nth(3)).toContainText('Алексей Смирнов')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-schedule-week.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-schedule-week', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: '2 недели', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
    await page.locator('.schedule-v2-day-card').nth(8).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
    await page.reload()
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await page.getByRole('button', { name: 'Настройки расписания' }).click()
    await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  })
}

test('Fit Lime weekstrip fits a 320-pixel phone without clipping days', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
  await mockPilot(page, { fitLime: true })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.fit-lime-schedule')).toBeVisible()
  const lastDay = await page.locator('.schedule-v2-weekdays button').last().boundingBox()
  expect(lastDay).not.toBeNull()
  expect(lastDay && lastDay.x + lastDay.width <= 320).toBe(true)
  await expect(page.locator('.schedule-v2-weekdays button')).toHaveCount(7)
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

test('renders the single-trainer schedule and combines questions with messages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.getByRole('button', { name: /1 Незавершённые действия/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toContainText('СегодняРасписаниеКлиенты')
  await expect(page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' })).toHaveAttribute('href', '/workouts/new?date=2026-09-24')
  const timelineScroll = await page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)
  expect(timelineScroll).toBeGreaterThan(300)
  expect(timelineScroll).toBeLessThan(500)
  const fabBox = await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' }).boundingBox()
  const navigationBox = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox()
  expect(fabBox && navigationBox && fabBox.y + fabBox.height < navigationBox.y).toBe(true)

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: /1 Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Требует действия' })).toBeVisible()
  await expect(page.getByText('Прошлый план ждёт решения')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Алексей Смирнов')).toHaveCSS('color', 'rgb(248, 248, 246)')
  const actionScreenshotPath = testInfo.outputPath('trainer-schedule-v2-actions.png')
  await page.screenshot({ path: actionScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-actions', { path: actionScreenshotPath, contentType: 'image/png' })
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()

  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 3 })).toBeVisible()
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()
  const inboxScreenshotPath = testInfo.outputPath('trainer-schedule-v2-inbox.png')
  await page.screenshot({ path: inboxScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-inbox', { path: inboxScreenshotPath, contentType: 'image/png' })

  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть все сообщения' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()

  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeFocused()
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(0)
})

test('trainer switches day-grid density from schedule and profile settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  const timeline = page.locator('.schedule-v2-timeline')
  const grid = timeline.locator('.day-grid')
  await expect(grid).toHaveCSS('height', `${24 * 56}px`)
  await timeline.evaluate((element) => { element.scrollTop = 500 })
  const before = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))

  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'Компактная сетка' }).click()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
  const after = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))
  expect((before.scrollTop + before.height / 2) / 56)
    .toBeCloseTo((after.scrollTop + after.height / 2) / 44, 1)

  await page.reload()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await page.goto('/profile/settings')
  const densityGroup = page.getByRole('radiogroup', { name: 'Плотность временной сетки' })
  await expect(densityGroup.getByRole('radio', { name: 'Компактная' })).toHaveAttribute('aria-checked', 'true')
  await densityGroup.getByRole('radio', { name: 'Обычная' }).click()
  await expect(densityGroup.getByRole('radio', { name: 'Обычная' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Сохранено')).toBeVisible()

  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.schedule-density-compact')).toHaveCount(0)
  await page.getByRole('button', { name: 'Четверг, 24 сентября' }).click()
  await expect(page.locator('.schedule-v2-timeline .day-grid')).toHaveCSS('height', `${24 * 56}px`)

  const screenshotPath = testInfo.outputPath('trainer-schedule-density-settings.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-density-settings', { path: screenshotPath, contentType: 'image/png' })
})

test('monochrome trainer switches day-grid density without Schedule V2', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page, { pilot: false })
  await page.goto('/schedule?date=2026-09-24')

  const timeline = page.locator('.day-grid-scroll')
  const grid = timeline.locator('.day-grid')
  await expect(page.locator('.trainer-schedule-identity')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(grid).toHaveCSS('height', `${24 * 56}px`)
  await timeline.evaluate((element) => { element.scrollTop = 500 })
  const before = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))

  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'Компактная сетка' }).click()

  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
  const after = await timeline.evaluate((element) => ({ scrollTop: element.scrollTop, height: element.clientHeight }))
  expect((before.scrollTop + before.height / 2) / 56)
    .toBeCloseTo((after.scrollTop + after.height / 2) / 44, 1)
  const screenshotPath = testInfo.outputPath('trainer-schedule-monochrome-density.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-monochrome-density', { path: screenshotPath, contentType: 'image/png' })

  await page.reload()
  await expect(page.locator('.schedule-density-compact')).toBeVisible()
  await expect(grid).toHaveCSS('height', `${24 * 44}px`)
})

test('inbox messages fail independently and all-messages back returns to the selected day', async ({ page }) => {
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

test('inbox questions fail independently and recover without hiding messages', async ({ page }) => {
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

test('replying to a trainer question updates the inbox count on return', async ({ page }) => {
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

test('reading a chat message updates the inbox count on return', async ({ page }) => {
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

test('non-Lime today keeps voice, text, draft, workout context and onboarding beside the calendar', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await page.addInitScript((profileId) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'compose', text: 'Приседания 3 по 10', choices: {}, items: [], clientId: '',
    }))
  }, trainerId)
  await mockPilot(page, { workouts: [{ ...workout, workoutDate: '2026-09-27', startTime: '15:00' }] })
  await page.goto('/today')

  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toHaveAttribute('href', '/today?view=compose')
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toHaveAttribute('href', '/today?view=compose&entry=text')
  await expect(page.getByRole('link', { name: /Есть незавершённая тренировка.*Продолжить/ })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Ближайшая тренировка')
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Алексей Смирнов')
  const timelineHeight = await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)
  await page.getByRole('button', { name: 'Установка и уведомления' }).click()
  await expect(page.getByRole('dialog', { name: 'Установка и уведомления' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeVisible()
  expect(await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)).toBe(timelineHeight)
  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-today-actions.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-today-actions', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: 'Закрыть подсказки' }).click()
  await page.getByRole('link', { name: 'Ввести текстом' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose&entry=text$/)
  await expect(page.locator('.today-text-fallback')).toBeVisible()
  await expect(page.locator('.today-text-fallback')).toContainText('Приседания 3 по 10')
  await page.goBack()
  await expect(page.locator('.schedule-v2-home-actions')).toBeVisible()
  await page.getByRole('link', { name: 'Надиктовать тренировку' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
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

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime inbox list keeps questions, dialogs and calendar return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
    await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-inbox-list.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-inbox-list', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime questions remain visible when dialogs fail, and dialogs recover independently', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, questionWorkout: true, failThreads: true })
  await page.goto('/chat')
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('Fit Lime dialog remains visible when questions fail', async ({ page }) => {
  await mockPilot(page, { fitLime: true, failWorkspace: true })
  await page.goto('/chat')
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить вопросы' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('trainer without Fit Lime keeps the existing messages list', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 1 })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime conversation keeps the calendar path and readable composer`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Назад' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Назад' })).toHaveCSS('opacity', '1')
    await expect(page.locator('.chat-message.partner')).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    await expect(page.getByRole('button', { name: 'Отправить' })).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-conversation.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-conversation', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime conversation retries a failed send without duplicating the message', async ({ page }) => {
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

test('trainer without Fit Lime keeps the existing conversation styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/chat/${conversationId}`)
  await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

const limeClients = [
  { id: clientId, fullName: 'Алексей Смирнов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000021', fullName: 'Борис Иванов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000022', fullName: 'Вера Кузнецова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000023', fullName: 'Глеб Орлов', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000024', fullName: 'Дарья Ершова', archivedAt: null, version: 1 },
  { id: '10000000-0000-4000-8000-000000000025', fullName: 'Егор Панов', archivedAt: null, version: 1 },
]

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client list keeps search, archive and restore`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, clientRecords: limeClients })
    await page.goto('/clients')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
    await expect(page.locator('.client-card').first()).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    await page.getByRole('searchbox', { name: 'Поиск клиента' }).fill('кузнец')
    await expect(page.getByRole('link', { name: /Вера Кузнецова/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Алексей Смирнов/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Очистить поиск' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-clients-list.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-clients-list', { path: screenshotPath, contentType: 'image/png' })
    }
    const firstCard = page.locator(`[data-client-swipe-id="${clientId}"]`)
    await firstCard.getByRole('button', { name: 'Действия с клиентом Алексей Смирнов' }).click()
    await firstCard.getByRole('button', { name: 'В архив' }).click()
    await expect(page.getByRole('status').getByText('Карточка «Алексей Смирнов» перемещена в архив')).toBeVisible()
    await page.getByRole('link', { name: 'Архив' }).click()
    await expect(page).toHaveURL(/\/clients\/archive$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    const archivedCard = page.locator(`[data-client-swipe-id="${clientId}"]`)
    await expect(archivedCard.getByRole('link', { name: /Алексей Смирнов/ })).toBeVisible()
    await archivedCard.getByRole('button', { name: 'Действия с клиентом Алексей Смирнов' }).click()
    await archivedCard.getByRole('button', { name: 'Восстановить' }).click()
    await expect(page.getByRole('heading', { name: 'Архив пуст' })).toBeVisible()
  })
}

test('Fit Lime client loading error retries without losing the clients route', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failClients: true })
  await page.goto('/clients')
  await expect(page.getByRole('alert')).toBeVisible()
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: /Алексей Смирнов/ })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
})

test('trainer without Fit Lime keeps the previous clients list and archive', async ({ page }) => {
  await mockPilot(page, { clientRecords: limeClients })
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.getByRole('link', { name: 'Архив' }).click()
  await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client card keeps actions and confirms archive`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto(`/clients/${clientId}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Сводка по спортсмену' })).toContainText('ИМТ')
    await expect(page.getByRole('link', { name: /Запланировать тренировку/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /История тренировок/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Прогресс и замеры/ })).toBeVisible()
    await expect(page.locator('.client-detail-plan')).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    for (const icon of await page.locator('.client-detail-plan svg[data-original-icon]').all()) {
      await expect(icon).toHaveCSS('filter', 'brightness(0)')
    }
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-card.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-card', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Архивировать клиента' }).click()
    await expect(page.getByRole('alertdialog', { name: /Переместить карточку/ })).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByRole('button', { name: 'Архивировать клиента' })).toBeVisible()
    await page.getByRole('button', { name: 'Архивировать клиента' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'В архив' }).click()
    await expect(page.getByRole('button', { name: 'Вернуть из архива' })).toBeVisible()
    await expect(page.getByRole('status').getByText('Изменение архива сохранено')).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/clients$/)
  })
}

test('Fit Lime client card isolates secondary data failures and retries', async ({ page }) => {
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

test('trainer without Fit Lime keeps the existing client card', async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime client creation keeps validation, save and safe return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/clients/new')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible()
    await expect(page.locator('.client-form-section')).toHaveCSS('background-color', 'rgb(26, 26, 28)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-create.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-create', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page).toHaveURL(/\/clients$/)
    await page.goto('/clients/new')
    await page.getByLabel('Имя', { exact: true }).fill('Мария Тестовая')
    await page.getByLabel('Пол').selectOption('female')
    await page.getByLabel('Возраст').fill('28')
    await page.getByLabel('Рост, см').fill('168')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page).toHaveURL(/\/clients\/10000000-0000-4000-8000-000000000030$/)
    await expect(page.getByRole('heading', { name: 'Мария Тестовая' })).toBeVisible()
  })
}

test('Fit Lime trainer edit and join keep a route back to the client list', async ({ page }) => {
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

test('Fit Lime invitation dialog keeps the existing invite entry and close', async ({ page }, testInfo) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/clients')
  const invite = page.getByRole('button', { name: 'Пригласить спортсмена' })
  await invite.click()
  const dialog = page.getByRole('dialog', { name: 'Кого пригласить?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('background-color', 'rgb(37, 37, 41)')
  await expect(dialog.getByLabel('Имя спортсмена')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Создать приглашение' })).toBeFocused()
  const screenshotPath = testInfo.outputPath('fit-lime-invite-dialog.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('fit-lime-invite-dialog', { path: screenshotPath, contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(invite).toBeFocused()
})

test('trainer without Fit Lime keeps create, edit and join outside the pilot theme', async ({ page }) => {
  await mockPilot(page)
  for (const route of ['/clients/new', `/clients/${clientId}/edit`, '/join']) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime goal keeps the current stage and edit actions`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, withGoal: true })
    await page.goto(`/clients/${clientId}/goal`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Подготовка к старту' })).toBeVisible()
    await expect(page.locator('.stage-row.current')).toContainText('База')
    await expect(page.locator('.stage-row.current')).toContainText('идёт')
    await expect(page.locator('.stage-row.current')).toHaveCSS('border-top-color', 'rgb(182, 239, 77)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-client-goal.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-client-goal', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: '＋ Добавить' }).click()
    await expect(page.getByLabel('Название этапа')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByLabel('Название этапа')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
  })
}

test('Fit Lime empty goal can be created without automatic criteria', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Цель' }).fill('Укрепить спину')
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Укрепить спину' })).toBeVisible()
  await expect(page.getByText('Этапов пока нет')).toBeVisible()
})

test('Fit Lime goal error retries without changing the client route', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: 'Создать цель' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/goal$`))
})

test('trainer without Fit Lime keeps the original goal surface', async ({ page }) => {
  await mockPilot(page, { withGoal: true })
  await page.goto(`/clients/${clientId}/goal`)
  await expect(page.getByRole('heading', { name: 'Подготовка к старту' })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime progress keeps weekly data and the measurements route`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto(`/progress/${clientId}`)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toContainText('Тренировок пока не было')
    await expect(page.getByRole('link', { name: 'Открыть замеры и показатели' })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'Прогресс стал короче' }).getByRole('button', { name: 'Понятно' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-progress.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-progress', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
    await expect(page).toHaveURL(new RegExp(`/progress/${clientId}\\?view=measurements$`))
    await expect(page.getByText('Замеров пока нет')).toBeVisible()
    await page.getByRole('button', { name: 'Добавить замер' }).click()
    await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.goto(`/progress/${clientId}?view=running`)
    await expect(page.getByText('За этот период пробежек нет.')).toBeVisible()
  })
}

test('Fit Lime measurement history confirms destructive removal', async ({ page }) => {
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

test('Fit Lime progress source error has a working retry', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failProgress: true })
  await page.goto(`/progress/${clientId}?view=measurements`)
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  backend.setProgressFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Замеров пока нет')).toBeVisible()
})

for (const fitLime of [false, true]) {
  test(`Yandex client workouts show current and future plans (Fit Lime ${fitLime})`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+03:00'))
    await mockPilot(page, { fitLime, workouts: [
      { ...workout, id: newWorkoutId, workoutDate: '2026-10-01' },
      workout,
      { ...workout, id: '10000000-0000-4000-8000-000000000007', status: 'in_progress' },
    ] })
    await page.goto(`/clients/${clientId}/workouts`)
    const cards = page.locator('.client-workout-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.first()).toContainText('24 сентября 2026 г.')
    await expect(cards.last()).toContainText('1 октября 2026 г.')
    await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('fit.appTheme', value), theme)
      await page.reload()
      await expect(cards).toHaveCount(3)
for (const width of [390, 430, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`upcoming-${fitLime}-${theme}-${width}.png`), fullPage: true })
      }
    }
    await page.getByRole('button', { name: 'Календарь', exact: true }).click()
    await expect(cards).toHaveCount(3)
    await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible()
  })
}

test('Fit Lime client workout history retains list, calendar and planning exit', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [{ ...workout, status: 'done' }] })
  await page.goto(`/clients/${clientId}/workouts`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.locator('.workout-chronicle-card')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Запланировать' })).toBeVisible()
  await page.getByRole('status').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
  const screenshotPath = testInfo.outputPath('fit-lime-client-workout-history.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('fit-lime-client-workout-history', { path: screenshotPath, contentType: 'image/png' })
  await page.getByRole('group', { name: 'Вид истории тренировок' }).getByRole('button', { name: 'Календарь' }).click()
  await expect(page.locator('.client-history-calendar')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`))
})

test('trainer without Fit Lime keeps progress and workout history in the prior theme', async ({ page }) => {
  await mockPilot(page, { workouts: [{ ...workout, status: 'done' }] })
  for (const route of [`/progress/${clientId}`, `/progress/${clientId}?view=measurements`, `/clients/${clientId}/workouts`]) {
    await page.goto(route)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  }
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime trainer profile keeps questionnaire, save and settings`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/profile')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
    await page.getByRole('status').filter({ hasText: 'Настройки переехали' }).getByRole('button', { name: 'Понятно' }).click()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-trainer-profile.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-trainer-profile', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Заполнить анкету' }).click()
    const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
    await expect(form.getByLabel('Выбрать фото')).toBeVisible()
    await form.getByLabel('О себе').fill('Тренирую бережно и регулярно.')
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Тренирую бережно и регулярно.')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.getByRole('link', { name: 'Настройки профиля' }).click()
    await expect(page).toHaveURL(/\/profile\/settings$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByText('Lime пока доступна только на экранах тренера из пилота.')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Тёмная тема остальных экранов' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await page.goto('/profile/trainer')
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  })
}

test('Fit Lime trainer profile keeps draft after save failure and retries', async ({ page }) => {
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

test('Fit Lime trainer profile reports photo upload failure without losing editor', async ({ page }) => {
  await mockPilot(page, { fitLime: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить анкету' }).click()
  const form = page.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await form.getByLabel('Выбрать фото').setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg')
  await expect(form.locator('.trainer-photo-editor').getByRole('alert')).toBeVisible()
  await expect(form.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('Fit Lime trainer profile retains publication, confirmation and sign-out', async ({ page }) => {
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

test('Fit Lime trainer profile has addressed load retry and non-pilot control', async ({ page }) => {
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

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime exercises retain search, technique, own list and profile return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, withCustomExercise: true })
    await page.goto('/exercises')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Упражнения', exact: true })).toBeVisible()
    await page.getByLabel('Поиск упражнения').fill('лестница')
    await expect(page.locator('.catalog-media-card').filter({ hasText: 'Лестничный тренажёр' })).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-exercises.png')
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach('fit-lime-exercises', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.locator('.catalog-media-card').filter({ hasText: 'Лестничный тренажёр' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Лестничный тренажёр' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first().click()
    await page.getByLabel('Поиск упражнения').fill('невозможное упражнение')
    await expect(page.getByText('Ничего не найдено')).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить поиск' }).click()
    await expect(page.locator('.catalog-custom-item')).toContainText('Мой присед')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })
}

test('Fit Lime custom exercise creation keeps draft after server error', async ({ page }) => {
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

test('Fit Lime custom exercise edit and archive keep confirmation, error and restore', async ({ page }) => {
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

test('Fit Lime exercises retry failed data without changing non-pilot catalog', async ({ page }) => {
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

test('today keeps workout entry usable while clients fail and recover', async ({ page }) => {
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

test('renders the weekly overview from the approved composition', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('Расписание')
  await expect(page.getByText('21 — 27 Сентября 2026 г.')).toBeVisible()
  await expect(page.getByText('1 тренировка · 1 клиент')).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByText('Свободный день')).toHaveCount(6)
  await expect(page.locator('.schedule-event-decision')).toBeVisible()

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-week.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-week', { path: screenshotPath, contentType: 'image/png' })
})

test('keeps the selected day and both weeks through navigation and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await page.getByRole('button', { name: '2 недели', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  const twoWeekScreenshot = testInfo.outputPath('two-weeks.png')
  await page.screenshot({ path: twoWeekScreenshot, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-two-weeks', { path: twoWeekScreenshot, contentType: 'image/png' })
  await page.locator('.schedule-v2-day-card').nth(8).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)

  await page.locator('.schedule-v2-day-card').nth(3).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await page.locator('.schedule-v2-event').click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
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

test('Lime complete lifecycle preserves one plan through start resume and finish', async ({ page }) => {
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

test('Lime adjacent sessions and current time remain readable and scroll returns', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-24T16:51:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [{ ...workout, startTime: '14:00', endTime: '15:00' }, { ...workout, id: newWorkoutId, startTime: '15:00', endTime: '16:00' }] })
  await page.goto('/today?date=2026-09-24')
  const events = page.locator('.schedule-v2-event')
  await expect(events).toHaveCount(2)
  await expect(events.first()).not.toHaveClass(/is-compact/)
  await expect(events.last()).not.toHaveClass(/is-compact/)
  await expect(page.locator('.day-grid-hour-label').filter({ hasText: /^17:00$/ })).toHaveCSS('visibility', 'hidden')
  const timeline = page.locator('.day-grid-scroll')
  await timeline.evaluate((element) => { element.scrollTop = 650; element.dispatchEvent(new Event('scroll')) })
  const position = await timeline.evaluate((element) => element.scrollTop)
  await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть выбор действия' }).click()
  expect(await timeline.evaluate((element) => element.scrollTop)).toBe(position)
  await page.goto(`/workouts/${workoutId}`)
  await page.goto('/today?date=2026-09-24')
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(position)
  await page.screenshot({ path: testInfo.outputPath('lime-calendar-readable.png') })
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

test('short overlapping workouts remain separate tappable cards on mobile and desktop', async ({ page }, testInfo) => {
  const firstId = '10000000-0000-4000-8000-000000000007'
  const secondId = '10000000-0000-4000-8000-000000000008'
  await mockPilot(page, { workouts: [
    { ...workout, id: firstId, clientName: 'Александр Длиннофамильный Первый', startTime: '14:00', endTime: '14:10' },
    { ...workout, id: secondId, clientName: 'Богдан Длиннофамильный Второй', startTime: '14:05', endTime: '14:20' },
  ] })
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/today?date=2026-09-24')
    const events = page.locator('.schedule-v2-event')
    await expect(events).toHaveCount(2)
    const geometry = await events.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }
    }))
    expect(geometry[0]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[1]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[0]!.right).toBeLessThanOrEqual(geometry[1]!.left)
    await expect(events.nth(0)).toHaveAttribute('aria-label', /Александр Длиннофамильный Первый/)
    await expect(events.nth(1)).toHaveAttribute('aria-label', /Богдан Длиннофамильный Второй/)
    if (viewport.width === 390) {
      await events.first().scrollIntoViewIfNeeded()
      const screenshotPath = testInfo.outputPath('trainer-schedule-v2-overlap-mobile.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('trainer-schedule-v2-overlap-mobile', { path: screenshotPath, contentType: 'image/png' })
    }
  }
  await page.locator('.schedule-v2-event').nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${secondId}$`))
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

test('pilot tabs, profile and browser back keep a stable calendar route', async ({ page }, testInfo) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toBeVisible()
  const tabLabels = async () => (await navigation.locator('a').allTextContents()).map((label) => label.trim())
  const initialLabels = await tabLabels()
  expect(initialLabels.slice(0, 3)).toEqual(['Сегодня', 'Расписание', 'Клиенты'])
  await navigation.getByRole('link', { name: 'Расписание' }).click()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('link', { name: 'Клиенты' }).click()
  await expect(page).toHaveURL(/\/clients$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menu')).toHaveCSS('background-color', 'rgb(34, 34, 38)')
  await expect(page.getByRole('menuitem', { name: 'Профиль', exact: true })).toHaveCSS('color', 'rgb(248, 248, 246)')
  const menuScreenshot = testInfo.outputPath('pilot-nav-profile-menu.png')
  await page.screenshot({ path: menuScreenshot })
  await testInfo.attach('pilot-nav-profile-menu', { path: menuScreenshot, contentType: 'image/png' })
  await page.getByRole('menuitem', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menuitem', { name: 'Настройки', exact: true })).toBeVisible()
})

test('pilot calendar keeps workout review and save in the existing entry flow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  expect(await page.evaluate(() => localStorage.getItem('fit.yandexAppSession.v1') !== null)).toBe(true)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.evaluate(({ profileId, workoutClientId }) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'review',
      text: 'Приседания 3 по 8',
      choices: {},
      items: [{
        line: 'Приседания 3 по 8',
        exercise: { ref: 'squat', name: 'Приседания', inputKind: 'reps' },
        sets: [{ position: 0, reps: 8 }],
        hasValues: true,
      }],
      clientId: workoutClientId,
      recordMode: 'planned',
      workoutDate: '2026-09-24',
      startTime: '10:00',
    }))
  }, { profileId: trainerId, workoutClientId: clientId })
  await page.goto('/today?view=review')
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.schedule-v2-timeline')).toHaveCount(0)
  await testInfo.attach('pilot-workout-review', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL(/\/today\?view=save$/)
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await testInfo.attach('pilot-workout-save', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.goto('/today?classic=1#trainer-attention')
  await expect(page.getByRole('heading', { name: 'Составить тренировку' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible()
})
