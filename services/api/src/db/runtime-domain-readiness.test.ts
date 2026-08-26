import { describe, expect, it, vi } from 'vitest'

import type { PilotClientsReader } from '../pilot-clients-reader.js'
import { inspectRuntimeDomainReadiness } from './runtime-domain-readiness.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'

const SESSION_TOKEN = 's'.repeat(43)

function buildReader(error?: Error): {
  reader: PilotClientsReader
  readClients: ReturnType<typeof vi.fn>
} {
  const readClients = error === undefined
    ? vi.fn().mockResolvedValue({ accessMode: 'read_only', clients: [] })
    : vi.fn().mockRejectedValue(error)
  return { reader: { readClients }, readClients }
}

describe('runtime domain readiness', () => {
  it('executes the clients read model with the exact stage session token', async () => {
    const clients = buildReader()

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({ ready: true })
    expect(clients.readClients).toHaveBeenCalledWith(SESSION_TOKEN)
  })

  it('returns a safe SQL code from session resolution or the clients query', async () => {
    const privateError = Object.assign(
      new Error('private relation and connection details'),
      { code: '42501' },
    )
    const clients = buildReader(privateError)

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      category: 'permission',
      code: '42501',
    })
    expect(JSON.stringify(result)).not.toContain('private relation')
  })

  it('identifies a rejected fixture session without exposing the token', async () => {
    const clients = buildReader(new PilotSessionInvalidError())

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      category: 'authentication',
      code: 'PILOT_SESSION_INVALID',
    })
    expect(JSON.stringify(result)).not.toContain(SESSION_TOKEN)
  })

  it('normalizes application failures without exposing their message', async () => {
    const clients = buildReader(new TypeError('private row value'))

    const result = await inspectRuntimeDomainReadiness(
      clients.reader,
      SESSION_TOKEN,
    )

    expect(result).toEqual({
      ready: false,
      category: 'unknown',
      code: 'unknown',
    })
    expect(JSON.stringify(result)).not.toContain('private row value')
  })
})
