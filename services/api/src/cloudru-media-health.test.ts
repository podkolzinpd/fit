import { describe, expect, it, vi } from 'vitest'
import { assertNoBucketPolicy, assertPrivateMediaAcl } from './cloudru-media-health.js'

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
})
