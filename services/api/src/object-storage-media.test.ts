import { describe, expect, it, vi } from 'vitest'

import type { ChatImageUpload } from './chat-media.js'
import {
  mediaObjectKey,
  readMediaStorageConfig,
  readYandexMediaStorageConfig,
  type MediaObjectStorage,
  VITAL_MEDIA_CACHE_CONTROL,
  YandexChatMediaStore,
  YandexMediaObjectStorage,
  YandexVitalMediaSigner,
} from './object-storage-media.js'

function buildStorage() {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    sign: vi.fn().mockResolvedValue('https://storage.example/signed'),
    stat: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  } satisfies MediaObjectStorage
}

describe('readYandexMediaStorageConfig', () => {
  it('keeps the Yandex store disabled when all values are absent', () => {
    expect(readYandexMediaStorageConfig({})).toBeUndefined()
  })

  it('accepts only a complete bounded configuration', () => {
    const environment = {
      YANDEX_MEDIA_ACCESS_KEY_ID: `YC${'a'.repeat(23)}`,
      YANDEX_MEDIA_BUCKET: 'fit-stage-media-example',
      YANDEX_MEDIA_SECRET_ACCESS_KEY: `YC${'b'.repeat(38)}`,
    }
    expect(readYandexMediaStorageConfig(environment)).toEqual({
      accessKeyId: environment.YANDEX_MEDIA_ACCESS_KEY_ID,
      bucket: environment.YANDEX_MEDIA_BUCKET,
      secretAccessKey: environment.YANDEX_MEDIA_SECRET_ACCESS_KEY,
    })
    expect(() => readYandexMediaStorageConfig({
      YANDEX_MEDIA_BUCKET: environment.YANDEX_MEDIA_BUCKET,
    })).toThrow('configuration is incomplete')
    expect(() => readYandexMediaStorageConfig({
      ...environment,
      YANDEX_MEDIA_BUCKET: '../unsafe',
    })).toThrow('configuration is invalid')
  })
})

describe('readMediaStorageConfig', () => {
  it('keeps the existing Yandex provider as the default', () => {
    expect(readMediaStorageConfig({})).toBeUndefined()
    expect(readMediaStorageConfig({
      YANDEX_MEDIA_ACCESS_KEY_ID: `YC${'a'.repeat(23)}`,
      YANDEX_MEDIA_BUCKET: 'fit-stage-media-example',
      YANDEX_MEDIA_SECRET_ACCESS_KEY: `YC${'b'.repeat(38)}`,
    })?.bucket).toBe('fit-stage-media-example')
  })

  it('uses tenant-prefixed credentials for the Cloud.ru S3 endpoint', () => {
    const config = readMediaStorageConfig({
      FIT_MEDIA_STORAGE_PROVIDER: 'cloudru',
      CLOUDRU_MEDIA_BUCKET: 'fit-cloudru-stage-media-c2ad3760',
      CLOUDRU_TENANT_ID: 'f071c7d5-cf0f-4538-9415-bbf9a9c94338',
      CLOUDRU_MEDIA_KEY_ID: 'exampleKey123',
      CLOUDRU_MEDIA_KEY_SECRET: 'exampleSecretValue123',
    })
    expect(config).toEqual({
      accessKeyId: 'f071c7d5-cf0f-4538-9415-bbf9a9c94338:exampleKey123',
      bucket: 'fit-cloudru-stage-media-c2ad3760',
      provider: 'cloudru',
      secretAccessKey: 'exampleSecretValue123',
    })
  })

  it('fails closed for incomplete or unknown provider settings', () => {
    expect(() => readMediaStorageConfig({ FIT_MEDIA_STORAGE_PROVIDER: 'cloudru' }))
      .toThrow('configuration is incomplete')
    expect(() => readMediaStorageConfig({ FIT_MEDIA_STORAGE_PROVIDER: 'unexpected' }))
      .toThrow('FIT_MEDIA_STORAGE_PROVIDER is invalid')
  })
})

