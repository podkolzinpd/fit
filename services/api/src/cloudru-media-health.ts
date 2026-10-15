import { createHash } from 'node:crypto'
import { cloudruStorageFailure } from './cloudru-storage-error.js'
import { pathToFileURL } from 'node:url'
import { GetBucketAclCommand, GetBucketPolicyCommand, GetBucketVersioningCommand, GetObjectCommand,
  ListObjectsV2Command, PutBucketVersioningCommand, S3Client, type GetBucketAclCommandOutput } from '@aws-sdk/client-s3'

export function assertPrivateMediaAcl(acl: Pick<GetBucketAclCommandOutput, 'Owner' | 'Grants'>): void {
  if (!acl.Owner?.ID || !acl.Grants?.length || acl.Grants.some(grant => grant.Grantee?.Type !== 'CanonicalUser')) {
    throw new Error('cloudru_media_public_acl_rejected')
  }
}

// ACLs alone do not prove privacy: a bucket policy can independently grant
// anonymous access. These dedicated buckets use IAM and ACLs, without policies.
export async function assertNoBucketPolicy(client: { send(command: GetBucketPolicyCommand): Promise<unknown> }, bucket: string): Promise<void> {
  try {
    await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchBucketPolicy') return
    throw error
  }
  throw new Error('cloudru_bucket_policy_requires_review')
}

async function main() {
  const { CLOUDRU_MEDIA_KEY_ID: keyId, CLOUDRU_MEDIA_KEY_SECRET: secretAccessKey, CLOUDRU_TENANT_ID: tenantId } = process.env
  if (!keyId || !secretAccessKey || tenantId !== 'f071c7d5-cf0f-4538-9415-bbf9a9c94338'
    || process.env.CLOUDRU_BACKUP_CONFIRMATION !== 'BACKUP_CLOUDRU_TO_PRIVATE_S3') throw new Error('media_configuration_rejected')
  const client = new S3Client({ endpoint: 'https://s3.cloud.ru', forcePathStyle: true, region: 'ru-central-1', maxAttempts: 2,
    credentials: { accessKeyId: `${tenantId}:${keyId}`, secretAccessKey } })
  const bucket = 'fit-cloudru-stage-media-c2ad3760'
  try {
    console.log('{"event":"cloudru_media_stage","stage":"acl_read"}')
    assertPrivateMediaAcl(await client.send(new GetBucketAclCommand({ Bucket: bucket })))
    console.log('{"event":"cloudru_media_stage","stage":"policy_read"}')
    await assertNoBucketPolicy(client, bucket)
    if (process.env.BACKUP_MODE === 'bootstrap') {
      console.log('{"event":"cloudru_media_stage","stage":"versioning_write"}')
      await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }))
    }
    console.log('{"event":"cloudru_media_stage","stage":"versioning_read"}')
    const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }))
    if (versioning.Status !== 'Enabled') throw new Error('media_versioning_not_enabled')
    let token: string | undefined
    let objects = 0
    let bytes = 0
    const manifest = createHash('sha256')
    console.log('{"event":"cloudru_media_stage","stage":"objects_read"}')
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }))
      for (const object of page.Contents ?? []) {
        if (!object.Key || !Number.isSafeInteger(object.Size) || (object.Size ?? -1) < 0
          || (object.Size ?? 0) > 50 * 1024 * 1024) throw new Error('media_object_rejected')
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }))
        if (!response.Body || response.ContentLength !== object.Size) throw new Error('media_read_failed')
        const contents = await response.Body.transformToByteArray()
        if (contents.byteLength !== object.Size) throw new Error('media_size_mismatch')
        manifest.update(object.Key).update('\0').update(createHash('sha256').update(contents).digest()).update('\n')
        objects++
        bytes += contents.byteLength
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
      if (page.IsTruncated && !token) throw new Error('media_inventory_incomplete')
    } while (token)
    console.log(JSON.stringify({ event: 'cloudru_private_media_verified', versioning: 'Enabled', objects, bytes, sha256: manifest.digest('hex') }))
  } finally { client.destroy() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'cloudru_media_verification_failed', ...cloudruStorageFailure(error) }))
    process.exitCode = 1
  })
}
