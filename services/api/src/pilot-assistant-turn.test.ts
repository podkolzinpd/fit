import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { QueryResultRow } from 'pg'

import { AssistantStateError } from './assistant-state.js'
import {
  activeAssistantToolForFeatureLinks,
  recordWorkoutTurnForFeatureLinks,
  DatabasePilotAssistantTurnRunner,
} from './pilot-assistant-turn.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'

const CONVERSATION_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
const TURN_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const CLIENT_ID = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'
const SESSION = { accessMode: 'read_write' as const, token: 'A'.repeat(43) }
const ACTOR_ID = '81a1139a-1011-41be-a906-a9d3f8b70d8c'
const actor = { id: ACTOR_ID, account_role: 'trainer', timezone: 'Europe/Moscow', assistant_feature_links: false }

beforeEach(() => { vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'false') })
afterEach(() => { vi.unstubAllEnvs() })

function poolWithRows(rows: readonly unknown[][]): {
  pool: DatabasePool
  query: Mock<(text: string, values?: readonly unknown[]) => Promise<readonly unknown[]>>
} {
  const pending = [...rows]
  const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<readonly unknown[]>>((text, values) => {
    void values
    if (text === 'begin' || text === 'commit' || text === 'rollback' || text.includes('set_config')) return Promise.resolve([])
    if (text.includes('resolve_yandex_app_session')) return Promise.resolve([{ profile_id: ACTOR_ID }])
    return Promise.resolve(pending.shift() ?? [])
  })
  const connection: DatabaseConnection = {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => await query(text, values) as readonly Row[],
    release: vi.fn(),
  }
  const pool: DatabasePool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve() }
  return { pool, query }
}

