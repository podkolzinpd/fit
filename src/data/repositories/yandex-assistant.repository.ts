import { z } from 'zod'
import { yandexPilotQueries } from '../queries/yandex-pilot.queries'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { toJson } from '../queries/json'
import type { ClientTrainingSummary, ExerciseSnapshot } from '../../shared/domain'
import type {
  AssistantActionRow,
  AssistantConversation,
  AssistantDataRepository,
  AssistantMessage,
  AssistantRepositoryResult,
  AssistantBackend,
} from './assistant.repository'
import { yandexPilotRepository } from './yandex-pilot.repository'
import { trainingSummaryFromRow } from './training-summaries.repository'

const actionSchema = z.object({
  id: z.uuid().optional(),
  tool: z.enum([
    'record_workout',
    'create_client_draft',
    'create_program_draft',
    'schedule_program',
    'summarize_progress',
  ]),
  status: z.enum(['needs_input', 'proposed']),
  title: z.string(),
  description: z.string(),
  payload: z.record(z.string(), z.unknown()),
  lifecycleStatus: z.enum([
    'proposed',
    'applying',
    'applied',
    'failed',
    'cancelled',
  ]).optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
})

const conversationSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  turnId: z.uuid().nullable(),
  author: z.enum(['user', 'assistant']),
  content: z.string(),
  action: actionSchema.nullable(),
  createdAt: z.iso.datetime(),
})
const storedActionSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  assistantMessageId: z.uuid(),
  status: z.enum(['proposed', 'applying', 'applied', 'failed', 'cancelled']),
  version: z.number().int().positive(),
  result: z.record(z.string(), z.unknown()).nullable(),
})
const turnSchema = z.object({ reply: z.string(), action: actionSchema.nullable() })
const commandResultSchema = z.object({ result: z.record(z.string(), z.unknown()) })
const trainingSummarySchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  period_start: z.iso.date(),
  period_end: z.iso.date(),
  trainer_summary: z.record(z.string(), z.unknown()),
  client_summary: z.record(z.string(), z.unknown()),
  display_metrics: z.record(z.string(), z.unknown()),
  generated_at: z.iso.datetime(),
  version: z.number().int().positive(),
  published: z.boolean().optional(),
})

function conversation(value: z.infer<typeof conversationSchema>): AssistantConversation {
  return { id: value.id, title: value.title, created_at: value.createdAt }
}

function message(value: z.infer<typeof messageSchema>): AssistantMessage {
  return {
    id: value.id,
    conversation_id: value.conversationId,
    turn_id: value.turnId,
    author: value.author,
    content: value.content,
    action: value.action,
    created_at: value.createdAt,
  }
}

function storedAction(value: z.infer<typeof storedActionSchema>): AssistantActionRow {
  return {
    id: value.id,
    conversation_id: value.conversationId,
    assistant_message_id: value.assistantMessageId,
    status: value.status,
    version: value.version,
    result: value.result,
  }
}

function requestError(status: number): Error {
  if (status === 401) return new Error('Сессия Yandex ID истекла. Войдите заново.')
  if (status === 403) return new Error('Yandex Cloud не разрешил это действие.')
  if (status === 404) return new Error('Данные ассистента уже недоступны.')
  if (status === 409) return new Error('Данные изменились. Обновите страницу и повторите действие.')
  if (status === 503) return new Error('Assistant в Yandex Cloud временно недоступен.')
  return new Error('Не удалось выполнить запрос Assistant в Yandex Cloud.')
}

async function response(request: () => Promise<Response>): Promise<Response> {
  let result: Response
  try {
    result = await request()
  } catch {
    throw new Error('Не удалось подключиться к Yandex Cloud.')
  }
  if (!result.ok) throw requestError(result.status)
  return result
}

async function dataResult<Value>(work: () => Promise<Value>): Promise<AssistantRepositoryResult<Value>> {
  try {
    return { data: await work(), error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error
        ? error
        : new Error('Не удалось выполнить запрос Assistant в Yandex Cloud.'),
    }
  }
}

