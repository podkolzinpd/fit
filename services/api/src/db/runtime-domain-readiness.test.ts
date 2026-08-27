import { describe, expect, it, vi } from 'vitest'

import type { PilotClientsReader } from '../pilot-clients-reader.js'
import type { PilotConnectionsReader } from '../pilot-connections-reader.js'
import type { PilotTrainingDataReader } from '../pilot-training-data-reader.js'
import type { PilotProgressData } from '../progress-data.js'
import { inspectRuntimeDomainReadiness } from './runtime-domain-readiness.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'

const SESSION_TOKEN = 's'.repeat(43)
const CLIENT_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_CLIENT_ID = '10000000-0000-4000-8000-000000000002'

function buildClientsReader(error?: Error): {
  reader: PilotClientsReader
  readClients: ReturnType<typeof vi.fn>
} {
  const readClients = error === undefined
    ? vi.fn().mockResolvedValue({
        accessMode: 'read_only',
        clients: [{ id: CLIENT_ID }],
      })
    : vi.fn().mockRejectedValue(error)
  return { reader: { readClients }, readClients }
}

function buildProgressData(error?: Error): {
  data: Pick<PilotProgressData, 'readBundle'>
  readBundle: ReturnType<typeof vi.fn>
} {
  const readBundle = error === undefined
    ? vi.fn().mockResolvedValue({ entries: [], customMetrics: [], goal: null })
    : vi.fn().mockRejectedValue(error)
  return { data: { readBundle }, readBundle }
}

function buildConnectionsReader(error?: Error): {
  reader: PilotConnectionsReader
  readConnections: ReturnType<typeof vi.fn>
} {
  const readConnections = error === undefined
    ? vi.fn().mockResolvedValue({
        accessMode: 'read_only',
        memberships: [],
        invitations: [],
      })
    : vi.fn().mockRejectedValue(error)
  return { reader: { readConnections }, readConnections }
}

function buildTrainingDataReader(error?: Error): {
  reader: PilotTrainingDataReader
  readTrainingData: ReturnType<typeof vi.fn>
} {
  const readTrainingData = error === undefined
    ? vi.fn().mockResolvedValue({
        accessMode: 'read_only',
        customExercises: [],
        workouts: [],
        attention: [],
        attentionPreferences: [],
      })
    : vi.fn().mockRejectedValue(error)
  return { reader: { readTrainingData }, readTrainingData }
}

describe('runtime domain readiness', () => {
  it('executes all public read models with the exact stage session token', async () => {
    const clients = buildClientsReader()
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: true,
      progressResponseBytes: Buffer.byteLength(JSON.stringify({
        entries: [],
        customMetrics: [],
        goal: null,
      })),
    })
    expect(clients.readClients).toHaveBeenCalledWith(SESSION_TOKEN)
    expect(connections.readConnections).toHaveBeenCalledWith(SESSION_TOKEN)
    expect(trainingData.readTrainingData).toHaveBeenCalledWith(SESSION_TOKEN)
    expect(progress.readBundle).toHaveBeenCalledWith(SESSION_TOKEN, CLIENT_ID)
  })

  it('returns a safe SQL code from session resolution or the clients query', async () => {
    const privateError = Object.assign(
      new Error('private relation and connection details'),
      { code: '42501' },
    )
    const clients = buildClientsReader(privateError)
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'permission',
      code: '42501',
    })
    expect(connections.readConnections).not.toHaveBeenCalled()
    expect(trainingData.readTrainingData).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private relation')
  })

  it('does not substitute another accessible client for the exact fixture client', async () => {
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()
    const clients: PilotClientsReader = {
      readClients: vi.fn().mockResolvedValue({
        accessMode: 'read_only',
        clients: [{ id: OTHER_CLIENT_ID }],
      }),
    }

    const result = await inspectRuntimeDomainReadiness(
      clients,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'unknown',
      code: 'FIXTURE_CLIENT_NOT_ACCESSIBLE',
    })
    expect(connections.readConnections).not.toHaveBeenCalled()
    expect(trainingData.readTrainingData).not.toHaveBeenCalled()
    expect(progress.readBundle).not.toHaveBeenCalled()
  })

  it('identifies the connections read model without exposing its failure', async () => {
    const privateError = Object.assign(
      new Error('private invitations and membership data'),
      { code: '42501' },
    )
    const clients = buildClientsReader()
    const connections = buildConnectionsReader(privateError)
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'connections',
      category: 'permission',
      code: '42501',
    })
    expect(JSON.stringify(result)).not.toContain('private invitations')
    expect(trainingData.readTrainingData).not.toHaveBeenCalled()
  })

  it('identifies the training data read model without exposing its failure', async () => {
    const privateError = Object.assign(
      new Error('private workout and exercise data'),
      { code: '42501' },
    )
    const clients = buildClientsReader()
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader(privateError)
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'training-data',
      category: 'permission',
      code: '42501',
    })
    expect(JSON.stringify(result)).not.toContain('private workout')
    expect(progress.readBundle).not.toHaveBeenCalled()
  })

  it('identifies the exact progress bundle failure before deployment', async () => {
    const privateError = Object.assign(
      new Error('private progress data'),
      { code: '42501' },
    )
    const clients = buildClientsReader()
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData(privateError)

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'progress',
      category: 'permission',
      code: '42501',
    })
    expect(progress.readBundle).toHaveBeenCalledWith(SESSION_TOKEN, CLIENT_ID)
    expect(JSON.stringify(result)).not.toContain('private progress')
  })

  it('identifies a rejected fixture session without exposing the token', async () => {
    const clients = buildClientsReader(new PilotSessionInvalidError())
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'authentication',
      code: 'PILOT_SESSION_INVALID',
    })
    expect(JSON.stringify(result)).not.toContain(SESSION_TOKEN)
  })

  it('normalizes application failures without exposing their message', async () => {
    const clients = buildClientsReader(new TypeError('private row value'))
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const progress = buildProgressData()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      progress.data,
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'unknown',
      code: 'unknown',
    })
    expect(JSON.stringify(result)).not.toContain('private row value')
  })

  it('rejects a progress response that cannot be serialized before deployment', async () => {
    const clients = buildClientsReader()
    const connections = buildConnectionsReader()
    const trainingData = buildTrainingDataReader()
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const readBundle = vi.fn().mockResolvedValue(cyclic)

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      trainingData.reader,
      { readBundle },
      SESSION_TOKEN,
      CLIENT_ID,
    )

    expect(result).toEqual({
      ready: false,
      check: 'progress',
      category: 'unknown',
      code: 'PROGRESS_RESPONSE_NOT_SERIALIZABLE',
    })
  })
})