describe('native pilot assistant turn', () => {
  it('retires an old workout draft when feature-link navigation owns workout entry', () => {
    const workout = {
      tool: 'record_workout' as const,
      status: 'needs_input' as const,
      title: 'Продолжайте диктовку',
      description: 'Добавила фрагмент.',
      payload: { step: 'workout', transcript: 'жим лёжа 3 по 10' },
    }
    const program = {
      tool: 'create_program_draft' as const,
      status: 'needs_input' as const,
      title: 'Условия программы',
      description: 'Уточните цель.',
      payload: { step: 'brief', programPilot: true },
    }

    expect(activeAssistantToolForFeatureLinks(workout, true)).toBeNull()
    expect(activeAssistantToolForFeatureLinks(workout, false)).toBe(workout)
    expect(activeAssistantToolForFeatureLinks(program, true)).toBe(program)
  })

  it('turns a dictated fragment from an old workout draft into a home-page link', () => {
    const active = {
      tool: 'record_workout' as const,
      status: 'needs_input' as const,
      title: 'Продолжайте диктовку',
      description: 'Добавила фрагмент.',
      payload: { step: 'workout', clientId: CLIENT_ID, clientName: 'Анна Смирнова', transcript: 'жим лёжа 3 по 10' },
    }
    const clients = [{ id: CLIENT_ID, fullName: 'Анна Смирнова', goal: null, ageYears: 30, heightCm: 170, gender: 'female' }]

    expect(recordWorkoutTurnForFeatureLinks('тяга 3 по 12', clients, active, true, false, true)).toEqual({
      reply: 'Запись тренировки открывается на главной странице:\n[[fit-link:/today?view=compose|Записать тренировку]]',
      action: null,
    })
    expect(recordWorkoutTurnForFeatureLinks('тяга 3 по 12', clients, active, true, false, false)?.action?.tool)
      .toBe('record_workout')
  })

  it('persists deterministic capability replies without Supabase authorization', async () => {
    const { pool, query } = poolWithRows([
      [],
      [],
      [actor],
      [],
      [],
      [{ result: { messageId: 'message-id', deduplicated: false } }],
    ])

    await expect(new DatabasePilotAssistantTurnRunner(pool).runTurn(SESSION, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'что ты умеешь?',
    })).resolves.toEqual({
      reply: 'Могу подготовить запись выполненной тренировки; коротко обсудить тренировки, упражнения, восстановление и спорт.',
      action: null,
    })

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('append_assistant_user_message'),
      [CONVERSATION_ID, TURN_ID, 'что ты умеешь?'],
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('persist_assistant_response'),
      [CONVERSATION_ID, TURN_ID, expect.any(String), null],
    )
  })

  it('replays an already persisted assistant response for the same turn', async () => {
    const { pool, query } = poolWithRows([
      [{ content: 'Привет! Чем помочь?', action: null }],
      [{ content: 'привет' }],
    ])

    await expect(new DatabasePilotAssistantTurnRunner(pool).runTurn(SESSION, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'привет',
    })).resolves.toEqual({
      reply: 'Привет! Чем помочь?',
      action: null,
    })

    expect(query).toHaveBeenCalledTimes(6)
    expect(query.mock.calls.map(([text]) => text).filter(text => /append_assistant_user_message|persist_assistant_response/.test(text))).toEqual([])
  })

  it('rejects reused turn ids with different user text', async () => {
    const { pool } = poolWithRows([
      [{ content: 'Привет! Чем помочь?', action: null }],
      [{ content: 'привет' }],
    ])

    await expect(new DatabasePilotAssistantTurnRunner(pool).runTurn(SESSION, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'другой текст',
    })).rejects.toEqual(new AssistantStateError('conflict'))
  })

  it('adds a persistent action id before saving proposed workout drafts', async () => {
    const { pool, query } = poolWithRows([
      [],
      [],
      [actor],
      [{
        id: CLIENT_ID,
        full_name: 'Анна Смирнова',
        goal: null,
        age_years: 30,
        height_cm: '170',
        gender: 'female',
      }],
      [{
        author: 'assistant',
        content: 'Продолжайте диктовку',
        action: {
          tool: 'record_workout',
          status: 'needs_input',
          title: 'Продолжайте диктовку',
          description: 'Добавила первый фрагмент.',
          payload: {
            step: 'workout',
            clientId: CLIENT_ID,
            clientName: 'Анна Смирнова',
            transcript: 'присед 3 по 10',
          },
        },
      }],
      [{ result: { messageId: 'message-id', deduplicated: false } }],
    ])

    const response = await new DatabasePilotAssistantTurnRunner(pool).runTurn(
      SESSION,
      {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        message: 'готово',
      },
    )

    const actionIdPattern: unknown = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(response.action).toMatchObject({
      id: actionIdPattern,
      tool: 'record_workout',
      status: 'proposed',
      payload: {
        step: 'confirm',
        clientId: CLIENT_ID,
        transcript: 'присед 3 по 10',
      },
    })
    const persistValues = query.mock.calls.find(([text]) => text.includes('persist_assistant_response'))?.[1] as readonly unknown[]
    expect(JSON.parse(String(persistValues[3]))).toMatchObject({
      id: response.action?.id,
      tool: 'record_workout',
      status: 'proposed',
    })
  })

  it('automatically records a client workout against the actor client card', async () => {
    const { pool } = poolWithRows([
      [],
      [],
      [{ ...actor, account_role: 'client' }],
      [{
        id: CLIENT_ID,
        full_name: 'Анна Смирнова',
        goal: null,
        age_years: 30,
        height_cm: '170',
        gender: 'female',
      }],
      [],
      [{ result: { messageId: 'message-id', deduplicated: false } }],
    ])

    await expect(new DatabasePilotAssistantTurnRunner(pool).runTurn(SESSION, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'Запиши мою тренировку: присед 3 по 10',
    })).resolves.toMatchObject({
      action: {
        tool: 'record_workout',
        payload: { step: 'workout', clientId: CLIENT_ID, clientName: 'Анна Смирнова' },
      },
    })
  })
})
