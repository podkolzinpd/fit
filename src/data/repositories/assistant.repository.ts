import { assistantHistoryQueries } from '../queries/assistant-history.queries'
import { assistantOrchestratorUrl, sendAssistantTurn } from '../queries/assistant-orchestrator'
import { toJson } from '../queries/json'
export type { AssistantOrchestratorAction } from '../queries/assistant-orchestrator'
import type { AssistantOrchestratorReply } from '../queries/assistant-orchestrator'
import type { AssistantOrchestratorAction } from '../queries/assistant-orchestrator'
import type {
  ClientTrainingSummary,
  ExerciseSnapshot,
  TrainingSummary,
} from '../../shared/domain'
import { exercisesRepository, type WorkoutParseResponse } from './exercises.repository'
import { trainingSummariesRepository } from './training-summaries.repository'
import { repositoryError } from './error'

export type AssistantConversation = {
  id: string
  title: string | null
  created_at: string
}

export type AssistantMessage = {
  id: string
  conversation_id: string
  turn_id: string | null
  author: string
  content: string
  action: AssistantOrchestratorAction | null
  created_at: string
}

export type AssistantActionRow = {
  id: string
  conversation_id: string
  assistant_message_id: string
  status: string
  version: number
  result: Record<string, unknown> | null
}

export type AssistantRepositoryResult<Value> = {
  data: Value | null
  error: Error | null
}

export interface AssistantDataRepository {
  isAvailable(): boolean
  listConversations(): Promise<AssistantRepositoryResult<AssistantConversation[]>>
  createConversation(ownerId: string): Promise<AssistantRepositoryResult<AssistantConversation>>
  listMessages(conversationId: string): Promise<AssistantRepositoryResult<AssistantMessage[]>>
  sendTurn(
    conversationId: string,
    turnId: string,
    message: string,
  ): Promise<AssistantOrchestratorReply>
  listActions(conversationId: string): Promise<AssistantRepositoryResult<AssistantActionRow[]>>
  applyAction(
    actionId: string,
    input: object,
    version: number,
  ): Promise<AssistantRepositoryResult<Record<string, unknown>>>
  completeSummary(
    actionId: string,
    version: number,
  ): Promise<AssistantRepositoryResult<Record<string, unknown>>>
  cancelAction(
    actionId: string,
    version: number,
  ): Promise<AssistantRepositoryResult<Record<string, unknown>>>
}

export interface AssistantBackend {
  cacheKey: string
  assistant: AssistantDataRepository
  systemExercises: readonly ExerciseSnapshot[]
  listCustomExercises(): Promise<ExerciseSnapshot[]>
  parseWorkout(
    text: string,
    systemCatalog: readonly ExerciseSnapshot[],
  ): Promise<WorkoutParseResponse>
  listTrainingSummaries(clientId: string): Promise<TrainingSummary[]>
  generateTrainingSummary(
    clientId: string,
    periodStart: string,
    periodEnd: string,
    force?: boolean,
  ): Promise<{ generatedAt: string; cached: boolean }>
  publishTrainingSummary(
    summary: TrainingSummary,
    clientCopy: ClientTrainingSummary,
  ): Promise<void>
}

function assistantResult<Value>(result: {
  data: unknown
  error: unknown
}): AssistantRepositoryResult<Value> {
  return {
    data: result.data as Value | null,
    error: result.error === null ? null : repositoryError(result.error),
  }
}

export const assistantRepository: AssistantDataRepository = {
  isAvailable: () => assistantOrchestratorUrl() !== undefined,
  listConversations: async () => assistantResult<AssistantConversation[]>(
    await assistantHistoryQueries.listConversations(),
  ),
  createConversation: async (ownerId) => assistantResult<AssistantConversation>(
    await assistantHistoryQueries.createConversation(ownerId),
  ),
  listMessages: async (conversationId) => assistantResult<AssistantMessage[]>(
    await assistantHistoryQueries.listMessages(conversationId),
  ),
  sendTurn: sendAssistantTurn,
  listActions: async (conversationId) => assistantResult<AssistantActionRow[]>(
    await assistantHistoryQueries.listActions(conversationId),
  ),
  applyAction: async (actionId, input, version) => assistantResult<Record<string, unknown>>(
    await assistantHistoryQueries.applyAction(actionId, toJson(input), version),
  ),
  completeSummary: async (actionId, version) => assistantResult<Record<string, unknown>>(
    await assistantHistoryQueries.completeSummary(actionId, version),
  ),
  cancelAction: async (actionId, version) => assistantResult<Record<string, unknown>>(
    await assistantHistoryQueries.cancelAction(actionId, version),
  ),
}

export const supabaseAssistantBackend: AssistantBackend = {
  cacheKey: 'supabase',
  assistant: assistantRepository,
  systemExercises: exercisesRepository.system,
  listCustomExercises: () => exercisesRepository.list(),
  parseWorkout: (text, systemCatalog) => exercisesRepository.parseWorkout(text, systemCatalog),
  listTrainingSummaries: (clientId) => trainingSummariesRepository.listForTrainer(clientId),
  generateTrainingSummary: (clientId, periodStart, periodEnd, force) =>
    trainingSummariesRepository.generate(clientId, periodStart, periodEnd, force),
  publishTrainingSummary: (summary, clientCopy) =>
    trainingSummariesRepository.publish(summary, clientCopy),
}
