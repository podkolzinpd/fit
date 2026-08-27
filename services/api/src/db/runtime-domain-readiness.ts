import type { PilotClientsReader } from '../pilot-clients-reader.js'
import type { PilotConnectionsReader } from '../pilot-connections-reader.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'
import {
  type DatabaseReadinessFailureCategory,
  safeDatabaseErrorDiagnostics,
} from './database-readiness.js'

export type RuntimeDomainReadinessCheck = 'clients' | 'connections'

export type RuntimeDomainReadinessResult =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false
      check: RuntimeDomainReadinessCheck
      category: DatabaseReadinessFailureCategory
      code: string
    }>

async function inspectReadModel(
  check: RuntimeDomainReadinessCheck,
  read: () => Promise<unknown>,
): Promise<RuntimeDomainReadinessResult> {
  try {
    await read()
    return { ready: true }
  } catch (error) {
    if (error instanceof PilotSessionInvalidError) {
      return {
        ready: false,
        check,
        category: 'authentication',
        code: 'PILOT_SESSION_INVALID',
      }
    }
    return {
      ready: false,
      check,
      ...safeDatabaseErrorDiagnostics(error),
    }
  }
}

export async function inspectRuntimeDomainReadiness(
  clientsReader: PilotClientsReader,
  connectionsReader: PilotConnectionsReader,
  sessionToken: string,
): Promise<RuntimeDomainReadinessResult> {
  const clients = await inspectReadModel(
    'clients',
    () => clientsReader.readClients(sessionToken),
  )
  if (!clients.ready) return clients

  return inspectReadModel(
    'connections',
    () => connectionsReader.readConnections(sessionToken),
  )
}
