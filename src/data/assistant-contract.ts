import type { ClientTrainingSummary, ExerciseSnapshot, TrainingSummary } from '../shared/domain'
import type { WorkoutParseResponse } from '../shared/workout-parse-response'

export type AssistantOrchestratorAction = {
  id?: string
  tool: 'record_workout' | 'create_client_draft' | 'create_program_draft' | 'schedule_program' | 'summarize_progress'
  status: 'needs_input' | 'proposed'
  title: string
  description: string
  payload: Record<string, unknown>
  lifecycleStatus?: 'proposed' | 'applying' | 'applied' | 'failed' | 'cancelled'
  result?: Record<string, unknown> | null
}

export type AssistantOrchestratorReply = { reply: string; action: AssistantOrchestratorAction | null }

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
