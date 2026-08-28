import { describe, expect, it, vi } from 'vitest'

import {
  ApiKeyYandexAiAuthorization,
  buildYandexAiAuthorization,
  MetadataYandexAiAuthorization,
} from './yandex-ai-authorization.js'

describe('Yandex AI authorization', () => {
  it('keeps API-key authorization for legacy function runtimes', async () => {
    const authorization = new ApiKeyYandexAiAuthorization('test-key')

    await expect(authorization.authorizationHeader()).resolves.toBe('Api-Key test-key')
  })

  it('loads and reuses a short-lived IAM token from container metadata', async () => {
    let now = 1_000
    const request = vi.fn(() => Promise.resolve(Response.json({
      access_token: 'iam-token',
      expires_in: 3_600,
    })))
    const authorization = new MetadataYandexAiAuthorization(
      request,
      () => now,
    )

    await expect(authorization.authorizationHeader()).resolves.toBe('Bearer iam-token')
    now += 1_000
    await expect(authorization.authorizationHeader()).resolves.toBe('Bearer iam-token')

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/computeMetadata/v1/instance/service-accounts/default/token'),
      expect.objectContaining({ headers: { 'Metadata-Flavor': 'Google' } }),
    )
  })

  it('does not accept a malformed metadata response', async () => {
    const authorization = new MetadataYandexAiAuthorization(
      vi.fn(() => Promise.resolve(Response.json({ access_token: '', expires_in: 0 }))),
    )

    await expect(authorization.authorizationHeader()).rejects.toThrow(
      'Yandex Cloud metadata token response is invalid',
    )
  })

  it('selects metadata only when the runtime explicitly enables it', () => {
    expect(buildYandexAiAuthorization({
      YANDEX_CLOUD_USE_METADATA_IAM_TOKEN: 'true',
      YANDEX_CLOUD_API_KEY: 'legacy-key',
    })).toBeInstanceOf(MetadataYandexAiAuthorization)
    expect(buildYandexAiAuthorization({})).toBeUndefined()
  })
})
