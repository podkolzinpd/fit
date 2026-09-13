import { describe, expect, it } from 'vitest'
import { readChatImageUpload } from './chat-media.js'

describe('readChatImageUpload', () => {
  it('accepts a bounded JPEG data URL', () => {
    expect(readChatImageUpload({ dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 }))
      .toMatchObject({ mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 3 })
  })

  it('rejects mismatched, oversized and non-JPEG payloads', () => {
    expect(readChatImageUpload({ dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png', width: 100, height: 80, sizeBytes: 3 })).toBeUndefined()
    expect(readChatImageUpload({ dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 100, height: 80, sizeBytes: 2 })).toBeUndefined()
    expect(readChatImageUpload({ dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 5000, height: 80, sizeBytes: 3 })).toBeUndefined()
  })
})
