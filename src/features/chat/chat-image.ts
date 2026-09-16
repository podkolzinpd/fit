import type { ChatImageDraft } from '../../shared/domain'
import { prepareImage } from '../../shared/image-prep'

export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const CHAT_IMAGE_MAX_EDGE = 1600

export function prepareChatImage(file: File): Promise<ChatImageDraft> {
  return prepareImage(file, { maxBytes: CHAT_IMAGE_MAX_BYTES, maxEdge: CHAT_IMAGE_MAX_EDGE })
}
