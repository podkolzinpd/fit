import { z } from 'zod'
import { yandexPilotQueries } from '../queries/yandex-pilot.queries'

const profileSchema = z.object({
  accessMode: z.literal('read_only'),
  profile: z.object({
    id: z.uuid(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    timezone: z.string().min(1),
    accountRole: z.enum(['trainer', 'client']),
  }),
})

const sessionSchema = profileSchema.extend({
  session: z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime(),
  }),
})

const clientSchema = z.object({
  id: z.uuid(),
  hasAccount: z.boolean(),
  fullName: z.string().min(1),
  canonicalFullName: z.string().min(1),
  gender: z.enum(['male', 'female']).nullable(),
  ageYears: z.number().int().min(1).max(119).nullable(),
  ageUpdatedAt: z.iso.date().nullable(),
  heightCm: z.number().positive().max(260).nullable(),
  goal: z.string().nullable(),
  note: z.string().nullable(),
  currentWeightKg: z.null(),
  lastActivityAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  membershipVersion: z.number().int().positive(),
})

const clientsSchema = z.object({
  accessMode: z.literal('read_only'),
  clients: z.array(clientSchema),
})

const membershipSchema = z.object({
  clientId: z.uuid(),
  trainerId: z.uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  isRoot: z.boolean(),
})

const invitationSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  targetRole: z.enum(['trainer', 'client']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

const connectionsSchema = z.object({
  accessMode: z.literal('read_only'),
  memberships: z.array(membershipSchema),
  invitations: z.array(invitationSchema),
})

const nullableMetricSchema = z.number().nonnegative().nullable()
const workoutSetValuesSchema = z.object({
  weightKg: nullableMetricSchema,
  reps: z.number().int().nonnegative().nullable(),
  durationMin: nullableMetricSchema,
  durationSec: z.number().int().nonnegative().nullable(),
  distanceKm: nullableMetricSchema,
  rpe: z.number().min(6).max(10).nullable(),
})
const workoutSetSchema = z.object({
  id: z.uuid(),
  position: z.number().int().nonnegative(),
  plan: workoutSetValuesSchema,
  fact: workoutSetValuesSchema,
  confirmedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
})
const workoutExerciseSchema = z.object({
  id: z.uuid(),
  position: z.number().int().nonnegative(),
  source: z.enum(['system', 'custom']),
  ref: z.string().min(1),
  customExerciseId: z.uuid().nullable(),
  name: z.string().min(1),
  muscleGroup: z.enum([
    'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
    'cardio', 'other',
  ]),
  inputKind: z.enum(['strength', 'distance', 'reps', 'duration']),
  blockId: z.uuid(),
  blockType: z.enum(['single', 'group']),
  blockPreset: z.enum(['set', 'circuit', 'interval']),
  blockRounds: z.number().int().positive(),
  restBetweenExercisesSec: z.number().int().nonnegative(),
  restBetweenRoundsSec: z.number().int().nonnegative(),
  restBetweenSetsSec: z.number().int().nonnegative(),
  trainerComment: z.string().nullable(),
  sets: z.array(workoutSetSchema),
})
const workoutSchema = z.object({
  id: z.uuid(),
  trainerId: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string().min(1),
  createdBy: z.uuid().nullable(),
  workoutDate: z.iso.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/).nullable(),
  status: z.enum(['planned', 'in_progress', 'done', 'cancelled']),
  notes: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  exercises: z.array(workoutExerciseSchema),
})
const customExerciseSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  muscleGroup: workoutExerciseSchema.shape.muscleGroup,
  inputKind: workoutExerciseSchema.shape.inputKind,
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
})
const trainingDataSchema = z.object({
  accessMode: z.literal('read_only'),
  customExercises: z.array(customExerciseSchema),
  workouts: z.array(workoutSchema),
  hasMoreWorkouts: z.boolean(),
})

const createdInvitationSchema = z.object({
  invitation: invitationSchema.extend({
    code: z.string().regex(/^[A-F0-9]{12}$/),
  }).omit({ createdAt: true }),
})

const claimedInvitationSchema = z.object({ clientId: z.uuid() })

export type YandexPilotSession = z.infer<typeof sessionSchema>
export type YandexPilotClient = z.infer<typeof clientSchema>
export type YandexPilotMembership = z.infer<typeof membershipSchema>
export type YandexPilotInvitation = z.infer<typeof invitationSchema>
export type YandexPilotConnections = Omit<z.infer<typeof connectionsSchema>, 'accessMode'>
export type YandexPilotCreatedInvitation = z.infer<typeof createdInvitationSchema>['invitation']
export type YandexPilotTrainingData = Omit<z.infer<typeof trainingDataSchema>, 'accessMode'>

