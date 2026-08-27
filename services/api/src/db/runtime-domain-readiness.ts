import type { PilotClientsReader } from '../pilot-clients-reader.js'
import type { PilotConnectionsReader } from '../pilot-connections-reader.js'
import type { PilotTrainingDataReader } from '../pilot-training-data-reader.js'
import type { PilotProgressData } from '../progress-data.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'
import {
  type DatabaseReadinessFailureCategory,
  safeDatabaseErrorDiagnostics,
} from './database-readiness.js'

export type RuntimeDomainReadinessCheck =
  | 'clients'
  | 'connections'
  | 'training-data'
  | 'progress'

export type RuntimeDomainReadinessResult =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false
      check: RuntimeDomainReadinessCheck
      category: DatabaseReadinessFailureCategory
      code: string
    }>

type ReadModelResult<Result> =
  | Readonly<{ ready: true; value: Result }>
  | Exclude<RuntimeDomainReadinessResult, Readonly<{ ready: true }>>

async function inspectReadModel<Result>(
  check: RuntimeDomainReadinessCheck,
  read: () => Promise<Result>,
): Promise<ReadModelResult<Result>> {
  try {
    return { ready: true, value: await read() }
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
  progressData: Pick<PilotProgressData, 'readBundle'>,
  sessionToken: string,
): Promise<RuntimeDomainReadinessResult> {
  const clients = await inspectReadModel(
    'clients',
    () => clientsReader.readClients(sessionToken),
  )
  if (!clients.ready) return clients
  const clientId = clients.value.clients[0]?.id
  if (clientId === undefined) {
    return {
      ready: false,
      check: 'clients',
      category: 'unknown',
      code: 'NO_ACCESSIBLE_CLIENT',
    }
  }

  const connections = await inspectReadModel(
    'connections',
    () => connectionsReader.readConnections(sessionToken),
  )
  if (!connections.ready) return connections

  const trainingData = await inspectReadModel(
    'training-data',
    () => trainingDataReader.readTrainingData(sessionToken),
  )
  if (!trainingData.ready) return trainingData

  const progress = await inspectReadModel(
    'progress',
    () => progressData.readBundle(sessionToken, clientId),
  )
  return progress.ready ? { ready: true } : progress
}
