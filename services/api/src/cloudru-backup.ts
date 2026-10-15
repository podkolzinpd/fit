import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { CreateBucketCommand, GetBucketAclCommand, GetObjectCommand, PutObjectCommand, S3Client, type GetBucketAclCommandOutput } from '@aws-sdk/client-s3'
import { backupCloudruDatabase } from './cloudru-release-migrations.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { assertNoBucketPolicy } from './cloudru-media-health.js'
import { cloudruStorageFailure } from './cloudru-storage-error.js'

const bucket = 'fit-cloudru-backups-c2ad3760'
const magic = Buffer.from('FITBKP01')
const maxArchiveBytes = 64 * 1024 * 1024

function encryptionKey(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('backup_encryption_key_rejected')
  return Buffer.from(value, 'hex')
}

export function encryptCloudruBackup(plain: Buffer, key: string): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), nonce)
  cipher.setAAD(magic)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted])
}

export function decryptCloudruBackup(encrypted: Buffer, key: string): Buffer {
  if (encrypted.length < 36 || !encrypted.subarray(0, 8).equals(magic)) throw new Error('backup_archive_rejected')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), encrypted.subarray(8, 20))
  decipher.setAAD(magic)
  decipher.setAuthTag(encrypted.subarray(20, 36))
  return Buffer.concat([decipher.update(encrypted.subarray(36)), decipher.final()])
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw new Error('backup_configuration_rejected')
  return value
}

export function cloudruBackupStorageCredentials(environment: Readonly<Record<string, string | undefined>>): {
  accessKeyId: string
  secretAccessKey: string
} {
  const keyId = environment.CLOUDRU_BACKUP_KEY_ID
  const secretAccessKey = environment.CLOUDRU_BACKUP_KEY_SECRET
  if (environment.CLOUDRU_TENANT_ID !== 'f071c7d5-cf0f-4538-9415-bbf9a9c94338'
    || !keyId || !secretAccessKey || [keyId, secretAccessKey].some(value =>
      [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127))) {
    throw new Error('backup_configuration_rejected')
  }
  return { accessKeyId: `${environment.CLOUDRU_TENANT_ID}:${keyId}`, secretAccessKey }
}

export function assertPrivateBackupAcl(acl: Pick<GetBucketAclCommandOutput, 'Owner' | 'Grants'>, backupAccountId: string): void {
  const permissions = new Set(['FULL_CONTROL', 'READ', 'WRITE', 'READ_ACP', 'WRITE_ACP'])
  const backupPermissions = new Set(['READ', 'WRITE', 'READ_ACP'])
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(backupAccountId) || !acl.Owner?.ID || !acl.Grants?.length
    || acl.Grants.some(grant => grant.Grantee?.Type !== 'CanonicalUser'
      || !permissions.has(grant.Permission ?? '')
      || (grant.Grantee.ID !== acl.Owner?.ID
        && (grant.Grantee.ID !== backupAccountId || !backupPermissions.has(grant.Permission ?? ''))))) {
    throw new Error('backup_bucket_not_private')
  }
}

async function main() {
  if (process.getuid?.() !== 0 || process.env.CLOUDRU_BACKUP_CONFIRMATION !== 'BACKUP_CLOUDRU_TO_PRIVATE_S3'
    || process.env.MIGRATION_DATABASE_HOST !== '10.70.10.67' || process.env.MIGRATION_DATABASE_PORT !== '5432'
    || process.env.MIGRATION_DATABASE_NAME !== 'fit' || process.env.MIGRATION_DATABASE_USER !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw new Error('backup_target_rejected')
  const backupAccountId = required('CLOUDRU_BACKUP_ACCOUNT_ID')
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(backupAccountId)) throw new Error('backup_configuration_rejected')
  const attempt = required('BACKUP_ATTEMPT')
  if (!/^[0-9]+-[0-9]+$/u.test(attempt)) throw new Error('backup_attempt_rejected')
  const client = new S3Client({ endpoint: 'https://s3.cloud.ru', forcePathStyle: true, region: 'ru-central-1', maxAttempts: 2,
    credentials: cloudruBackupStorageCredentials(process.env) })
  try {
    console.log('{"event":"cloudru_backup_stage","stage":"acl_read"}')
    if (process.env.BACKUP_MODE === 'bootstrap') {
      try { await client.send(new GetBucketAclCommand({ Bucket: bucket })) }
      catch (error) {
        if (!(error instanceof Error) || !['NoSuchBucket', 'NotFound'].includes(error.name)) throw error
        // Create with default private access. Bucket-scoped IAM roles provide
        // access; bootstrap verifies privacy without changing existing ACLs.
        await client.send(new CreateBucketCommand({ Bucket: bucket }))
      }
    }
    const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }))
    assertPrivateBackupAcl(acl, backupAccountId)
    console.log('{"event":"cloudru_backup_stage","stage":"policy_read"}')
    await assertNoBucketPolicy(client, bucket)
    if (process.env.BACKUP_MODE === 'bootstrap') {
      // Actual data access is proved by backup upload/readback, not inferred
      // from ACL grants. Unknown/public grants remain rejected above.
      console.log('{"event":"cloudru_private_backup_bucket_verified"}')
      return
    }
    if (process.env.BACKUP_MODE !== 'backup') throw new Error('backup_mode_rejected')
    const key = required('CLOUDRU_BACKUP_ENCRYPTION_KEY')
    encryptionKey(key)
    const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if (!config) throw new Error('backup_database_missing')
    console.log('{"event":"cloudru_backup_stage","stage":"dump"}')
    await backupCloudruDatabase(config, '/backup')
    const archivePath = '/backup/before-migrations.dump'
    const size = (await stat(archivePath)).size
    if (size > maxArchiveBytes) throw new Error('backup_size_limit_exceeded')
    const plain = await readFile(archivePath)
    const encrypted = encryptCloudruBackup(plain, key)
    const digest = createHash('sha256').update(encrypted).digest('hex')
    const objectKey = `db/${new Date().toISOString().slice(0, 10)}/${attempt}.dump.aesgcm`
    console.log('{"event":"cloudru_backup_stage","stage":"upload"}')
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey,
      Body: encrypted, ContentLength: encrypted.length, ContentType: 'application/octet-stream',
      IfNoneMatch: '*', Metadata: { sha256: digest, 'encryption-format': 'FITBKP01', 'key-version': 'v1' } }))
    console.log('{"event":"cloudru_backup_stage","stage":"readback"}')
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
    if (!downloaded.Body || downloaded.ContentLength !== encrypted.length) throw new Error('backup_readback_failed')
    const bytes = Buffer.from(await downloaded.Body.transformToByteArray())
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('backup_checksum_failed')
    const restored = decryptCloudruBackup(bytes, key)
    if (!restored.equals(plain)) throw new Error('backup_decryption_failed')
    await writeFile('/backup/readback.dump', restored, { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ event: 'cloudru_offsite_backup_verified', encryptedBytes: encrypted.length, sha256: digest }))
  } finally { client.destroy() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'cloudru_offsite_backup_failed', ...cloudruStorageFailure(error) }))
    process.exitCode = 1
  })
}
