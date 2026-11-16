import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantBackend, AssistantConversation, AssistantDataRepository, AssistantMessage, AssistantRepositoryResult } from '../../data/assistant-contract'
import type { SessionActor } from '../../shared/domain'
import { AssistantHistoryPage } from './AssistantHistoryPage'

const auth = vi.hoisted(() => ({ actor: null as SessionActor | null }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => auth }))
// Voice is idle throughout these repository recovery checks. Its transitions
// are covered by the native route tests; no media transport is opened here.
vi.mock('../voice-input', () => ({ VoiceInputButton: () => null }))

const conversationId = '57000000-0000-4000-8000-000000000001'
const nextConversationId = '57000000-0000-4000-8000-000000000002'
const greeting = 'Сохранённая беседа. Здесь можно обсудить тренировку и восстановление.'
const recoveredActionName = 'Сохранённое действие восстановлено'
const success = <T,>(data: T): AssistantRepositoryResult<T> => ({ data, error: null })
const unavailable = <T,>(): AssistantRepositoryResult<T> => ({ data: null, error: new Error('unavailable') })
const conversation = (id = conversationId): AssistantConversation => ({ id, title: 'Сегодня', created_at: new Date().toISOString() })
const message = (id: string, content: string, conversation = conversationId): AssistantMessage => ({ id, conversation_id: conversation, turn_id: null, author: 'assistant', content, action: null, created_at: new Date().toISOString() })

