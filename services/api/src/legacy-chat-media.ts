import type { ChatImageUpload, ChatMediaStore } from './chat-media.js'
import type { MediaObjectStorage } from './object-storage-media.js'
import { SupabaseBridge, SupabaseBridgeError } from './supabase-bridge.js'

type MediaAction = 'read' | 'remove' | 'send'

export class LegacyChatMediaAuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super('legacy_chat_media_authorization_failed')
  }
}

export interface LegacyChatMediaAuthorizer {
  authorize(accessToken: string, action: MediaAction, conversationId: string, messageId: string): Promise<void>
}

export class SupabaseLegacyChatMediaAuthorizer implements LegacyChatMediaAuthorizer {
  constructor(private readonly supabase: SupabaseBridge) {}

  async authorize(accessToken: string, action: MediaAction, conversationId: string, messageId: string): Promise<void> {
    const rpc = action === 'send'
      ? 'authorize_chat_send'
      : action === 'read'
        ? 'authorize_chat_media_read'
        : 'authorize_chat_media_remove'
    const body = action === 'send'
      ? { p_conversation_id: conversationId }
      : { p_conversation_id: conversationId, p_message_id: messageId }
    try {
      await this.supabase.rpc<unknown>(rpc, body, accessToken)
    } catch (error) {
      if (error instanceof SupabaseBridgeError) {
        if (error.status === 401) throw new LegacyChatMediaAuthorizationError(401)
        if (error.status === 403 || error.status === 404) throw new LegacyChatMediaAuthorizationError(403)
        throw new LegacyChatMediaAuthorizationError(503)
      }
      throw new LegacyChatMediaAuthorizationError(503)
    }
  }
}

function pathFor(conversationId: string, messageId: string): string {
  return `${conversationId}/${messageId}.jpg`
}

/**
 * Keeps Supabase as the chat database during the auth migration while making
 * Yandex Object Storage the write path for every browser-authenticated user.
 * Older rows have no storage marker, so their existing Supabase object remains
 * readable until the dedicated media-copy job moves it to S3.
 */
export class LegacyChatMediaBridge {
  constructor(
    private readonly authorizer: LegacyChatMediaAuthorizer,
    private readonly yandexStorage: MediaObjectStorage,
    private readonly legacyStorage: ChatMediaStore,
  ) {}

  async upload(accessToken: string, conversationId: string, messageId: string, image: ChatImageUpload): Promise<void> {
    await this.authorizer.authorize(accessToken, 'send', conversationId, messageId)
    await this.yandexStorage.write('chat-media', pathFor(conversationId, messageId), image.bytes, image.mimeType, false)
  }

  async sign(accessToken: string, conversationId: string, messageId: string): Promise<string> {
    await this.authorizer.authorize(accessToken, 'read', conversationId, messageId)
    const path = pathFor(conversationId, messageId)
    const stored = await this.yandexStorage.stat('chat-media', path)
    return stored === undefined
      ? this.legacyStorage.sign(path)
      : this.yandexStorage.sign('chat-media', path)
  }

  async remove(accessToken: string, conversationId: string, messageId: string): Promise<void> {
    await this.authorizer.authorize(accessToken, 'remove', conversationId, messageId)
    const path = pathFor(conversationId, messageId)
    const stored = await this.yandexStorage.stat('chat-media', path)
    if (stored === undefined) await this.legacyStorage.remove(path)
    else await this.yandexStorage.remove('chat-media', path)
  }
}
