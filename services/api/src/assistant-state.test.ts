import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from './db/types.js'
import {
  applyAssistantAction,
  AssistantStateError,
} from './assistant-state.js'

describe('assistant state errors', () => {
  it.each([
    'assistant_trainer_required',
    'assistant_action_forbidden',
    'assistant_client_card_required',
  ])('maps %s to a forbidden response', async (message) => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error(message)),
    } as unknown as DatabaseClient

    await expect(applyAssistantAction(client, 'action-id', {}, 1))
      .rejects.toEqual(new AssistantStateError('forbidden'))
  })
})
