import { describe, expect, it, vi } from 'vitest'
import { assertNoBucketPolicy, assertPrivateMediaAcl, assertPrivateMediaPolicy, assertReviewedPrivateMediaPolicy } from './cloudru-media-health.js'

const bucket = 'fit-cloudru-stage-media-c2ad3760'
const principal = 'arn:aws:iam::f071c7d5-cf0f-4538-9415-bbf9a9c94338:service_account/b87cd7c3-c737-4cd7-87b3-6591dd9b3ec9'
const privatePolicy = () => ({ Version: '2012-10-17', Statement: [
  { Sid: 'FitStageMediaList', Effect: 'Allow', Principal: { AWS: principal }, Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${bucket}` },
  { Sid: 'FitStageMediaReadWrite', Effect: 'Allow', Principal: { AWS: principal }, Action: ['s3:GetObject', 's3:PutObject'], Resource: `arn:aws:s3:::${bucket}/*` },
  { Sid: 'FitStageMediaMetadataRead', Effect: 'Allow', Principal: { AWS: principal }, Action: ['s3:GetBucketAcl', 's3:GetBucketPolicy', 's3:GetBucketOwnershipControls', 's3:GetBucketVersioning'], Resource: `arn:aws:s3:::${bucket}` },
] })

describe('Cloud.ru media ACL guard', () => {
  it('accepts private canonical owner and service-account grants', () => {
    expect(() => assertPrivateMediaAcl({ Owner: { ID: 'synthetic-owner' }, Grants: [
      { Grantee: { Type: 'CanonicalUser', ID: 'synthetic-owner' }, Permission: 'FULL_CONTROL' },
      { Grantee: { Type: 'CanonicalUser', ID: 'synthetic-runtime' }, Permission: 'READ' },
    ] })).not.toThrow()
  })
  it('rejects public group permissions and missing ACL evidence', () => {
    for (const value of [{}, { Owner: { ID: 'synthetic-owner' }, Grants: [] },
      { Owner: { ID: 'synthetic-owner' }, Grants: [{ Grantee: { Type: 'Group' as const, URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' as const }] }]) {
      expect(() => assertPrivateMediaAcl(value)).toThrow('cloudru_media_public_acl_rejected')
    }
  })
  it('requires positive evidence that no independent bucket policy grants access', async () => {
    const send = vi.fn<() => Promise<unknown>>()
    const client = { send }
    send.mockRejectedValueOnce(Object.assign(new Error('absent'), { name: 'NoSuchBucketPolicy' }))
    await expect(assertNoBucketPolicy(client, 'synthetic')).resolves.toBeUndefined()
    send.mockResolvedValueOnce({ Policy: '{"Statement":[{"Effect":"Allow","Principal":"*"}]}' })
    await expect(assertNoBucketPolicy(client, 'synthetic')).rejects.toThrow('cloudru_bucket_policy_requires_review')
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }))
    await expect(assertNoBucketPolicy(client, 'synthetic')).rejects.toThrow('denied')
  })
  it('accepts only the reviewed app-only media policy, including empty console fields', () => {
    const policy = privatePolicy()
    expect(() => assertReviewedPrivateMediaPolicy(JSON.stringify(policy))).not.toThrow()
    const consolePolicy = { ...policy, Statement: policy.Statement.map(statement => ({
      ...statement, NotPrincipal: {}, NotAction: [], NotResource: [], Condition: {},
    })) }
    expect(() => assertReviewedPrivateMediaPolicy(JSON.stringify(consolePolicy))).not.toThrow()
  })
  it('rejects public or different principals, broader resources/actions and condition operators', () => {
    for (const replacement of [
      { Principal: '*' }, { Principal: { AWS: '*' } }, { Principal: { AWS: `${principal}-other` } },
      { Principal: { AWS: principal, Service: 'unexpected' } },
      { Resource: 'arn:aws:s3:::*' }, { Resource: `arn:aws:s3:::${bucket}-other` },
      { Action: ['s3:*'] }, { Action: ['s3:PutBucketPolicy'] }, { Action: ['s3:DeleteObject'] },
      { NotPrincipal: { AWS: principal } }, { NotAction: ['s3:DeleteObject'] },
      { NotResource: ['arn:aws:s3:::elsewhere'] }, { Condition: { StringEquals: { 'unknown:key': 'value' } } },
      { Effect: 'Deny' }, { Unknown: true },
    ]) {
      const policy = privatePolicy()
      Object.assign(policy.Statement[0]!, replacement)
      expect(() => assertReviewedPrivateMediaPolicy(JSON.stringify(policy))).toThrow('cloudru_bucket_policy_requires_review')
    }
  })
  it('rejects malformed, incomplete or duplicate policy evidence instead of skipping the gate', () => {
    const missingMetadata = privatePolicy(); missingMetadata.Statement.pop()
    const duplicate = privatePolicy(); duplicate.Statement[0]!.Action.push('s3:ListBucket')
    for (const policy of [undefined, '{}', 'not-json', JSON.stringify(missingMetadata), JSON.stringify(duplicate),
      JSON.stringify({ ...privatePolicy(), NotPrincipal: '*' }),
      JSON.stringify({ Version: '2012-10-17', Statement: [] })]) {
      expect(() => assertReviewedPrivateMediaPolicy(policy)).toThrow('cloudru_bucket_policy_requires_review')
    }
  })
  it('keeps backup policy rejection and access-denied behavior unchanged', async () => {
    const send = vi.fn<() => Promise<unknown>>()
    const client = { send }
    send.mockResolvedValueOnce({ Policy: JSON.stringify(privatePolicy()) })
    await expect(assertPrivateMediaPolicy(client, bucket)).resolves.toBeUndefined()
    send.mockResolvedValueOnce({ Policy: JSON.stringify(privatePolicy()) })
    await expect(assertNoBucketPolicy(client, bucket)).rejects.toThrow('cloudru_bucket_policy_requires_review')
    await expect(assertPrivateMediaPolicy(client, 'another-bucket')).rejects.toThrow('cloudru_bucket_policy_requires_review')
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }))
    await expect(assertPrivateMediaPolicy(client, bucket)).rejects.toThrow('denied')
    send.mockRejectedValueOnce(Object.assign(new Error('absent'), { name: 'NoSuchBucketPolicy' }))
    await expect(assertPrivateMediaPolicy(client, bucket)).resolves.toBeUndefined()
  })
})
