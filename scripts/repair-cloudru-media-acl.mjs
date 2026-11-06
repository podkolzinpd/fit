import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { pathToFileURL, URL } from 'node:url'

const appAccount = 'b87cd7c3-c737-4cd7-87b3-6591dd9b3ec9'
const bucket = 'fit-cloudru-stage-media-c2ad3760'
const tenant = 'f071c7d5-cf0f-4538-9415-bbf9a9c94338'
const headers = {
  READ: 'GrantRead', WRITE: 'GrantWrite', READ_ACP: 'GrantReadACP',
  WRITE_ACP: 'GrantWriteACP', FULL_CONTROL: 'GrantFullControl',
}

export function verifyMediaKeyBinding(keyId, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)
    || createHash('sha256').update(keyId).digest('hex') !== expectedSha256) {
    throw new Error('media_key_binding_rejected')
  }
}

export function safeMediaRepairFailure(error) {
  const safeCodes = new Set(['media_acl_invalid', 'media_acl_requires_review', 'media_acl_policy_requires_review',
    'media_acl_configuration_rejected', 'media_acl_readback_failed', 'media_key_binding_rejected',
    'media_acl_inspection_failed', 'media_metadata_rejected'])
  const storageCodes = new Set(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch',
    'AccessControlListNotSupported', 'NoSuchBucket', 'NoSuchBucketPolicy'])
  return {
    code: safeCodes.has(error?.message) ? error.message : 'storage_request_failed',
    reason: storageCodes.has(error?.name) ? error.name : 'unclassified',
    httpStatus: Number.isInteger(error?.$metadata?.httpStatusCode) ? error.$metadata.httpStatusCode : null,
  }
}

// Independent metadata reads locate permission failures without changing grants,
// policies, ownership, versioning or objects, even when the first read is denied.
export async function inspectMediaAccess(client, commands, emit) {
  let ok = true
  for (const [stage, command] of [['acl_read', 'GetBucketAclCommand'], ['policy_read', 'GetBucketPolicyCommand'],
    ['ownership_read', 'GetBucketOwnershipControlsCommand'], ['versioning_read', 'GetBucketVersioningCommand']]) {
    try {
      const value = await client.send(new commands[command]({ Bucket: bucket }))
      let metadata = {}
      if (stage === 'acl_read') metadata = { privateAcl: true, needsAclReadGrant: planMediaAclReadRepair(value).changed }
      if (stage === 'policy_read') metadata = { policyPresent: true, privacyNotVerified: true }
      if (stage === 'ownership_read') {
        const ownership = value.OwnershipControls?.Rules?.[0]?.ObjectOwnership
        if (!['ObjectWriter', 'BucketOwnerPreferred', 'BucketOwnerEnforced'].includes(ownership)) {
          throw new Error('media_metadata_rejected')
        }
        metadata = { ownership }
      }
      if (stage === 'versioning_read') {
        const versioning = value.Status ?? 'Unconfigured'
        if (!['Enabled', 'Suspended', 'Unconfigured'].includes(versioning)) throw new Error('media_metadata_rejected')
        metadata = { versioning }
      }
      emit({ event: 'cloudru_media_acl_probe', stage, ok: true, ...metadata })
    } catch (error) {
      if (stage === 'policy_read' && error?.name === 'NoSuchBucketPolicy') {
        emit({ event: 'cloudru_media_acl_probe', stage, ok: true, policyAbsent: true })
      } else {
        ok = false
        emit({ event: 'cloudru_media_acl_probe', stage, ok: false, ...safeMediaRepairFailure(error) })
      }
    }
  }
  if (!ok) throw new Error('media_acl_inspection_failed')
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
  const mode = process.env.MEDIA_ACL_MODE || 'repair'
  if (process.env.MEDIA_ACL_CONFIRMATION !== 'GRANT_APP_MEDIA_ACL_READ_ONLY'
    || !['inspect', 'repair'].includes(mode)
    || !keyId || !secretAccessKey || keyId.includes(':') || /[\r\n]/.test(keyId + secretAccessKey)) {
    throw new Error('media_acl_configuration_rejected')
  }
  if (process.env.EXPECTED_MEDIA_KEY_SHA256) {
    verifyMediaKeyBinding(keyId, process.env.EXPECTED_MEDIA_KEY_SHA256)
    console.log('{"event":"cloudru_media_key_binding_verified","matches":true}')
  }
  const requireApi = createRequire(new URL('../services/api/package.json', import.meta.url))
  const commands = requireApi('@aws-sdk/client-s3')
  const { S3Client, GetBucketAclCommand, PutBucketAclCommand, GetBucketPolicyCommand } = commands
  const client = new S3Client({ endpoint: 'https://s3.cloud.ru', forcePathStyle: true,
    region: 'ru-central-1', maxAttempts: 2, credentials: { accessKeyId: `${tenant}:${keyId}`, secretAccessKey } })
  try {
    if (mode === 'inspect') {
      await inspectMediaAccess(client, commands, event => console.log(JSON.stringify(event)))
      return
    }
    try {
      console.log('{"event":"cloudru_media_acl_stage","stage":"policy_read"}')
      await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))
      throw new Error('media_acl_policy_requires_review')
    } catch (error) {
      if (error?.name !== 'NoSuchBucketPolicy') throw error
    }
    console.log('{"event":"cloudru_media_acl_stage","stage":"acl_read"}')
    const plan = planMediaAclReadRepair(await client.send(new GetBucketAclCommand({ Bucket: bucket })))
    if (plan.changed) {
      console.log('{"event":"cloudru_media_acl_stage","stage":"acl_write"}')
      await client.send(new PutBucketAclCommand({ Bucket: bucket, ...plan.headers }))
    }
    console.log('{"event":"cloudru_media_acl_stage","stage":"acl_readback"}')
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
    console.error(JSON.stringify({ event: 'cloudru_media_acl_repair_failed',
      ...safeMediaRepairFailure(error) }))
    process.exitCode = 1
  })
}
