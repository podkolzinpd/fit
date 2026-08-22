import { afterEach, describe, expect, it, vi } from 'vitest'

import { yandexPilotQueries } from './yandex-pilot.queries'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('yandexPilotQueries', () => {
  it('sends the Fit pilot session outside the Yandex IAM Authorization header', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await yandexPilotQueries.listClients(
      'https://stage.example.test',
      's'.repeat(43),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://stage.example.test/v1/clients',
      {
        cache: 'no-store',
        headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      },
    )
    const requestInit = fetchMock.mock.calls[0]?.[1]
    expect(requestInit?.headers).not.toHaveProperty('authorization')

    await yandexPilotQueries.listConnections(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://stage.example.test/v1/connections',
      {
        cache: 'no-store',
        headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      },
    )
  })
})
