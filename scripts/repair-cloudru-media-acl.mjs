import { createRequire } from 'node:module'
import { pathToFileURL, URL } from 'node:url'

const appAccount = 'b87cd7c3-c737-4cd7-87b3-6591dd9b3ec9'
const bucket = 'fit-cloudru-stage-media-c2ad3760'
const tenant = 'f071c7d5-cf0f-4538-9415-bbf9a9c94338'
const headers = {
  READ: 'GrantRead', WRITE: 'GrantWrite', READ_ACP: 'GrantReadACP',
  WRITE_ACP: 'GrantWriteACP', FULL_CONTROL: 'GrantFullControl',
}

// Preserve each existing private grant. Unexpected principals require review;
// never replace a policy or ownership setting to make this operation succeed.
export function planMediaAclReadRepair(acl) {
  if (!acl.Owner?.ID || !acl.Grants?.length) throw new Error('media_acl_invalid')
  const allowed = new Set([acl.Owner.ID, appAccount])
  const permissions = new Map(Object.keys(headers).map(permission => [permission, new Set()]))
  for (const grant of acl.Grants) {
    const grantee = grant.Grantee
    if (grantee?.Type !== 'CanonicalUser' || !allowed.has(grantee.ID)
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(grantee.ID) || !permissions.has(grant.Permission)) {
      throw new Error('media_acl_requires_review')
    }
    permissions.get(grant.Permission).add(grantee.ID)
  }
  const changed = !permissions.get('READ_ACP').has(appAccount)
    && !permissions.get('FULL_CONTROL').has(appAccount)
  if (changed) permissions.get('READ_ACP').add(appAccount)
  return {
    changed,
    headers: Object.fromEntries([...permissions].filter(([, ids]) => ids.size)
      .map(([permission, ids]) => [headers[permission], [...ids].sort().map(id => `id="${id}"`).join(', ')])),
  }
}

async function main() {
  const { CLOUDRU_MEDIA_KEY_ID: keyId, CLOUDRU_MEDIA_KEY_SECRET: secretAccessKey } = process.env
  if (process.env.MEDIA_ACL_CONFIRMATION !== 'GRANT_APP_MEDIA_ACL_READ_ONLY'
    || !keyId || !secretAccessKey || keyId.includes(':') || /[\r\n]/.test(keyId + secretAccessKey)) {
    throw new Error('media_acl_configuration_rejected')
  }
  const requireApi = createRequire(new URL('../services/api/package.json', import.meta.url))
  const { S3Client, GetBucketAclCommand, PutBucketAclCommand, GetBucketPolicyCommand } = requireApi('@aws-sdk/client-s3')
  const client = new S3Client({ endpoint: 'https://s3.cloud.ru', forcePathStyle: true,
    region: 'ru-central-1', maxAttempts: 2, credentials: { accessKeyId: `${tenant}:${keyId}`, secretAccessKey } })
  try {
    try {
      await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))
      throw new Error('media_acl_policy_requires_review')
    } catch (error) {
      if (error?.name !== 'NoSuchBucketPolicy') throw error
    }
    const plan = planMediaAclReadRepair(await client.send(new GetBucketAclCommand({ Bucket: bucket })))
    if (plan.changed) await client.send(new PutBucketAclCommand({ Bucket: bucket, ...plan.headers }))
    const readback = planMediaAclReadRepair(await client.send(new GetBucketAclCommand({ Bucket: bucket })))
    if (readback.changed || JSON.stringify(readback.headers) !== JSON.stringify(plan.headers)) {
      throw new Error('media_acl_readback_failed')
    }
    console.log(JSON.stringify({ event: 'cloudru_media_acl_read_repaired', changed: plan.changed }))
  } finally {
    client.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const safeCodes = new Set(['media_acl_invalid', 'media_acl_requires_review', 'media_acl_policy_requires_review',
      'media_acl_configuration_rejected', 'media_acl_readback_failed'])
    console.error(JSON.stringify({ event: 'cloudru_media_acl_repair_failed',
      code: safeCodes.has(error?.message) ? error.message : 'storage_request_failed',
      httpStatus: Number.isInteger(error?.$metadata?.httpStatusCode) ? error.$metadata.httpStatusCode : null }))
    process.exitCode = 1
  })
}
