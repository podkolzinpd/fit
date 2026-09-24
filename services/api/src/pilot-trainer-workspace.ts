import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

interface ClientRow extends QueryResultRow { id: string }
interface AttentionRow extends QueryResultRow {
  workout_id: string
  client_id: string
  client_name: string
  workout_date: string
  client_question: string | null
  client_question_asked_at: string | null
  discomfort: boolean
}
interface WorkoutRow extends QueryResultRow {
  client_id: string
  workout_date: string
  status: 'planned' | 'in_progress' | 'done' | 'cancelled'
}
interface PreferenceRow extends QueryResultRow {
  client_id: string
  attention_snoozed_until: Date | null
}
interface UnreadRow extends QueryResultRow { unread_count: string | number }

export interface TrainerWorkspaceQuestion {
  workoutId: string
  clientId: string
  clientName: string
  question: string
  askedAt: string
}

export interface TrainerWorkspaceResponse {
  summary: {
    pendingActionCount: number
    unresolvedQuestionCount: number
    unreadChatMessageCount: number
    inboxCount: number
    updatedAt: string
  }
  questions: TrainerWorkspaceQuestion[]
}

export interface PilotTrainerWorkspace {
  read(session: YandexActorSessionInput): Promise<TrainerWorkspaceResponse>
}

export class TrainerWorkspaceUnavailableError extends Error {
  constructor() {
    super('Trainer workspace is available only to trainers')
    this.name = 'TrainerWorkspaceUnavailableError'
  }
}

function isoValue(value: string | Date | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export class DatabasePilotTrainerWorkspace implements PilotTrainerWorkspace {
  constructor(
    private readonly pool: DatabasePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(session: YandexActorSessionInput): Promise<TrainerWorkspaceResponse> {
    return withYandexActorSession(this.pool, session, async (client) => {
      const todayRows = await client.query<QueryResultRow & { today: string }>(
        "select (now() at time zone profile.timezone)::date::text as today from public.profiles profile where profile.id = auth.uid() and profile.account_role = 'trainer'",
      )
      const today = todayRows[0]?.today
      if (today === undefined) throw new TrainerWorkspaceUnavailableError()

      const [clients, attention, workouts, preferences, threads] = await Promise.all([
        client.query<ClientRow>('select id from public.list_client_overviews(false)'),
        client.query<AttentionRow>(`
          select workout_id, client_id, client_name, workout_date::text,
            client_question, client_question_asked_at, discomfort
          from public.list_trainer_attention_workouts()
        `),
        client.query<WorkoutRow>(`
          select workout.client_id, workout.workout_date::text, workout.status
          from public.workouts workout
          join public.clients client on client.id = workout.client_id
          where workout.deleted_at is null and client.archived_at is null
        `),
        client.query<PreferenceRow>(`
          select client_id, attention_snoozed_until
          from public.client_trainers
          where trainer_id = auth.uid()
        `),
        client.query<UnreadRow>('select unread_count from public.list_chat_threads()'),
      ])

      const attentionByClient = new Map<string, AttentionRow[]>()
      for (const row of attention) {
        attentionByClient.set(row.client_id, [...(attentionByClient.get(row.client_id) ?? []), row])
      }
      const workoutsByClient = new Map<string, WorkoutRow[]>()
      for (const row of workouts) {
        workoutsByClient.set(row.client_id, [...(workoutsByClient.get(row.client_id) ?? []), row])
      }
      const snoozedUntil = new Map(preferences.map((row) => [row.client_id, row.attention_snoozed_until]))
      let pendingActionCount = 0
      for (const { id } of clients) {
        const clientAttention = attentionByClient.get(id) ?? []
        const hasQuestion = clientAttention.some((row) => Boolean(row.client_question))
        const hasDiscomfort = clientAttention.some((row) => row.discomfort)
        const clientWorkouts = workoutsByClient.get(id) ?? []
        const hasPastPlan = clientWorkouts.some((row) => row.status === 'planned' && row.workout_date < today)
        const hasAction = hasQuestion || hasDiscomfort || hasPastPlan
        if (hasAction) {
          pendingActionCount += 1
          continue
        }
        const snoozed = snoozedUntil.get(id)
        if (snoozed !== undefined && snoozed !== null && snoozed > this.now()) continue
        const hasNext = clientWorkouts.some((row) => row.status === 'in_progress'
          || (row.status === 'planned' && row.workout_date >= today))
        if (!hasNext) pendingActionCount += 1
      }

      const questions = attention
        .filter((row): row is AttentionRow & { client_question: string } => Boolean(row.client_question))
        .map((row) => ({
          workoutId: row.workout_id,
          clientId: row.client_id,
          clientName: row.client_name,
          question: row.client_question,
          askedAt: isoValue(row.client_question_asked_at) ?? `${row.workout_date}T00:00:00.000Z`,
        }))
        .sort((left, right) => right.askedAt.localeCompare(left.askedAt))
      const unreadChatMessageCount = threads.reduce((sum, row) => sum + Number(row.unread_count), 0)
      return {
        summary: {
          pendingActionCount,
          unresolvedQuestionCount: questions.length,
          unreadChatMessageCount,
          inboxCount: questions.length + unreadChatMessageCount,
          updatedAt: this.now().toISOString(),
        },
        questions,
      }
    })
  }
}
