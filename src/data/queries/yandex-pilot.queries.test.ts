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

    await yandexPilotQueries.listTrainingData(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://stage.example.test/v1/training-data',
      {
        cache: 'no-store',
        headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      },
    )

    await yandexPilotQueries.generateTrainingSummary(
      'https://stage.example.test',
      's'.repeat(43),
      '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      '2026-08-01',
      '2026-08-26',
      false,
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://stage.example.test/v1/clients/6e577cc7-3b56-4a86-bc85-1ce2426ce249/training-summaries/generate',
      expect.objectContaining({ method: 'POST' }),
    )
    const summaryRequest = fetchMock.mock.calls.at(-1)?.[1]
    expect(summaryRequest?.headers).toEqual({
      'content-type': 'application/json',
      'x-fit-pilot-session': 's'.repeat(43),
    })
  })

  it('uses explicit JSON and destructive endpoints for connection commands', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const token = 's'.repeat(43)
    const clientId = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
    const trainerId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
    const invitationId = '81a1139a-1011-41be-a906-a9d3f8b70d8c'

    await yandexPilotQueries.createInvitation(
      'https://stage.example.test', token, clientId, 'trainer',
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://stage.example.test/v1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientId, targetRole: 'trainer' }),
      }),
    )

    await yandexPilotQueries.removeTrainer(
      'https://stage.example.test', token, clientId, trainerId,
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://stage.example.test/v1/clients/${clientId}/trainers/${trainerId}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    await yandexPilotQueries.revokeInvitation(
      'https://stage.example.test', token, invitationId,
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://stage.example.test/v1/invitations/${invitationId}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
