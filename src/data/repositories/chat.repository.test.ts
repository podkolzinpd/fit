import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({
  listThreads: vi.fn(), open: vi.fn(), openPublicTrainer: vi.fn(), authorizeSend: vi.fn(), setBlocked: vi.fn(), connectionState: vi.fn(), inviteToConnect: vi.fn(), acceptConnection: vi.fn(), listMessages: vi.fn(), send: vi.fn(), edit: vi.fn(), remove: vi.fn(), unreadState: vi.fn(), markRead: vi.fn(), search: vi.fn(), window: vi.fn(), subscribe: vi.fn(),
}))
const media = vi.hoisted(() => ({ upload: vi.fn(), createSignedUrl: vi.fn(), remove: vi.fn() }))
vi.mock('../queries/chat.queries', () => ({ chatQueries: queries, chatMedia: media }))

import { chatRepository } from './chat.repository'

const imageRow = {
  id: 'message-1', conversation_id: 'conversation-1', sender_id: 'sender-1', body: '', created_at: '2026-09-11T10:00:00.000Z',
  image_path: 'conversation-1/message-1.jpg', image_mime_type: 'image/jpeg', image_width: 1200, image_height: 900, image_size_bytes: 3,
  edited_at: null, reply_to_message_id: null, reply_to_sender_id: null, reply_to_body: null, reply_to_has_image: false, reply_to_deleted: false,
}
const image = { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg' as const, width: 1200, height: 900, sizeBytes: 3 }

describe('chatRepository photo messages', () => {
  beforeEach(() => {
    for (const mock of Object.values(queries)) mock.mockReset()
    queries.authorizeSend.mockResolvedValue({ data: null, error: null })
    media.upload.mockReset().mockResolvedValue({ data: { path: imageRow.image_path }, error: null })
    media.createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://media.example.test/photo' }, error: null })
  })

  it('uploads a private JPEG before sending its metadata and returns a signed image', async () => {
    queries.send.mockResolvedValue({ data: [imageRow], error: null })

    await expect(chatRepository.send('conversation-1', 'message-1', '', image)).resolves.toMatchObject({
      id: 'message-1', body: '', image: { url: 'https://media.example.test/photo', width: 1200, height: 900 },
    })
    expect(media.upload).toHaveBeenCalledWith(imageRow.image_path, expect.objectContaining({ type: 'image/jpeg', size: 3 }), { contentType: 'image/jpeg', upsert: false })
    expect(queries.authorizeSend).toHaveBeenCalledWith('conversation-1')
    expect(queries.send).toHaveBeenCalledWith('conversation-1', 'message-1', '', expect.objectContaining({ path: imageRow.image_path }), undefined)
  })

  it('does not upload a photo when the conversation is blocked', async () => {
    queries.authorizeSend.mockResolvedValue({ data: null, error: { code: 'PT403', message: 'chat_blocked' } })
    await expect(chatRepository.send('conversation-1', 'message-1', '', image)).rejects.toThrow()
    expect(media.upload).not.toHaveBeenCalled()
    expect(queries.send).not.toHaveBeenCalled()
  })

  it('opens a listed trainer and maps blocking state', async () => {
    queries.openPublicTrainer.mockResolvedValue({ data: 'conversation-1', error: null })
    queries.setBlocked.mockResolvedValue({ data: [{ can_message: false, blocked_by_me: true, blocked_by_partner: false }], error: null })
    await expect(chatRepository.openPublicTrainer('public-profile-1')).resolves.toBe('conversation-1')
    await expect(chatRepository.setBlocked('conversation-1', true)).resolves.toEqual({ canMessage: false, blockedByMe: true, blockedByPartner: false })
  })

  it('maps connection invitation state for read, send and accept', async () => {
    const row = { active_connection: false, invitation_pending: true, invited_at: '2026-09-12T10:00:00.000Z', can_invite: false, can_accept: true, trainer_switch_required: false }
    queries.connectionState.mockResolvedValue({ data: [row], error: null })
    queries.inviteToConnect.mockResolvedValue({ data: [{ ...row, can_invite: true, can_accept: false }], error: null })
    queries.acceptConnection.mockResolvedValue({ data: [{ ...row, active_connection: true, invitation_pending: false, can_accept: false }], error: null })

    await expect(chatRepository.connectionState('conversation-1')).resolves.toMatchObject({ invitationPending: true, canAccept: true })
    await expect(chatRepository.inviteToConnect('conversation-1')).resolves.toMatchObject({ invitationPending: true })
    await expect(chatRepository.acceptConnection('conversation-1')).resolves.toMatchObject({ activeConnection: true })
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

  it('maps edit, reply, unread and server search contracts', async () => {
    const replied = { ...imageRow, body: 'Исправлено', edited_at: '2026-09-11T10:05:00.000Z',
      reply_to_message_id: 'message-original', reply_to_sender_id: 'sender-2', reply_to_body: 'Исходный текст', reply_to_has_image: false }
    queries.edit.mockResolvedValue({ data: [replied], error: null })
    queries.unreadState.mockResolvedValue({ data: [{ first_message_id: 'message-original', first_created_at: imageRow.created_at, unread_count: 3 }], error: null })
    queries.search.mockResolvedValue({ data: [replied], error: null })

    await expect(chatRepository.edit('conversation-1', imageRow.id, 'Исправлено')).resolves.toMatchObject({ editedAt: replied.edited_at, replyTo: { messageId: 'message-original', body: 'Исходный текст' } })
    await expect(chatRepository.unreadState('conversation-1')).resolves.toEqual({ firstMessageId: 'message-original', firstCreatedAt: imageRow.created_at, unreadCount: 3 })
    await expect(chatRepository.search('conversation-1', 'исходный')).resolves.toHaveLength(1)
  })
})
