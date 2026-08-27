import { describe, expect, it, vi } from 'vitest'

import type { PilotClientsReader } from '../pilot-clients-reader.js'
import type { PilotConnectionsReader } from '../pilot-connections-reader.js'
import { inspectRuntimeDomainReadiness } from './runtime-domain-readiness.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'

const SESSION_TOKEN = 's'.repeat(43)

function buildClientsReader(error?: Error): {
  reader: PilotClientsReader
  readClients: ReturnType<typeof vi.fn>
} {
  const readClients = error === undefined
    ? vi.fn().mockResolvedValue({ accessMode: 'read_only', clients: [] })
    : vi.fn().mockRejectedValue(error)
  return { reader: { readClients }, readClients }
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

describe('runtime domain readiness', () => {
  it('executes both public read models with the exact stage session token', async () => {
    const clients = buildClientsReader()
    const connections = buildConnectionsReader()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({ ready: true })
    expect(clients.readClients).toHaveBeenCalledWith(SESSION_TOKEN)
    expect(connections.readConnections).toHaveBeenCalledWith(SESSION_TOKEN)
  })

  it('returns a safe SQL code from session resolution or the clients query', async () => {
    const privateError = Object.assign(
      new Error('private relation and connection details'),
      { code: '42501' },
    )
    const clients = buildClientsReader(privateError)
    const connections = buildConnectionsReader()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'permission',
      code: '42501',
    })
    expect(connections.readConnections).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private relation')
  })

  it('identifies the connections read model without exposing its failure', async () => {
    const privateError = Object.assign(
      new Error('private invitations and membership data'),
      { code: '42501' },
    )
    const clients = buildClientsReader()
    const connections = buildConnectionsReader(privateError)

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      check: 'connections',
      category: 'permission',
      code: '42501',
    })
    expect(JSON.stringify(result)).not.toContain('private invitations')
  })

  it('identifies a rejected fixture session without exposing the token', async () => {
    const clients = buildClientsReader(new PilotSessionInvalidError())
    const connections = buildConnectionsReader()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      SESSION_TOKEN,
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

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      connections.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      check: 'clients',
      category: 'unknown',
      code: 'unknown',
    })
    expect(JSON.stringify(result)).not.toContain('private row value')
  })
})
