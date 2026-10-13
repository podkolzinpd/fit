import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const mode = required('FIT_MEDIA_TRANSFER_MODE')
if (!['audit', 'apply', 'bootstrap-target'].includes(mode)) {
  throw new Error('FIT_MEDIA_TRANSFER_MODE must be audit, apply, or bootstrap-target')
}

const sourceBucket = required('YANDEX_MEDIA_SOURCE_BUCKET')
const targetBucket = required('CLOUDRU_MEDIA_TARGET_BUCKET')
const mediaPrefixes = [
  'chat-media/',
  'fit-exercise-media/',
  'trainer-profile-media/',
]
if (sourceBucket !== 'fit-chat-media-b1gt7dfq') throw new Error('Unexpected source bucket')
if (targetBucket !== 'fit-cloudru-stage-media-c2ad3760') throw new Error('Unexpected target bucket')

const sourceAccessKeyId = required('YANDEX_MEDIA_ACCESS_KEY_ID')
const sourceAccessKeyFingerprint = createHash('sha256')
  .update(sourceAccessKeyId)
  .digest('hex')
const targetAccessKeyId = required('CLOUDRU_MEDIA_KEY_ID')
const targetAccessKeyFingerprint = createHash('sha256')
  .update(targetAccessKeyId)
  .digest('hex')

const source = new S3Client({
  endpoint: 'https://storage.yandexcloud.net',
  region: 'ru-central1',
  credentials: {
    accessKeyId: sourceAccessKeyId,
    secretAccessKey: required('YANDEX_MEDIA_SECRET_ACCESS_KEY'),
  },
})

const listObjects = async (client, bucket, prefix) => {
  const objects = []
  let continuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    objects.push(...(page.Contents ?? []).filter(({ Key }) => typeof Key === 'string'))
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
  return objects
}

const listMediaObjects = async (client, bucket) => {
  const objects = []
  for (const prefix of mediaPrefixes) {
    objects.push(...await listObjects(client, bucket, prefix))
  }
  return objects
}

const targetCredentials = () => {
  const tenantId = required('CLOUDRU_TENANT_ID')
  const projectId = required('CLOUDRU_PROJECT_ID')
  const secretAccessKey = required('CLOUDRU_MEDIA_KEY_SECRET')
  return [
    targetAccessKeyId,
    `${tenantId}:${targetAccessKeyId}`,
    `${tenantId}.${targetAccessKeyId}`,
    `${projectId}:${targetAccessKeyId}`,
    `${projectId}.${targetAccessKeyId}`,
  ].map((accessKeyId) => ({ accessKeyId, secretAccessKey }))
}

const connectTarget = async ({ createIfMissing = false } = {}) => {
  let attemptedBootstrap = false
  for (const [format, credentials] of targetCredentials().entries()) {
    const client = new S3Client({
      endpoint: 'https://s3.cloud.ru',
      forcePathStyle: true,
      region: 'ru-central-1',
      credentials,
    })
    try {
      await client.send(new ListObjectsV2Command({ Bucket: targetBucket, MaxKeys: 1 }))
      console.log(JSON.stringify({ event: 'target_access_ok', format }))
      return client
    } catch (error) {
      if (createIfMissing && !attemptedBootstrap && error?.name === 'NoSuchBucket') {
        attemptedBootstrap = true
        try {
          await client.send(new CreateBucketCommand({ Bucket: targetBucket }))
          await client.send(new ListObjectsV2Command({ Bucket: targetBucket, MaxKeys: 1 }))
          console.log(JSON.stringify({ event: 'target_bucket_bootstrapped', format }))
          return client
        } catch (bootstrapError) {
          console.log(JSON.stringify({
            event: 'target_bootstrap_failed',
            format,
            name: bootstrapError?.name,
            status: bootstrapError?.$metadata?.httpStatusCode,
          }))
        }
      }
      console.log(JSON.stringify({
        event: 'target_access_failed',
        format,
        name: error?.name,
        status: error?.$metadata?.httpStatusCode,
      }))
      client.destroy()
    }
  }
  throw new Error('Cloud.ru credentials cannot list the target bucket')
}

