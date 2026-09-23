import { legacyCloudApiBaseUrl } from './legacy-cloud-functions'
import { getSupabaseClient } from './client'

type ChatMediaBridgeError = Error | { context: Response }

async function invoke<T>(action: 'upload' | 'sign' | 'remove', body: unknown): Promise<{ data: T | null; error: ChatMediaBridgeError | null } | undefined> {
  const baseUrl = legacyCloudApiBaseUrl()
  if (baseUrl === undefined) return undefined
  const { data: { session } } = await getSupabaseClient().auth.getSession()
  if (!session?.access_token) return { data: null, error: new Error('authentication_required') }
  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/legacy/chat-media/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('legacy_chat_media_request_failed') }
  }
  if (!response.ok) return { data: null, error: { context: response } }
  if (action === 'sign') {
    try { return { data: await response.json() as T, error: null } } catch { return { data: null, error: new Error('invalid_json') } }
  }
  return { data: null, error: null }
}

export const chatMediaBridgeQueries = {
  upload: (conversationId: string, messageId: string, image: { dataUrl: string; mimeType: 'image/jpeg'; width: number; height: number; sizeBytes: number }) =>
    invoke<void>('upload', { conversationId, messageId, image }),
  sign: (conversationId: string, messageId: string) =>
    invoke<{ signedUrl: string }>('sign', { conversationId, messageId }),
  remove: (conversationId: string, messageId: string) =>
    invoke<void>('remove', { conversationId, messageId }),
}
