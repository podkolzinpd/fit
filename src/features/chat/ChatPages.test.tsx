import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ChatMessage, ChatMessagePage, ChatThread } from '../../shared/domain'

type MockChat = {
  listThreads: ReturnType<typeof vi.fn<() => Promise<ChatThread[]>>>
  open: ReturnType<typeof vi.fn<(clientId: string, trainerId: string) => Promise<string>>>
  listMessages: ReturnType<typeof vi.fn<(conversationId: string, cursor?: { createdAt: string; id: string } | null) => Promise<ChatMessagePage>>>
  send: ReturnType<typeof vi.fn<(conversationId: string, messageId: string, body: string, image?: import('../../shared/domain').ChatImageDraft | null, replyToMessageId?: string | null) => Promise<ChatMessage>>>
  edit: ReturnType<typeof vi.fn<(conversationId: string, messageId: string, body: string) => Promise<ChatMessage>>>
  remove: ReturnType<typeof vi.fn<(conversationId: string, messageId: string) => Promise<void>>>
  unreadState: ReturnType<typeof vi.fn<(conversationId: string) => Promise<import('../../shared/domain').ChatUnreadState>>>
  markRead: ReturnType<typeof vi.fn<(conversationId: string, throughCreatedAt: string) => Promise<void>>>
  search: ReturnType<typeof vi.fn<(conversationId: string, query: string) => Promise<ChatMessage[]>>>
  window: ReturnType<typeof vi.fn<(conversationId: string, messageId: string) => Promise<ChatMessage[]>>>
  subscribe: ReturnType<typeof vi.fn<(conversationId: string, onChange: () => void) => () => void>>
}
type MockActor = { kind: 'client' | 'trainer'; role: 'client' | 'trainer'; userId: string; email: string; firstName: string; lastName: null; timezone: string; clientId: string; trainerId: string; fullName: string }
const backend = vi.hoisted(() => vi.fn<() => { chat: MockChat }>())
const auth = vi.hoisted(() => vi.fn<() => { actor: MockActor | null }>())
const prepareChatImage = vi.hoisted(() => vi.fn())
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => backend() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => auth() }))
vi.mock('./chat-image', () => ({ prepareChatImage }))

import { ChatConversationPage, ChatListPage } from './ChatPages'
import { ChatHeaderAction, ChatStartButton } from './ChatEntry'

const actor: MockActor = { kind: 'client', role: 'client', userId: 'client-user', email: 'client@example.test', firstName: 'Иван', lastName: null, timezone: 'Europe/Moscow', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Иван' }
const thread: ChatThread = { conversationId: 'conversation-1', clientId: 'client-1', trainerId: 'trainer-1', partnerUserId: 'trainer-1', partnerName: 'Анна', activeConnection: true, lastMessageBody: 'До встречи', lastMessageAt: '2026-09-10T12:00:00.000Z', lastMessageSenderId: 'trainer-1', unreadCount: 2, canMessage: true, blockedByMe: false, blockedByPartner: false }
const incoming: ChatMessage = { id: 'message-1', conversationId: 'conversation-1', senderId: 'trainer-1', body: 'До встречи', image: null, createdAt: '2026-09-10T12:00:00.000Z', editedAt: null, replyTo: null }

function chatBackend(): MockChat {
  return {
    listThreads: vi.fn<() => Promise<ChatThread[]>>().mockResolvedValue([thread]),
    open: vi.fn<(clientId: string, trainerId: string) => Promise<string>>().mockResolvedValue('conversation-1'),
    listMessages: vi.fn<(conversationId: string, cursor?: { createdAt: string; id: string } | null) => Promise<ChatMessagePage>>().mockResolvedValue({ messages: [incoming], nextCursor: null }),
    send: vi.fn<(conversationId: string, messageId: string, body: string, image?: import('../../shared/domain').ChatImageDraft | null, replyToMessageId?: string | null) => Promise<ChatMessage>>().mockImplementation((_conversationId, messageId, body, image) => Promise.resolve({ ...incoming, id: messageId, senderId: actor.userId, body, image: image ? { url: image.dataUrl, mimeType: image.mimeType, width: image.width, height: image.height, sizeBytes: image.sizeBytes } : null })),
    edit: vi.fn<(conversationId: string, messageId: string, body: string) => Promise<ChatMessage>>().mockImplementation((_conversationId, messageId, body) => Promise.resolve({ ...incoming, id: messageId, senderId: actor.userId, body, editedAt: '2026-09-11T10:00:00.000Z' })),
    remove: vi.fn<(conversationId: string, messageId: string) => Promise<void>>().mockResolvedValue(undefined),
    unreadState: vi.fn<(conversationId: string) => Promise<import('../../shared/domain').ChatUnreadState>>().mockResolvedValue({ firstMessageId: 'message-1', firstCreatedAt: incoming.createdAt, unreadCount: 1 }),
    markRead: vi.fn<(conversationId: string, throughCreatedAt: string) => Promise<void>>().mockResolvedValue(undefined),
    search: vi.fn<(conversationId: string, query: string) => Promise<ChatMessage[]>>().mockResolvedValue([]),
    window: vi.fn<(conversationId: string, messageId: string) => Promise<ChatMessage[]>>().mockResolvedValue([incoming]),
    subscribe: vi.fn<(conversationId: string, onChange: () => void) => () => void>().mockReturnValue(() => undefined),
  }
}

function Location() {
  return <output aria-label="route">{useLocation().pathname}</output>
}

function renderAt(path: string | Array<string | { pathname: string; state?: unknown }>, chat = chatBackend()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  backend.mockReturnValue({ chat })
  const initialEntries = Array.isArray(path) ? path : [path]
  const view = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}><Routes>
    <Route path="/chat" element={<><ChatListPage /><Location /></>} />
    <Route path="/chat/:conversationId" element={<><ChatConversationPage /><Location /></>} />
    <Route path="*" element={<Location />} />
  </Routes></MemoryRouter></QueryClientProvider>)
  return { ...view, chat, queryClient }
}

