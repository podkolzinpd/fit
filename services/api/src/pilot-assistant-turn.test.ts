import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'

import { AssistantStateError } from './assistant-state.js'
import {
  runNativePilotAssistantTurn,
} from './pilot-assistant-turn.js'
import type { DatabaseClient } from './db/types.js'

const CONVERSATION_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
const TURN_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const CLIENT_ID = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'
const ACTION_ID = '81a1139a-1011-41be-a906-a9d3f8b70d8c'

function clientWithRows(rows: readonly unknown[][]): {
  client: DatabaseClient
  query: ReturnType<typeof vi.fn>
} {
  const pending = [...rows]
  const query = vi.fn((text: string, values?: readonly unknown[]) => {
    void text
    void values
    return Promise.resolve(pending.shift() ?? [])
  })
  const client: DatabaseClient = {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => await query(text, values) as readonly Row[],
  }
  return { client, query }
}

describe('native pilot assistant turn', () => {
  it('persists deterministic capability replies without Supabase authorization', async () => {
    const { client, query } = clientWithRows([
      [],
      [],
      [{ result: { messageId: 'message-id', deduplicated: false } }],
    ])

    await expect(runNativePilotAssistantTurn(client, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'что ты умеешь?',
    })).resolves.toEqual({
      reply: 'Могу коротко пообщаться и записать тренировку — целиком или по одному упражнению, текстом или голосом.',
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
    const { client, query } = clientWithRows([
      [{ content: 'Привет! Чем помочь?', action: null }],
      [{ content: 'привет' }],
    ])

    await expect(runNativePilotAssistantTurn(client, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'привет',
    })).resolves.toEqual({
      reply: 'Привет! Чем помочь?',
      action: null,
    })

    expect(query).toHaveBeenCalledTimes(2)
  })

  it('rejects reused turn ids with different user text', async () => {
    const { client } = clientWithRows([
      [{ content: 'Привет! Чем помочь?', action: null }],
      [{ content: 'привет' }],
    ])

    await expect(runNativePilotAssistantTurn(client, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      message: 'другой текст',
    })).rejects.toEqual(new AssistantStateError('conflict'))
  })

  it('adds a persistent action id before saving proposed workout drafts', async () => {
    const { client, query } = clientWithRows([
      [],
      [],
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

    const response = await runNativePilotAssistantTurn(
      client,
      {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        message: 'готово',
      },
      { createId: () => ACTION_ID },
    )

    expect(response.action).toMatchObject({
      id: ACTION_ID,
      tool: 'record_workout',
      status: 'proposed',
      payload: {
        step: 'confirm',
        clientId: CLIENT_ID,
        transcript: 'присед 3 по 10',
      },
    })
    const persistValues = query.mock.calls.at(-1)?.[1] as readonly unknown[]
    expect(JSON.parse(String(persistValues[3]))).toMatchObject({
      id: ACTION_ID,
      tool: 'record_workout',
      status: 'proposed',
    })
  })
})
