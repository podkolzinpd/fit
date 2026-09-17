import type { DatabasePool } from '../db/types.js'
import { decryptMigrationBundle } from './bundle.js'
import { importTenant, TenantMigrationError } from './engine.js'
import {
  chatMediaReferences,
  type TenantMigrationMediaVerifier,
} from './media-verifier.js'
import type { TenantMigrationReport } from './types.js'

export interface StageTenantMigrationRunner {
  run(
    envelope: unknown,
    passphrase: string,
    apply: boolean,
    allowMissingMedia?: boolean,
  ): Promise<TenantMigrationReport>
}

export class DatabaseStageTenantMigrationRunner
implements StageTenantMigrationRunner {
  constructor(
    private readonly databasePool: DatabasePool,
    private readonly mediaVerifier?: TenantMigrationMediaVerifier,
  ) {}

  async run(
    envelope: unknown,
    passphrase: string,
    apply: boolean,
    allowMissingMedia = false,
  ): Promise<TenantMigrationReport> {
    const bundle = await decryptMigrationBundle(envelope, passphrase)
    const mediaReferences = chatMediaReferences(bundle)
    if (mediaReferences.length > 0 && !allowMissingMedia) {
      if (this.mediaVerifier === undefined) {
        throw new TenantMigrationError('tenant_media_storage_not_configured')
      }
      await this.mediaVerifier.verify(bundle)
    }
    const connection = await this.databasePool.connect()
    try {
      return await importTenant(connection, bundle, apply)
    } finally {
      connection.release()
    }
  }
}