describe('reliable chat screens', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    backend.mockReset()
    auth.mockReset()
    prepareChatImage.mockReset()
    prepareChatImage.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 1200, height: 900, sizeBytes: 3 })
    auth.mockReturnValue({ actor })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shows unread and disconnected state, then opens an existing dialog', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([{ ...thread, activeConnection: false }])
    renderAt('/chat', chat)

    expect(await screen.findByText('Анна')).toBeVisible()
    expect(screen.getByText('Связь отключена')).toBeVisible()
    expect(screen.getByText('2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Анна/ }))
    expect(screen.getByLabelText('route')).toHaveTextContent('/chat/conversation-1')
    expect(chat.open).not.toHaveBeenCalled()
  })

  it('lets a trainer leave a dialog and the message list without a history loop', async () => {
    const user = userEvent.setup()
    auth.mockReturnValue({ actor: { ...actor, kind: 'trainer', role: 'trainer' } })
    renderAt(['/today', '/chat', { pathname: '/chat/conversation-1', state: { chatBack: 'history' } }])

    await user.click(await screen.findByRole('button', { name: 'Назад' }))
    expect(screen.getByLabelText('route')).toHaveTextContent('/chat')
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByLabelText('route')).toHaveTextContent('/today')
  })

  it('supports an edge swipe back and ignores a vertical edge gesture', () => {
    auth.mockReturnValue({ actor: { ...actor, kind: 'trainer', role: 'trainer' } })
    const view = renderAt('/chat')
    const page = view.container.querySelector('main')!

    fireEvent.touchStart(page, { changedTouches: [{ clientX: 12, clientY: 100 }] })
    fireEvent.touchEnd(page, { changedTouches: [{ clientX: 40, clientY: 190 }] })
    expect(screen.getByLabelText('route')).toHaveTextContent('/chat')

    fireEvent.touchStart(page, { changedTouches: [{ clientX: 12, clientY: 100 }] })
    fireEvent.touchEnd(page, { changedTouches: [{ clientX: 100, clientY: 108 }] })
    expect(screen.getByLabelText('route')).toHaveTextContent('/today')
  })

  it('creates a dialog for a connected person when it has no history', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([{ ...thread, conversationId: null, lastMessageBody: null, unreadCount: 0 }])
    renderAt('/chat', chat)

    await user.click(await screen.findByRole('button', { name: /Анна/ }))
    await waitFor(() => expect(chat.open).toHaveBeenCalledWith('client-1', 'trainer-1'))
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/chat/conversation-1'))
  })

  it('shows a clear empty state when there are no available dialogs', async () => {
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([])
    renderAt('/chat', chat)

    expect(await screen.findByText('Диалогов пока нет')).toBeVisible()
    expect(screen.getByText('Подключите тренера или спортсмена, чтобы начать переписку.')).toBeVisible()
  })

  it('keeps a failed message, retries with the same id and clears the draft', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    chat.send.mockRejectedValueOnce(new Error('offline'))
    renderAt('/chat/conversation-1', chat)

    expect(await screen.findByText('До встречи')).toBeVisible()
    const input = screen.getByRole('textbox', { name: 'Сообщение' })
    await user.type(input, 'Привет')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(await screen.findByText('Ошибка')).toBeVisible()
    const firstId = chat.send.mock.calls[0]?.[1]
    expect(firstId).toBeTruthy()
    expect(input).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(2))
    expect(chat.send.mock.calls[1]?.[1]).toBe(firstId)
    await waitFor(() => expect(screen.queryByText('Ошибка')).not.toBeInTheDocument())
  })

  it('attaches and sends a photo without requiring a caption', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    renderAt('/chat/conversation-1', chat)

    await screen.findByText('До встречи')
    const file = new File(['photo'], 'progress.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Выбрать фото'), file)
    expect(await screen.findByAltText('Фото для отправки')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => expect(chat.send).toHaveBeenCalledWith('conversation-1', expect.any(String), '', expect.objectContaining({ mimeType: 'image/jpeg', width: 1200, height: 900 }), undefined))
    expect(screen.queryByAltText('Фото для отправки')).not.toBeInTheDocument()
  })

  it('shows delivered and unavailable photos in message history', async () => {
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [
      { ...incoming, id: 'photo-ready', body: '', image: { url: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 } },
      { ...incoming, id: 'photo-missing', body: '', image: { url: null, mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 } },
    ], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    expect(await screen.findByAltText('Фото в сообщении')).toBeVisible()
    expect(screen.getByText('Фото недоступно')).toBeVisible()
  })

  it('lets the user remove a selected photo and reports preparation errors', async () => {
    const user = userEvent.setup()
    renderAt('/chat/conversation-1')
    await screen.findByText('До встречи')
    const input = screen.getByLabelText('Выбрать фото')
    await user.upload(input, new File(['photo'], 'progress.png', { type: 'image/png' }))
    await user.click(await screen.findByRole('button', { name: 'Убрать фото' }))
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()

    prepareChatImage.mockRejectedValueOnce(new Error('Фото слишком большое'))
    await user.upload(input, new File(['large'], 'large.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Фото слишком большое')
  })

  it('restores a saved draft, loads older history and refreshes on return', async () => {
    const user = userEvent.setup()
    localStorage.setItem('fit:chat-draft:client-user:conversation-1', 'Сохранённый текст')
    const chat = chatBackend()
    const old: ChatMessage = { ...incoming, id: 'message-old', body: 'Старое сообщение', createdAt: '2026-09-09T12:00:00.000Z' }
    chat.listMessages
      .mockResolvedValueOnce({ messages: [incoming], nextCursor: { createdAt: incoming.createdAt, id: incoming.id } })
      .mockResolvedValueOnce({ messages: [old], nextCursor: null })
      .mockResolvedValue({ messages: [incoming], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    expect(await screen.findByRole('textbox', { name: 'Сообщение' })).toHaveValue('Сохранённый текст')
    await user.click(screen.getByRole('button', { name: 'Ранее' }))
    expect(await screen.findByText('Старое сообщение')).toBeVisible()
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(chat.listMessages.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(chat.subscribe).toHaveBeenCalledWith('conversation-1', expect.any(Function))
  })

  it('ignores a damaged local queue and shows the first-message state', async () => {
    localStorage.setItem('fit:chat-pending:client-user:conversation-1', '{bad json')
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([])
    chat.listMessages.mockResolvedValue({ messages: [], nextCursor: null })
    chat.unreadState.mockResolvedValue({ firstMessageId: null, firstCreatedAt: null, unreadCount: 0 })
    chat.window.mockResolvedValue([])
    renderAt('/chat/conversation-1', chat)

    expect(await screen.findByText('Начните диалог')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Диалог' })).toBeVisible()
  })

  it('shows the total unread badge and opens the chat list from the header', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([{ ...thread, unreadCount: 105 }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    backend.mockReturnValue({ chat })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ChatHeaderAction /><Routes>
      <Route path="/chat" element={<Location />} />
    </Routes></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByText('99+')).toBeVisible()
    await user.click(screen.getByRole('link', { name: /непрочитанных: 105/ }))
    expect(screen.getByLabelText('route')).toHaveTextContent('/chat')
  })

  it('shows the quiet header action when every dialog is read', async () => {
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([{ ...thread, unreadCount: 0 }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    backend.mockReturnValue({ chat })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ChatHeaderAction /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('link', { name: 'Сообщения' })).toBeVisible()
    expect(screen.queryByText('99+')).not.toBeInTheDocument()
  })

  it('shows delivered state, keeps a line break and removes a recovered duplicate', async () => {
    const user = userEvent.setup()
    const own: ChatMessage = { ...incoming, id: 'recovered', senderId: actor.userId, body: 'Уже доставлено' }
    localStorage.setItem('fit:chat-pending:client-user:conversation-1', JSON.stringify([{ ...own, state: 'sending' }]))
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([{ ...thread, activeConnection: false }])
    chat.listMessages.mockResolvedValue({ messages: [own], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    expect(await screen.findByText('Отправлено')).toBeVisible()
    expect(screen.getAllByText('Уже доставлено')).toHaveLength(1)
    expect(screen.getByText('Связь отключена')).toBeVisible()
    const input = screen.getByRole('textbox', { name: 'Сообщение' })
    await user.type(input, 'Строка{enter}дальше')
    expect(chat.send).not.toHaveBeenCalled()
    expect(input).toHaveValue('Строка\nдальше')
  })

  it('offers the right menu actions and sends a quoted reply', async () => {
    const user = userEvent.setup()
    const own: ChatMessage = { ...incoming, id: 'message-own', senderId: actor.userId, body: 'Мой текст' }
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [incoming, own], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть действия: До встречи' }))
    const partnerMenu = screen.getByRole('dialog', { name: 'Действия с сообщением' })
    expect(within(partnerMenu).getByRole('button', { name: 'Ответить' })).toBeVisible()
    expect(within(partnerMenu).getByRole('button', { name: 'Скопировать' })).toBeVisible()
    expect(within(partnerMenu).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
    expect(within(partnerMenu).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    await user.click(within(partnerMenu).getByRole('button', { name: 'Ответить' }))
    expect(await screen.findByText('Ответ')).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Принято')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(chat.send).toHaveBeenCalledWith('conversation-1', expect.any(String), 'Принято', null, incoming.id))
  })

  it('edits an own delivered message and labels edited history', async () => {
    const user = userEvent.setup()
    const own: ChatMessage = { ...incoming, id: 'message-own', senderId: actor.userId, body: 'Старый текст' }
    const edited = { ...own, body: 'Новый текст', editedAt: '2026-09-11T10:00:00.000Z' }
    const chat = chatBackend()
    chat.listMessages.mockResolvedValueOnce({ messages: [own], nextCursor: null }).mockResolvedValue({ messages: [edited], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть действия: Старый текст' }))
    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    const field = await screen.findByRole('textbox', { name: 'Сообщение' })
    await user.clear(field); await user.type(field, 'Новый текст')
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    await waitFor(() => expect(chat.edit).toHaveBeenCalledWith('conversation-1', own.id, 'Новый текст'))
    expect(await screen.findByText('изменено')).toBeVisible()
  })

  it('searches all history and opens the selected result in context', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    const result = { ...incoming, id: 'message-found', body: 'Контроль техники приседа' }
    chat.search.mockResolvedValue([result]); chat.window.mockResolvedValue([result, incoming])
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Поиск по переписке' }))
    await user.type(screen.getByRole('searchbox', { name: 'Текст для поиска' }), 'техники')
    await user.click(screen.getByRole('button', { name: 'Найти' }))
    await waitFor(() => expect(chat.search).toHaveBeenCalledWith('conversation-1', 'техники'))
    await user.click(await screen.findByRole('button', { name: /Контроль техники приседа/ }))
    await waitFor(() => expect(chat.window).toHaveBeenCalledWith('conversation-1', result.id))
    expect(await screen.findByText('Контроль техники приседа')).toBeVisible()
  })

  it('opens a photo fullscreen, zooms it and shares the saved file', async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['photo'], { type: 'image/jpeg' })) }))
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [{ ...incoming, id: 'photo-ready', body: '', image: { url: 'https://media.example/photo.jpg', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 } }], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть фото' }))
    expect(screen.getByRole('dialog', { name: 'Просмотр фото' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(screen.getByText('150%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(share).toHaveBeenCalled())
  })

  it('downloads a photo in a browser and shows a retryable save error', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
    const createObjectURL = vi.fn().mockReturnValue('blob:fit-photo')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const fetchPhoto = vi.fn().mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(['photo'], { type: 'image/jpeg' })) }).mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchPhoto)
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [{ ...incoming, id: 'photo-browser', body: '', image: { url: 'https://media.example/photo.jpg', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 } }], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть фото' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить фото')
  })

  it('supports double tap, pinch and swipe down in the photo viewer', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [{ ...incoming, id: 'photo-gestures', body: '', image: { url: 'https://media.example/photo.jpg', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 } }], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть фото' }))
    const stage = within(screen.getByRole('dialog', { name: 'Просмотр фото' })).getByAltText('Фото в сообщении').parentElement!
    fireEvent.doubleClick(stage)
    expect(screen.getByText('200%')).toBeVisible()
    fireEvent.touchStart(stage, { touches: [{ clientX: 10, clientY: 10 }, { clientX: 30, clientY: 10 }] })
    fireEvent.touchMove(stage, { touches: [{ clientX: 10, clientY: 10 }, { clientX: 50, clientY: 10 }] })
    expect(screen.getByText('300%')).toBeVisible()
    fireEvent.doubleClick(stage)
    expect(screen.getByText('100%')).toBeVisible()
    fireEvent.touchStart(stage, { touches: [{ clientX: 20, clientY: 20 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 25, clientY: 130 }] })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Просмотр фото' })).not.toBeInTheDocument())
  })

  it('shows the first unread boundary and jumps to it', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    renderAt('/chat/conversation-1')
    expect(await screen.findByText('Новые сообщения')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /К новым/ }))
    await waitFor(() => expect(scroll).toHaveBeenCalled())
  })

  it('deletes only an own message after confirmation', async () => {
    const user = userEvent.setup()
    const own: ChatMessage = { ...incoming, id: '10000000-0000-4000-8000-000000000099', senderId: actor.userId, body: 'Удалить меня' }
    const chat = chatBackend()
    chat.listMessages.mockResolvedValue({ messages: [incoming, own], nextCursor: null })
    renderAt('/chat/conversation-1', chat)

    await user.click(await screen.findByRole('button', { name: 'Открыть действия: Удалить меня' }))
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(chat.remove).toHaveBeenCalledWith('conversation-1', own.id))
    expect(screen.queryByText('Удалить меня')).not.toBeInTheDocument()
    expect(screen.getByText('До встречи')).toBeVisible()
  })

  it('opens a contextual chat and reports an opening error', async () => {
    const user = userEvent.setup()
    const chat = chatBackend()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    backend.mockReturnValue({ chat })
    const view = render(<QueryClientProvider client={queryClient}><MemoryRouter><ChatStartButton clientId="client-1" trainerId="trainer-1" /><Routes>
      <Route path="/chat/:conversationId" element={<Location />} />
    </Routes></MemoryRouter></QueryClientProvider>)

    await user.click(screen.getByRole('button', { name: 'Написать' }))
    expect(await screen.findByLabelText('route')).toHaveTextContent('/chat/conversation-1')
    view.unmount()

    const failed = chatBackend()
    failed.open.mockRejectedValue(new Error('offline'))
    const failedClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    backend.mockReturnValue({ chat: failed })
    render(<QueryClientProvider client={failedClient}><MemoryRouter><ChatStartButton clientId="client-1" trainerId="trainer-1" /></MemoryRouter></QueryClientProvider>)
    await user.click(screen.getByRole('button', { name: 'Написать' }))
    expect(await screen.findByText('Не удалось открыть чат')).toBeVisible()
  })
})