function responseError(status: number): Error {
  if (status === 401) return new Error('Yandex ID не подтвердил вход. Начните заново.')
  if (status === 403) return new Error('Этот аккаунт пока не добавлен в пилот.')
  if (status === 404) return new Error('Профиль для пилота не найден.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось проверить доступ к пилоту.')
}

function clientsResponseError(status: number): Error {
  if (status === 401) return new Error('Сессия пилота истекла. Начните вход через Yandex ID заново.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось загрузить клиентов из stage.')
}

function commandResponseError(status: number): Error {
  if (status === 401) return new Error('Сессия пилота истекла. Начните вход через Yandex ID заново.')
  if (status === 403) return new Error('Недостаточно прав для этого действия.')
  if (status === 404) return new Error('Приглашение или связь уже недоступны. Обновите данные.')
  if (status === 409) return new Error('Карточка клиента уже связана с другим аккаунтом.')
  if (status === 422) return new Error('Основного тренера нельзя отключить или вывести из пространства.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось изменить связи в stage.')
}

async function commandResponse(request: () => Promise<Response>): Promise<Response> {
  let response: Response
  try {
    response = await request()
  } catch {
    throw new Error('Не удалось подключиться к Yandex Cloud stage.')
  }
  if (!response.ok) throw commandResponseError(response.status)
  return response
}

export const yandexPilotRepository = {
  async exchangeCodeForSession(apiBaseUrl: string, code: string, codeVerifier: string): Promise<YandexPilotSession> {
    let response: Response
    try {
      response = await yandexPilotQueries.exchangeCodeForSession(apiBaseUrl, code, codeVerifier)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw responseError(response.status)
    const result = sessionSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат сессии.')
    return result.data
  },
  async listClients(apiBaseUrl: string, sessionToken: string): Promise<YandexPilotClient[]> {
    let response: Response
    try {
      response = await yandexPilotQueries.listClients(apiBaseUrl, sessionToken)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw clientsResponseError(response.status)
    const result = clientsSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат клиентов.')
    return result.data.clients
  },
  async listConnections(apiBaseUrl: string, sessionToken: string): Promise<YandexPilotConnections> {
    let response: Response
    try {
      response = await yandexPilotQueries.listConnections(apiBaseUrl, sessionToken)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw clientsResponseError(response.status)
    const result = connectionsSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат связей.')
    return {
      memberships: result.data.memberships,
      invitations: result.data.invitations,
    }
  },
  async listTrainingData(apiBaseUrl: string, sessionToken: string): Promise<YandexPilotTrainingData> {
    let response: Response
    try {
      response = await yandexPilotQueries.listTrainingData(apiBaseUrl, sessionToken)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw clientsResponseError(response.status)
    const result = trainingDataSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат тренировок.')
    return {
      customExercises: result.data.customExercises,
      workouts: result.data.workouts,
      hasMoreWorkouts: result.data.hasMoreWorkouts,
    }
  },
  async createInvitation(
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<YandexPilotCreatedInvitation> {
    const response = await commandResponse(() => yandexPilotQueries.createInvitation(
      apiBaseUrl,
      sessionToken,
      clientId,
      targetRole,
    ))
    const result = createdInvitationSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат приглашения.')
    return result.data.invitation
  },
  async claimInvitation(
    apiBaseUrl: string,
    sessionToken: string,
    code: string,
  ): Promise<string> {
    const response = await commandResponse(() => yandexPilotQueries.claimInvitation(
      apiBaseUrl,
      sessionToken,
      code.trim().toUpperCase(),
    ))
    const result = claimedInvitationSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый результат приглашения.')
    return result.data.clientId
  },
  async revokeInvitation(
    apiBaseUrl: string,
    sessionToken: string,
    invitationId: string,
  ): Promise<void> {
    await commandResponse(() => yandexPilotQueries.revokeInvitation(
      apiBaseUrl,
      sessionToken,
      invitationId,
    ))
  },
  async removeTrainer(
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    trainerId: string,
  ): Promise<void> {
    await commandResponse(() => yandexPilotQueries.removeTrainer(
      apiBaseUrl,
      sessionToken,
      clientId,
      trainerId,
    ))
  },
  async leaveClient(
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
  ): Promise<void> {
    await commandResponse(() => yandexPilotQueries.leaveClient(
      apiBaseUrl,
      sessionToken,
      clientId,
    ))
  },
}
