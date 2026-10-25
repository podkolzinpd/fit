import { describe, expect, it } from 'vitest'
import { readCustomExercisePhoto, storedCustomExercisePhoto } from './custom-exercise-media.js'

const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const valid = { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, mimeType: 'image/jpeg', width: 8, height: 8, sizeBytes: bytes.length }
describe('custom exercise photo validation', () => {
  it('accepts the existing prepared JPEG contract', () => {
    expect(readCustomExercisePhoto(valid)).toMatchObject({ bytes, mimeType: 'image/jpeg', width: 8, height: 8, sizeBytes: 4 })
  })
  it.each([null, {}, { ...valid, mimeType: 'image/png' }, { ...valid, width: 1601 }, { ...valid, height: 0 },
    { ...valid, sizeBytes: 2097153 }, { ...valid, sizeBytes: 3 }, { ...valid, dataUrl: 'data:image/jpeg;base64,YWJjZA==' }])('rejects invalid and oversized files', value => {
    expect(readCustomExercisePhoto(value)).toBeUndefined()
  })
  it('keeps old exercises without an image optional', () => {
    expect(storedCustomExercisePhoto({ image_path: null, image_mime_type: null, image_width: null, image_height: null, image_size_bytes: null, image_sha256: null })).toBeUndefined()
  })
})
