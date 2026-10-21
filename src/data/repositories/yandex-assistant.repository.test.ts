import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createYandexAssistantBackend,
  createYandexAssistantRepository,
} from './yandex-assistant.repository'
import { localDate } from '../../shared/local-date'

const yandexRepository = vi.hoisted(() => ({
  listTrainingData: vi.fn(),
  parseWorkout: vi.fn(),
  listTrainingSummaries: vi.fn(),
  generateTrainingSummary: vi.fn(),
  publishTrainingSummary: vi.fn(),
}))
vi.mock('./yandex-pilot.repository', () => ({
  yandexPilotRepository: yandexRepository,
}))

const API_BASE_URL = 'https://stage.example.test'
const SESSION_TOKEN = 'a'.repeat(43)
const ACTOR_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const CLIENT_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
const SUMMARY_ID = '81a1139a-1011-41be-a906-a9d3f8b70d8c'

describe('Yandex Assistant repository', () => {
  beforeEach(() => {
    yandexRepository.listTrainingData.mockReset().mockResolvedValue({ customExercises: [] })
    yandexRepository.parseWorkout.mockReset().mockResolvedValue({ items: [], unmatched: [] })
    yandexRepository.listTrainingSummaries.mockReset().mockResolvedValue([])
    yandexRepository.generateTrainingSummary.mockReset().mockResolvedValue({
      data: { generated_at: '2026-09-01T09:00:00.000Z' },
      cached: false,
    })
    yandexRepository.publishTrainingSummary.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the Yandex Assistant contract without consulting Supabase', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversations: [{
        id: ACTOR_ID,
        title: 'Сегодня',
        createdAt: '2026-09-01T09:00:00.000Z',
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{
        id: SUMMARY_ID,
        conversationId: ACTOR_ID,
        turnId: null,
        author: 'assistant',
        content: 'Чем помочь?',
        action: null,
        createdAt: '2026-09-01T09:01:00.000Z',
      }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexAssistantRepository(API_BASE_URL, SESSION_TOKEN)

    await expect(repository.listConversations()).resolves.toEqual({
      data: [{ id: ACTOR_ID, title: 'Сегодня', created_at: '2026-09-01T09:00:00.000Z' }],
      error: null,
    })
    await expect(repository.listMessages(ACTOR_ID)).resolves.toEqual({
      data: [{
        id: SUMMARY_ID,
        conversation_id: ACTOR_ID,
        turn_id: null,
        author: 'assistant',
        content: 'Чем помочь?',
        action: null,
        created_at: '2026-09-01T09:01:00.000Z',
      }],
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('creates conversations with server ownership instead of a supplied owner ID', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(String(input).endsWith('/health')
      ? new Response('{}', { headers: { 'x-fit-request-id': 'fixture-health' } })
      : Response.json({ conversation: { id: ACTOR_ID, title: null, createdAt: '2026-09-01T09:00:00.000Z' } }, { headers: { 'x-fit-request-id': 'fixture-create' } })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createYandexAssistantRepository(API_BASE_URL, SESSION_TOKEN).createConversation(CLIENT_ID)
    expect(result.data?.id).toBe(ACTOR_ID)
    const calls = fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/health'))
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe(`${API_BASE_URL}/v1/assistant/conversations`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ title: null }))
    expect(new Headers(init?.headers).get('x-fit-session')).toBe(SESSION_TOKEN)
  })

  it.each([200, 503])('sends the whole turn through native API with HTTP %s and never inserts browser messages', async status => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(String(input).endsWith('/health')
      ? new Response('{}', { headers: { 'x-fit-request-id': 'fixture-health' } })
      : Response.json({ reply: 'Ответ', action: null }, { status, headers: { 'x-fit-request-id': 'fixture-turn' } })))
    vi.stubGlobal('fetch', fetchMock)
    const turn = createYandexAssistantRepository(API_BASE_URL, SESSION_TOKEN).sendTurn(ACTOR_ID, SUMMARY_ID, 'Покажи прогресс')
    if (status === 200) await expect(turn).resolves.toEqual({ reply: 'Ответ', action: null })
    else await expect(turn).rejects.toThrow('Assistant в Yandex Cloud временно недоступен.')
    const calls = fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/health'))
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe(`${API_BASE_URL}/v1/assistant/turn`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ conversation_id: ACTOR_ID, turn_id: SUMMARY_ID, message: 'Покажи прогресс' }))
    expect(new Headers(init?.headers).get('x-fit-session')).toBe(SESSION_TOKEN)
    expect(new Headers(init?.headers).has('x-supabase-authorization')).toBe(false)
  })

  it('returns an explicit Yandex error and never falls back after a failed request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexAssistantRepository(API_BASE_URL, SESSION_TOKEN)

    const result = await repository.listConversations()

    expect(result.data).toBeNull()
    expect(result.error).toEqual(new Error('Assistant в Yandex Cloud временно недоступен.'))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('pins every Assistant dependency to the read-write Yandex app session', async () => {
    const backend = createYandexAssistantBackend(API_BASE_URL, SESSION_TOKEN)
    const summary = {
      id: SUMMARY_ID,
      clientId: CLIENT_ID,
      periodStart: localDate('2026-08-01'),
      periodEnd: localDate('2026-08-31'),
      generatedAt: '2026-09-01T09:00:00.000Z',
      published: false,
      version: 2,
      trainer: {
        headline: 'Прогресс',
        progress: [],
        consistency: 'Регулярно',
        attention: [],
      },
      client: {
        headline: 'Продолжайте',
        achievements: [],
        consistency: 'Регулярно',
        encouragement: 'Хорошая работа',
      },
      metrics: {
        completedWorkouts: 4,
        workoutsPerWeek: 1,
        activeWeeks: 4,
        longestGapDays: 7,
        progressFacts: [],
      },
    }

    await backend.listCustomExercises()
    await backend.parseWorkout('присед 3 по 10', [])
    await backend.generateTrainingSummary(CLIENT_ID, '2026-08-01', '2026-08-31')
    await backend.publishTrainingSummary(summary, summary.client)

    expect(yandexRepository.listTrainingData).toHaveBeenCalledWith(
      API_BASE_URL, SESSION_TOKEN, 'read_write',
    )
    expect(yandexRepository.parseWorkout).toHaveBeenCalledWith(
      API_BASE_URL, SESSION_TOKEN, 'присед 3 по 10', [], 'read_write',
    )
    expect(yandexRepository.generateTrainingSummary).toHaveBeenCalledWith(
      API_BASE_URL,
      SESSION_TOKEN,
      CLIENT_ID,
      '2026-08-01',
      '2026-08-31',
      false,
      'read_write',
    )
    expect(yandexRepository.publishTrainingSummary).toHaveBeenCalledWith(
      API_BASE_URL,
      SESSION_TOKEN,
      SUMMARY_ID,
      expect.objectContaining({ headline: 'Продолжайте' }),
      2,
    )
  })
})