const inventory = (objects) => ({
  bytes: objects.reduce((sum, item) => sum + Number(item.Size ?? 0), 0),
  objects: objects.length,
})

const getBytes = async (client, bucket, key) => {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!object.Body) throw new Error('S3 object body is missing')
  return { bytes: await object.Body.transformToByteArray(), object }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

let target
try {
  console.log(JSON.stringify({
    event: 'source_access_key_fingerprint',
    sha256: sourceAccessKeyFingerprint,
  }))
  console.log(JSON.stringify({
    event: 'target_access_key_fingerprint',
    sha256: targetAccessKeyFingerprint,
  }))
  target = await connectTarget({ createIfMissing: mode === 'bootstrap-target' })
  if (mode === 'bootstrap-target') {
    console.log(JSON.stringify({ event: 'complete', mode }))
    process.exitCode = 0
  } else {
    const sourceObjects = await listMediaObjects(source, sourceBucket)
    console.log(JSON.stringify({ event: 'source_inventory', ...inventory(sourceObjects) }))
  let targetObjects = await listMediaObjects(target, targetBucket)
  console.log(JSON.stringify({ event: 'target_inventory', ...inventory(targetObjects) }))

  const targetByKey = new Map(targetObjects.map((item) => [item.Key, Number(item.Size ?? 0)]))
  const pending = sourceObjects.filter((item) => targetByKey.get(item.Key) !== Number(item.Size ?? 0))
  console.log(JSON.stringify({ event: 'parity', pending: pending.length }))

  if (mode === 'apply') {
    let checked = 0
    let copied = 0
    let copiedBytes = 0
    let skipped = 0
    const sourceDigests = new Map()
    for (const item of sourceObjects) {
      const { bytes: sourceBytes, object } = await getBytes(source, sourceBucket, item.Key)
      const sourceDigest = digest(sourceBytes)
      sourceDigests.set(item.Key, sourceDigest)

      let alreadyExact = false
      if (targetByKey.get(item.Key) === sourceBytes.byteLength) {
        const { bytes: targetBytes } = await getBytes(target, targetBucket, item.Key)
        alreadyExact = digest(targetBytes) === sourceDigest
      }

      if (alreadyExact) {
        skipped += 1
      } else {
        await target.send(new PutObjectCommand({
          Bucket: targetBucket,
          Key: item.Key,
          Body: sourceBytes,
          CacheControl: object.CacheControl,
          ContentDisposition: object.ContentDisposition,
          ContentEncoding: object.ContentEncoding,
          ContentLanguage: object.ContentLanguage,
          ContentType: object.ContentType,
          Metadata: object.Metadata,
        }))
        copied += 1
        copiedBytes += sourceBytes.byteLength
      }
      checked += 1
      if (checked % 25 === 0 || checked === sourceObjects.length) {
        console.log(JSON.stringify({
          event: 'copy_progress',
          checked,
          copied,
          copiedBytes,
          skipped,
          total: sourceObjects.length,
        }))
      }
    }

    targetObjects = await listMediaObjects(target, targetBucket)
    const verifiedByKey = new Map(targetObjects.map((item) => [item.Key, Number(item.Size ?? 0)]))
    let mismatches = 0
    for (const item of sourceObjects) {
      if (verifiedByKey.get(item.Key) !== Number(item.Size ?? 0)) {
        mismatches += 1
        continue
      }
      const { bytes: targetBytes } = await getBytes(target, targetBucket, item.Key)
      if (digest(targetBytes) !== sourceDigests.get(item.Key)) mismatches += 1
    }
    console.log(JSON.stringify({
      event: 'verification',
      mismatches,
      source: inventory(sourceObjects),
      target: inventory(targetObjects),
    }))
    if (mismatches) throw new Error(`Verification failed for ${mismatches} objects`)
  }

  console.log(JSON.stringify({ event: 'complete', mode }))
  }
} finally {
  source.destroy()
  target?.destroy()
}
