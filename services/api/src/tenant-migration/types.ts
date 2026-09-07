export type JsonPrimitive = boolean | number | string | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface JsonObject {
  [key: string]: JsonValue
}
export interface TenantMigrationTable {
  name: string
  rowCount: number
  checksum: string
  rows: JsonObject[]
}

export interface TenantMigrationBundle {
  format: 'fit-tenant-bundle-v1'
  createdAt: string
  tenantFingerprint: string
  trainerId: string
  tables: TenantMigrationTable[]
}

export interface TenantMigrationEnvelope {
  format: 'fit-tenant-envelope-v1'
  kdf: {
    name: 'scrypt'
    salt: string
  }
  cipher: {
    name: 'aes-256-gcm'
    iv: string
    authTag: string
  }
  ciphertext: string
}

export interface TenantMigrationTableReport {
  name: string
  rows: number
  inserted: number
}

export interface TenantMigrationReport {
  mode: 'applied' | 'dry-run' | 'validated'
  tenantFingerprint: string
  tables: TenantMigrationTableReport[]
}
