import type { PilotClientsReader } from '../pilot-clients-reader.js'
import { PilotSessionInvalidError } from './yandex-pilot-transaction.js'
import {
  type DatabaseReadinessResult,
  safeDatabaseErrorDiagnostics,
} from './database-readiness.js'

export async function inspectRuntimeDomainReadiness(
  clientsReader: PilotClientsReader,
  sessionToken: string,
): Promise<DatabaseReadinessResult> {
  try {
    await clientsReader.readClients(sessionToken)
    return { ready: true }
  } catch (error) {
    if (error instanceof PilotSessionInvalidError) {
      return {
        ready: false,
        category: 'authentication',
        code: 'PILOT_SESSION_INVALID',
      }
    }
    return {
      ready: false,
      ...safeDatabaseErrorDiagnostics(error),
    }
  }
}
