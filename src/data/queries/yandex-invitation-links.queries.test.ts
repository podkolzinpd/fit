import { afterEach, describe, expect, it, vi } from 'vitest'
import { yandexInvitationLinkQueries } from './yandex-invitation-links.queries'

describe('yandexInvitationLinkQueries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends bearer invitation data only in POST bodies', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await yandexInvitationLinkQueries.preview('https://stage.example.test', 'protected-token')
    await yandexInvitationLinkQueries.claim(
      'https://stage.example.test',
      's'.repeat(43),
      'protected-token',
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://stage.example.test/v1/invitation-links/preview')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'protected-token' }))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://stage.example.test/v1/invitation-links/claim')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('x-fit-session')).toBe('s'.repeat(43))
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ token: 'protected-token' }))
  })
})