describe('mediaObjectKey', () => {
  it('isolates legacy buckets under independent prefixes', () => {
    expect(mediaObjectKey('chat-media', 'conversation/message.jpg'))
      .toBe('chat-media/conversation/message.jpg')
    expect(mediaObjectKey('fit-exercise-media', 'vital-pro/squat.mp4'))
      .toBe('fit-exercise-media/vital-pro/squat.mp4')
    expect(mediaObjectKey('custom-exercise-media', 'owner/exercise/hash.jpg')).toBe('custom-exercise-media/owner/exercise/hash.jpg')
    expect(mediaObjectKey('trainer-profile-media', 'trainer/photo/full.jpg'))
      .toBe('trainer-profile-media/trainer/photo/full.jpg')
  })

  it('rejects traversal, absolute and empty paths', () => {
    for (const path of ['', '/message.jpg', '../message.jpg', 'a//message.jpg']) {
      expect(() => mediaObjectKey('chat-media', path)).toThrow('media_object_path_invalid')
    }
  })
})

describe('Yandex media adapters', () => {
  it('stores private exercise media with a cache lifetime inside signed URL expiry', async () => {
    const storage = new YandexMediaObjectStorage({
      accessKeyId: `YC${'a'.repeat(23)}`,
      bucket: 'fit-stage-media-example',
      secretAccessKey: `YC${'b'.repeat(38)}`,
    })
    const send = vi.fn().mockResolvedValue({})
    Object.assign(storage, { client: { send } })

    await storage.write(
      'fit-exercise-media',
      'vital-pro/squat.mp4',
      Uint8Array.from([1, 2, 3]),
      'video/mp4',
      true,
    )

    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toMatchObject({ input: {
      CacheControl: VITAL_MEDIA_CACHE_CONTROL,
      Key: 'fit-exercise-media/vital-pro/squat.mp4',
    } })
  })

  it('aborts a stalled object deletion before it can block the profile response', async () => {
    const storage = new YandexMediaObjectStorage({
      accessKeyId: `YC${'a'.repeat(23)}`,
      bucket: 'fit-stage-media-example',
      secretAccessKey: `YC${'b'.repeat(38)}`,
    }, 10)
    const send = vi.fn((_command: unknown, options?: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
    Object.assign(storage, { client: { send } })

    await expect(storage.remove('trainer-profile-media', 'trainer/photo/full.jpg'))
      .rejects.toThrow('media_object_delete_failed')
    expect(send).toHaveBeenCalledOnce()
  })

  it('stores, signs and removes chat images in the chat namespace', async () => {
    const storage = buildStorage()
    const store = new YandexChatMediaStore(storage)
    const image: ChatImageUpload = {
      bytes: Uint8Array.from([1, 2, 3]),
      height: 80,
      mimeType: 'image/jpeg',
      sizeBytes: 3,
      width: 100,
    }

    await store.upload('conversation/message.jpg', image)
    await expect(store.sign('conversation/message.jpg'))
      .resolves.toBe('https://storage.example/signed')
    await store.remove('conversation/message.jpg')

    expect(storage.write).toHaveBeenCalledWith(
      'chat-media',
      'conversation/message.jpg',
      image.bytes,
      'image/jpeg',
      false,
    )
    expect(storage.sign).toHaveBeenCalledWith(
      'chat-media',
      'conversation/message.jpg',
    )
    expect(storage.remove).toHaveBeenCalledWith(
      'chat-media',
      'conversation/message.jpg',
    )
  })

  it('signs exercise media in a separate namespace', async () => {
    const storage = buildStorage()
    const signer = new YandexVitalMediaSigner(storage)

    await signer.sign('vital-pro/squat.mp4')

    expect(storage.sign).toHaveBeenCalledWith(
      'fit-exercise-media',
      'vital-pro/squat.mp4',
    )
  })
})
