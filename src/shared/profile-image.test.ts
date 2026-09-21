import { describe, expect, it } from 'vitest'

import { isSupportedProfileImage } from './profile-image'

describe('trainer profile image selection', () => {
  it('accepts iPhone photos whose picker omits the MIME type', () => {
    expect(isSupportedProfileImage({ name: 'IMG_1234.HEIC', type: '' })).toBe(true)
    expect(isSupportedProfileImage({ name: 'portrait.jpeg', type: '' })).toBe(true)
  })

  it('rejects a non-image file when the picker omits the MIME type', () => {
    expect(isSupportedProfileImage({ name: 'notes.txt', type: '' })).toBe(false)
  })
})
