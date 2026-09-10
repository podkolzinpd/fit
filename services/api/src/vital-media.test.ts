import { describe, expect, it } from 'vitest'
import { readVitalMediaRequest } from './vital-media.js'

describe('readVitalMediaRequest', () => {
  it('accepts only reviewed Vital media object paths', () => {
    expect(readVitalMediaRequest({ path: 'vital-pro/vital-barbell-squat-ex001.mp4' }))
      .toEqual({ path: 'vital-pro/vital-barbell-squat-ex001.mp4' })
    expect(readVitalMediaRequest({ path: 'vital-pro/vital-barbell-squat-ex001.jpg' }))
      .toEqual({ path: 'vital-pro/vital-barbell-squat-ex001.jpg' })
  })

  it('rejects traversal and other buckets or file types', () => {
    expect(readVitalMediaRequest({ path: 'vital-pro/../private.txt' })).toBeUndefined()
    expect(readVitalMediaRequest({ path: 'avatars/user.jpg' })).toBeUndefined()
    expect(readVitalMediaRequest({ path: 'vital-pro/archive.zip' })).toBeUndefined()
    expect(readVitalMediaRequest(null)).toBeUndefined()
  })
})
