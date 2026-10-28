import { MeetingAccessError } from '../../shared/meeting'
import { z } from 'zod'
import type { ChatMeetingsRepository } from '../../shared/meeting'
import type { YandexMainQueries } from '../queries/yandex-main.queries'
import { createMeetingPreview } from '../queries/jitsi-media'

const stateSchema = z.object({
  available: z.boolean(), mediaOrigin: z.url().optional(),
  meeting: z.object({ id: z.uuid(), participantCount: z.number().int().nonnegative() }).nullable(),
  credentials: z.object({ origin: z.url(), domain: z.string(), muc: z.string(), room: z.string(), token: z.string(), expiresAt: z.string() }).optional(),
})
export function createChatMeetingsRepository(queries: YandexMainQueries): ChatMeetingsRepository {
  async function result(response: Response) {
    if ([401,403,409].includes(response.status)) throw new MeetingAccessError(response.status === 409
      ? 'Встреча завершилась. Вернитесь в чат и присоединитесь заново.' : 'Видеовстреча недоступна для этого диалога.')
    if (!response.ok) throw new Error('Не удалось подключиться. Попробуйте ещё раз.')
    return stateSchema.parse(await response.json())
  }
  return {
    state: async (conversationId) => result(await queries.read(`/v1/chat/conversations/${conversationId}/meeting`)),
    command: async (conversationId, action, tabId, meetingId) => result(await queries.write(`/v1/chat/conversations/${conversationId}/meeting`, 'POST', { action, tabId, meetingId })),
    preview: createMeetingPreview,
  }
}
