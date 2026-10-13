import { describe, expect, it } from 'vitest'

import { aiFunctionsEnabled } from './ai-functions-enabled.js'

describe('aiFunctionsEnabled', () => {
  it('preserves the existing Yandex default', () => {
    expect(aiFunctionsEnabled({})).toBe(true)
    expect(aiFunctionsEnabled({ FIT_AI_FUNCTIONS_ENABLED: 'false' })).toBe(false)
  })

  it('disables AI by default for the Cloud.ru media/runtime provider', () => {
    expect(aiFunctionsEnabled({ FIT_MEDIA_STORAGE_PROVIDER: 'cloudru' })).toBe(false)
    expect(aiFunctionsEnabled({
      FIT_MEDIA_STORAGE_PROVIDER: 'cloudru', FIT_AI_FUNCTIONS_ENABLED: 'true',
    })).toBe(true)
  })
})
