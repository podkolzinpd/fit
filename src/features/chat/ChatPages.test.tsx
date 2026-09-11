import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ChatMessage, ChatMessagePage, ChatThread } from '../../shared/domain'

type MockChat = {
  listThreads: ReturnType<typeof vi.fn<() => Promise<ChatThread[]>>>
  open: ReturnType<typeof vi.fn<(clientId: string, trainerId: string) => Promise<string>>>
  listMessages: ReturnType<typeof vi.fn<(conversationId: string, cursor?: { createdAt: string; id: string } | null) => Promise<ChatMessagePage>>>
  send: ReturnType<typeof vi.fn<(conversationId: string, messageId: string, body: string, image?: import('../../shared/domain').ChatImageDraft | null) => Promise<ChatMessage>>>
  markRead: ReturnType<typeof vi.fn<(conversationId: string) => Promise<void>>>
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
const thread: ChatThread = { conversationId: 'conversation-1', clientId: 'client-1', trainerId: 'trainer-1', partnerUserId: 'trainer-1', partnerName: 'Анна', activeConnection: true, lastMessageBody: 'До встречи', lastMessageAt: '2026-09-10T12:00:00.000Z', lastMessageSenderId: 'trainer-1', unreadCount: 2 }
const incoming: ChatMessage = { id: 'message-1', conversationId: 'conversation-1', senderId: 'trainer-1', body: 'До встречи', image: null, createdAt: '2026-09-10T12:00:00.000Z' }

function chatBackend(): MockChat {
  return {
    listThreads: vi.fn<() => Promise<ChatThread[]>>().mockResolvedValue([thread]),
    open: vi.fn<(clientId: string, trainerId: string) => Promise<string>>().mockResolvedValue('conversation-1'),
    listMessages: vi.fn<(conversationId: string, cursor?: { createdAt: string; id: string } | null) => Promise<ChatMessagePage>>().mockResolvedValue({ messages: [incoming], nextCursor: null }),
    send: vi.fn<(conversationId: string, messageId: string, body: string, image?: import('../../shared/domain').ChatImageDraft | null) => Promise<ChatMessage>>().mockImplementation((_conversationId, messageId, body, image) => Promise.resolve({ ...incoming, id: messageId, senderId: actor.userId, body, image: image ? { url: image.dataUrl, mimeType: image.mimeType, width: image.width, height: image.height, sizeBytes: image.sizeBytes } : null })),
    markRead: vi.fn<(conversationId: string) => Promise<void>>().mockResolvedValue(undefined),
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

    await waitFor(() => expect(chat.send).toHaveBeenCalledWith('conversation-1', expect.any(String), '', expect.objectContaining({ mimeType: 'image/jpeg', width: 1200, height: 900 })))
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
    expect(chat.markRead).toHaveBeenCalledWith('conversation-1')
    expect(chat.subscribe).toHaveBeenCalledWith('conversation-1', expect.any(Function))
  })

  it('ignores a damaged local queue and shows the first-message state', async () => {
    localStorage.setItem('fit:chat-pending:client-user:conversation-1', '{bad json')
    const chat = chatBackend()
    chat.listThreads.mockResolvedValue([])
    chat.listMessages.mockResolvedValue({ messages: [], nextCursor: null })
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
    await user.type(input, 'Строка{shift>}{enter}{/shift}дальше')
    expect(chat.send).not.toHaveBeenCalled()
    expect(input).toHaveValue('Строка\nдальше')
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