function actor(role: 'client' | 'trainer', suffix = '1'): SessionActor {
  const common = { userId: `actor-${role}-${suffix}`, role, email: null, firstName: 'Антон', lastName: null, timezone: 'Europe/Moscow', experiments: { trainerScheduleV2: true, assistantFeatureLinks: true } }
  return role === 'client'
    ? { ...common, kind: 'client', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Антон' }
    : { ...common, kind: 'trainer' }
}

function fixture() {
  const messages = [message('greeting', greeting), {
    ...message('saved-action', 'Тренировка сохранена'),
    action: { id: 'action-1', tool: 'record_workout' as const, status: 'proposed' as const, title: 'Тренировка', description: 'Тренировка сохранена', payload: { clientName: recoveredActionName } },
  }]
  const actions = [{ id: 'action-1', conversation_id: conversationId, assistant_message_id: 'saved-action', status: 'applied', version: 2, result: null }]
  const assistant = {
    isAvailable: () => true,
    listConversations: vi.fn<AssistantDataRepository['listConversations']>().mockResolvedValue(success([conversation()])),
    createConversation: vi.fn<AssistantDataRepository['createConversation']>().mockResolvedValue(success(conversation())),
    listMessages: vi.fn<AssistantDataRepository['listMessages']>().mockResolvedValue(success(messages)),
    listActions: vi.fn<AssistantDataRepository['listActions']>().mockResolvedValue(success(actions)),
    sendTurn: vi.fn<AssistantDataRepository['sendTurn']>().mockResolvedValue({ reply: 'Ответ сохранён', action: null }),
    applyAction: vi.fn<AssistantDataRepository['applyAction']>().mockResolvedValue(success({})),
    completeSummary: vi.fn<AssistantDataRepository['completeSummary']>().mockResolvedValue(success({})),
    cancelAction: vi.fn<AssistantDataRepository['cancelAction']>().mockResolvedValue(success({})),
  }
  const backend: AssistantBackend = {
    cacheKey: 'yandex', assistant, systemExercises: [],
    listCustomExercises: () => Promise.resolve([]), parseWorkout: () => Promise.resolve({ items: [], unmatched: [] }),
    listTrainingSummaries: () => Promise.resolve([]), generateTrainingSummary: () => Promise.resolve({ generatedAt: new Date().toISOString(), cached: false }),
    publishTrainingSummary: () => Promise.resolve(),
  }
  return { assistant, backend, messages }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
const matchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')

beforeEach(() => {
  // Act flushes passive updates synchronously and hides the production race
  // between clearing and restoring the same ID. Use the real React scheduler
  // and native DOM clicks, observing eventual output without advancing timers.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  queryClient = new QueryClient()
})

afterEach(() => {
  root.unmount()
  queryClient.clear()
  container.remove()
  if (matchMedia) Object.defineProperty(window, 'matchMedia', matchMedia)
  else Reflect.deleteProperty(window, 'matchMedia')
  vi.unstubAllGlobals()
})

function mount(backend: AssistantBackend) {
  root.render(<QueryClientProvider client={queryClient}><MemoryRouter><AssistantHistoryPage backend={backend} /></MemoryRouter></QueryClientProvider>)
}

async function expectMessage(text: string) {
  await expect.poll(() => within(container).queryByText(text, { exact: true })).not.toBeNull()
}

describe.each(['client', 'trainer'] as const)('Assistant message recovery for %s', (role) => {
  it.each(['messages', 'actions'] as const)('reloads the same session after a fast %s retry and restores its durable actions', async (failedRequest) => {
    auth.actor = actor(role)
    const { backend, assistant } = fixture()
    if (failedRequest === 'messages') assistant.listMessages.mockResolvedValueOnce(unavailable())
    else assistant.listActions.mockResolvedValueOnce(unavailable())
    mount(backend)
    await expectMessage('Не удалось загрузить сообщения. Попробуйте ещё раз.')
    expect(assistant.listMessages).toHaveBeenCalledExactlyOnceWith(conversationId)
    expect(assistant.listActions).toHaveBeenCalledExactlyOnceWith(conversationId)

    within(container).getByRole('button', { name: 'Повторить' }).click()

    await expectMessage(greeting)
    await expectMessage(recoveredActionName)
    expect(within(container).getByRole('status')).toHaveTextContent('Тренировка сохранена')
    expect(within(container).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(container).getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeEnabled()
    expect(assistant.listMessages.mock.calls).toEqual([[conversationId], [conversationId]])
    expect(assistant.listActions.mock.calls).toEqual([[conversationId], [conversationId]])
    expect(assistant.listConversations).toHaveBeenCalledTimes(2)
    expect(assistant.createConversation).not.toHaveBeenCalled()
  })

  it('does not accept a cancelled session list after the actor changes', async () => {
    auth.actor = actor(role)
    const { backend, assistant } = fixture()
    const oldList = deferred<AssistantRepositoryResult<AssistantConversation[]>>()
    assistant.listConversations.mockReturnValueOnce(oldList.promise).mockResolvedValue(success([conversation(nextConversationId)]))
    assistant.listMessages.mockResolvedValue(success([message('new-actor', 'Беседа новой учётки', nextConversationId)]))
    assistant.listActions.mockResolvedValue(success([]))
    mount(backend)
    await expect.poll(() => assistant.listConversations.mock.calls.length).toBe(1)
    auth.actor = actor(role, '2')
    mount(backend)
    await expectMessage('Беседа новой учётки')
    oldList.resolve(success([conversation()]))
    // Let the old Promise continuation run; it must neither select its session
    // nor bump the accepted-session revision and issue another messages read.
    await oldList.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(assistant.listMessages.mock.calls).toEqual([[nextConversationId]])
    expect(assistant.listActions.mock.calls).toEqual([[nextConversationId]])
    expect(within(container).getByText('Беседа новой учётки')).toBeVisible()
    expect(within(container).queryByText(greeting)).not.toBeInTheDocument()
  })

  it('ignores old message results arriving after a new actor session has loaded', async () => {
    auth.actor = actor(role)
    const { backend, assistant, messages } = fixture()
    const oldMessages = deferred<AssistantRepositoryResult<AssistantMessage[]>>()
    assistant.listConversations.mockResolvedValueOnce(success([conversation()])).mockResolvedValue(success([conversation(nextConversationId)]))
    assistant.listMessages.mockReturnValueOnce(oldMessages.promise).mockResolvedValue(success([message('new-actor', 'Новая беседа готова', nextConversationId)]))
    assistant.listActions.mockResolvedValue(success([]))
    mount(backend)
    await expect.poll(() => assistant.listMessages.mock.calls.length).toBe(1)
    auth.actor = actor(role, '2')
    mount(backend)
    await expectMessage('Новая беседа готова')
    oldMessages.resolve(success(messages))
    await oldMessages.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(within(container).getByText('Новая беседа готова')).toBeVisible()
    expect(within(container).queryByText(greeting)).not.toBeInTheDocument()
    expect(within(container).queryByText(recoveredActionName)).not.toBeInTheDocument()
    expect(within(container).queryByRole('alert')).not.toBeInTheDocument()
    expect(assistant.listMessages.mock.calls).toEqual([[conversationId], [nextConversationId]])
  })

  it('retries a failed send with its original turn ID and one user message', async () => {
    auth.actor = actor(role)
    const { backend, assistant } = fixture()
    assistant.sendTurn.mockRejectedValueOnce(new Error('unavailable'))
    mount(backend)
    await expectMessage(greeting)
    const input = within(container).getByRole('textbox', { name: 'Сообщение ассистенту' })
    await userEvent.type(input, 'Помоги с тренировкой')
    within(container).getByRole('button', { name: 'Отправить сообщение' }).click()
    await expectMessage('Не удалось получить ответ ассистента. Попробуйте ещё раз.')
    const firstTurn = assistant.sendTurn.mock.calls[0]!
    expect(firstTurn).toEqual([conversationId, expect.any(String), 'Помоги с тренировкой'])
    expect(firstTurn[1]).not.toBe('')
    within(container).getByRole('button', { name: 'Повторить' }).click()
    await expectMessage('Ответ сохранён')
    expect(assistant.sendTurn.mock.calls).toEqual([firstTurn, firstTurn])
    expect(container.querySelectorAll('.assistant-message-user')).toHaveLength(1)
    expect(assistant.listConversations).toHaveBeenCalledTimes(1)
    expect(assistant.listMessages).toHaveBeenCalledTimes(1)
  })
})
