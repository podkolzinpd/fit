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
  | Readonly<{ ready: true; progressResponseBytes: number }>
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
  clientId: string,
): Promise<RuntimeDomainReadinessResult> {
  const clients = await inspectReadModel(
    'clients',
    () => clientsReader.readClients(sessionToken),
  )
  if (!clients.ready) return clients
  if (!clients.value.clients.some((client) => client.id === clientId)) {
    return {
      ready: false,
      check: 'clients',
      category: 'unknown',
      code: 'FIXTURE_CLIENT_NOT_ACCESSIBLE',
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
  if (!progress.ready) return progress

  try {
    const response = JSON.stringify(progress.value)
    if (response === undefined) {
      return {
        ready: false,
        check: 'progress',
        category: 'unknown',
        code: 'PROGRESS_RESPONSE_NOT_SERIALIZABLE',
      }
    }
    return {
      ready: true,
      progressResponseBytes: Buffer.byteLength(response, 'utf8'),
    }
  } catch {
    return {
      ready: false,
      check: 'progress',
      category: 'unknown',
      code: 'PROGRESS_RESPONSE_NOT_SERIALIZABLE',
    }
  }
}
