import { describe, expect, it } from 'vitest'

import {
  readTrainerPhotoUpload,
  TRAINER_PHOTO_MAX_BYTES,
} from './trainer-profile-media.js'

function part(bytes: Uint8Array) {
  return {
    dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
    sizeBytes: bytes.byteLength,
  }
}

describe('trainer profile photo upload', () => {
  it('accepts bounded JPEG originals and thumbnails', () => {
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

    const result = readTrainerPhotoUpload({ image: part(image), thumbnail: part(image) })
    expect(result).toMatchObject({
      image: { mimeType: 'image/jpeg', width: 640, height: 480, sizeBytes: 7 },
      thumbnail: { mimeType: 'image/jpeg', width: 640, height: 480, sizeBytes: 7 },
    })
    expect(Array.from(result?.image.bytes ?? [])).toEqual(Array.from(image))
    expect(Array.from(result?.thumbnail.bytes ?? [])).toEqual(Array.from(image))
  })

  it('rejects spoofed and oversized payloads', () => {
    const fake = Uint8Array.from([1, 2, 3, 4])
    expect(readTrainerPhotoUpload({ image: part(fake), thumbnail: part(fake) })).toBeUndefined()

    const jpeg = part(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))
    expect(readTrainerPhotoUpload({
      image: { ...jpeg, sizeBytes: TRAINER_PHOTO_MAX_BYTES + 1 },
      thumbnail: jpeg,
    })).toBeUndefined()
  })
})