export function createYandexAssistantRepository(
  apiBaseUrl: string,
  sessionToken: string,
): AssistantDataRepository {
  return {
    isAvailable: () => true,
    listConversations: () => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.listAssistantConversations(
        apiBaseUrl, sessionToken, 'read_write',
      ))
      const payload = z.object({ conversations: z.array(conversationSchema) })
        .parse(await result.json())
      return payload.conversations.map(conversation)
    }),
    createConversation: () => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.createAssistantConversation(
        apiBaseUrl, sessionToken, null, 'read_write',
      ))
      const payload = z.object({ conversation: conversationSchema }).parse(await result.json())
      return conversation(payload.conversation)
    }),
    listMessages: (conversationId) => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.listAssistantMessages(
        apiBaseUrl, sessionToken, conversationId, 'read_write',
      ))
      const payload = z.object({ messages: z.array(messageSchema) }).parse(await result.json())
      return payload.messages.map(message)
    }),
    sendTurn: async (conversationId, turnId, content) => {
      const result = await response(() => yandexPilotQueries.sendAssistantTurn(
        apiBaseUrl, sessionToken, conversationId, turnId, content, 'read_write',
      ))
      return turnSchema.parse(await result.json())
    },
    listActions: (conversationId) => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.listAssistantActions(
        apiBaseUrl, sessionToken, conversationId, 'read_write',
      ))
      const payload = z.object({ actions: z.array(storedActionSchema) }).parse(await result.json())
      return payload.actions.map(storedAction)
    }),
    applyAction: (actionId, input, version) => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.applyAssistantAction(
        apiBaseUrl, sessionToken, actionId, input, version, 'read_write',
      ))
      return commandResultSchema.parse(await result.json()).result
    }),
    completeSummary: (actionId, version) => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.completeAssistantSummary(
        apiBaseUrl, sessionToken, actionId, version, 'read_write',
      ))
      return commandResultSchema.parse(await result.json()).result
    }),
    cancelAction: (actionId, version) => dataResult(async () => {
      const result = await response(() => yandexPilotQueries.cancelAssistantAction(
        apiBaseUrl, sessionToken, actionId, version, 'read_write',
      ))
      return commandResultSchema.parse(await result.json()).result
    }),
  }
}

function clientSummaryPayload(summary: ClientTrainingSummary): Record<string, unknown> {
  return {
    headline: summary.headline,
    achievements: summary.achievements,
    consistency: summary.consistency,
    encouragement: summary.encouragement,
    goalAlignment: summary.goalAlignment ?? '',
    nextSteps: summary.nextSteps ?? [],
  }
}

export function createYandexAssistantBackend(
  apiBaseUrl: string,
  sessionToken: string,
): AssistantBackend {
  return {
    cacheKey: 'yandex',
    assistant: createYandexAssistantRepository(apiBaseUrl, sessionToken),
    systemExercises: SYSTEM_EXERCISE_CATALOG,
    listCustomExercises: async () => {
      const data = await yandexPilotRepository.listTrainingData(
        apiBaseUrl,
        sessionToken,
        'read_write',
      )
      return data.customExercises.map((exercise): ExerciseSnapshot => ({
        source: 'custom',
        ref: exercise.id,
        customExerciseId: exercise.id,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        inputKind: exercise.inputKind,
      }))
    },
    parseWorkout: (text, systemCatalog) => yandexPilotRepository.parseWorkout(
      apiBaseUrl,
      sessionToken,
      text,
      systemCatalog,
      'read_write',
    ),
    listTrainingSummaries: async (clientId) => {
      const rows = await yandexPilotRepository.listTrainingSummaries(
        apiBaseUrl,
        sessionToken,
        clientId,
        'read_write',
      )
      return rows.map((row) => {
        const parsed = trainingSummarySchema.parse(row)
        return trainingSummaryFromRow({
          id: parsed.id,
          client_id: parsed.client_id,
          period_start: parsed.period_start,
          period_end: parsed.period_end,
          trainer_summary: toJson(parsed.trainer_summary),
          client_summary: toJson(parsed.client_summary),
          display_metrics: toJson(parsed.display_metrics),
          generated_at: parsed.generated_at,
          version: parsed.version,
        }, parsed.published === true)
      })
    },
    generateTrainingSummary: async (clientId, periodStart, periodEnd, force = false) => {
      const result = await yandexPilotRepository.generateTrainingSummary(
        apiBaseUrl,
        sessionToken,
        clientId,
        periodStart,
        periodEnd,
        force,
        'read_write',
      )
      return { generatedAt: result.data.generated_at, cached: result.cached }
    },
    publishTrainingSummary: (summary, clientCopy) =>
      yandexPilotRepository.publishTrainingSummary(
        apiBaseUrl,
        sessionToken,
        summary.id,
        clientSummaryPayload(clientCopy),
        summary.version,
      ),
  }
}
