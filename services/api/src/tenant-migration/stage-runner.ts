import type { DatabasePool } from '../db/types.js'
import { decryptMigrationBundle } from './bundle.js'
import { importTenant } from './engine.js'
import type { TenantMigrationReport } from './types.js'

export interface StageTenantMigrationRunner {
  run(
    envelope: unknown,
    passphrase: string,
    apply: boolean,
  ): Promise<TenantMigrationReport>
}

export class DatabaseStageTenantMigrationRunner
implements StageTenantMigrationRunner {
  constructor(private readonly databasePool: DatabasePool) {}

  async run(
    envelope: unknown,
    passphrase: string,
    apply: boolean,
  ): Promise<TenantMigrationReport> {
    const bundle = await decryptMigrationBundle(envelope, passphrase)
    const connection = await this.databasePool.connect()
    try {
      return await importTenant(connection, bundle, apply)
    } finally {
      connection.release()
    }
  }
}
