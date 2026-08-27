import type { PilotClientsReader } from '../pilot-clients-reader.js'
import type { PilotConnectionsReader } from '../pilot-connections-reader.js'
import type { PilotTrainingDataReader } from '../pilot-training-data-reader.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'
import {
  type DatabaseReadinessFailureCategory,
  safeDatabaseErrorDiagnostics,
} from './database-readiness.js'

export type RuntimeDomainReadinessCheck =
  | 'clients'
  | 'connections'
  | 'training-data'

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
  trainingDataReader: PilotTrainingDataReader,
  sessionToken: string,
): Promise<RuntimeDomainReadinessResult> {
  const clients = await inspectReadModel(
    'clients',
    () => clientsReader.readClients(sessionToken),
  )
  if (!clients.ready) return clients

  const connections = await inspectReadModel(
    'connections',
    () => connectionsReader.readConnections(sessionToken),
  )
  if (!connections.ready) return connections

  return inspectReadModel(
    'training-data',
    () => trainingDataReader.readTrainingData(sessionToken),
  )
}
