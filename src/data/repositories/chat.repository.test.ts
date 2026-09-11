import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({
  listThreads: vi.fn(), open: vi.fn(), listMessages: vi.fn(), send: vi.fn(), markRead: vi.fn(), subscribe: vi.fn(),
}))
const media = vi.hoisted(() => ({ upload: vi.fn(), createSignedUrl: vi.fn() }))
vi.mock('../queries/chat.queries', () => ({ chatQueries: queries, chatMedia: media }))

import { chatRepository } from './chat.repository'

const imageRow = {
  id: 'message-1', conversation_id: 'conversation-1', sender_id: 'sender-1', body: '', created_at: '2026-09-11T10:00:00.000Z',
  image_path: 'conversation-1/message-1.jpg', image_mime_type: 'image/jpeg', image_width: 1200, image_height: 900, image_size_bytes: 3,
}
const image = { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg' as const, width: 1200, height: 900, sizeBytes: 3 }

describe('chatRepository photo messages', () => {
  beforeEach(() => {
    for (const mock of Object.values(queries)) mock.mockReset()
    media.upload.mockReset().mockResolvedValue({ data: { path: imageRow.image_path }, error: null })
    media.createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://media.example.test/photo' }, error: null })
  })

  it('uploads a private JPEG before sending its metadata and returns a signed image', async () => {
    queries.send.mockResolvedValue({ data: [imageRow], error: null })

    await expect(chatRepository.send('conversation-1', 'message-1', '', image)).resolves.toMatchObject({
      id: 'message-1', body: '', image: { url: 'https://media.example.test/photo', width: 1200, height: 900 },
    })
    expect(media.upload).toHaveBeenCalledWith(imageRow.image_path, expect.objectContaining({ type: 'image/jpeg', size: 3 }), { contentType: 'image/jpeg', upsert: false })
    expect(queries.send).toHaveBeenCalledWith('conversation-1', 'message-1', '', expect.objectContaining({ path: imageRow.image_path }))
  })

  it('keeps an idempotent retry when the photo already exists', async () => {
    media.upload.mockResolvedValue({ data: null, error: { message: 'The resource already exists' } })
    queries.send.mockResolvedValue({ data: [imageRow], error: null })
    await expect(chatRepository.send('conversation-1', 'message-1', '', image)).resolves.toMatchObject({ id: 'message-1' })
  })

  it('does not send metadata when the private upload fails', async () => {
    media.upload.mockResolvedValue({ data: null, error: { code: 'network_unavailable', message: 'network failed' } })
    await expect(chatRepository.send('conversation-1', 'message-1', '', image)).rejects.toThrow('Проверьте интернет')
    expect(queries.send).not.toHaveBeenCalled()
  })

  it('keeps history readable when a signed link cannot be created', async () => {
    media.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'temporarily unavailable' } })
    queries.listMessages.mockResolvedValue({ data: [imageRow, { ...imageRow, id: 'message-0', image_path: null, image_mime_type: null, image_width: null, image_height: null, image_size_bytes: null }], error: null })

    await expect(chatRepository.listMessages('conversation-1')).resolves.toMatchObject({
      messages: [{ id: 'message-0', image: null }, { id: 'message-1', image: { url: null } }], nextCursor: null,
    })
  })
})
