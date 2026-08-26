import { readAccessibleClients } from '../clients.js'
import { withActorTransaction } from './actor-transaction.js'
import {
  type DatabaseReadinessResult,
  safeDatabaseErrorDiagnostics,
} from './database-readiness.js'
import type { DatabasePool } from './types.js'

export async function inspectRuntimeDomainReadiness(
  pool: DatabasePool,
  actorId: string,
): Promise<DatabaseReadinessResult> {
  try {
    await withActorTransaction(
      pool,
      actorId,
      (client) => readAccessibleClients(client),
    )
    return { ready: true }
  } catch (error) {
    return {
      ready: false,
      ...safeDatabaseErrorDiagnostics(error),
    }
  }
}
