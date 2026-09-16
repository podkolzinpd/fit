import { describe, expect, it, vi } from 'vitest'

import type { ChatImageUpload } from './chat-media.js'
import {
  mediaObjectKey,
  readYandexMediaStorageConfig,
  type MediaObjectStorage,
  YandexChatMediaStore,
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

describe('mediaObjectKey', () => {
  it('isolates legacy buckets under independent prefixes', () => {
    expect(mediaObjectKey('chat-media', 'conversation/message.jpg'))
      .toBe('chat-media/conversation/message.jpg')
    expect(mediaObjectKey('fit-exercise-media', 'vital-pro/squat.mp4'))
      .toBe('fit-exercise-media/vital-pro/squat.mp4')
  })

  it('rejects traversal, absolute and empty paths', () => {
    for (const path of ['', '/message.jpg', '../message.jpg', 'a//message.jpg']) {
      expect(() => mediaObjectKey('chat-media', path)).toThrow('media_object_path_invalid')
    }
  })
})

describe('Yandex media adapters', () => {
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
