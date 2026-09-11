import { describe, expect, it } from 'vitest'
import { aiStudioUsage } from './ai-studio-usage-metrics.js'

describe('aiStudioUsage', () => {
  it('normalizes the completion API token payload', () => {
    expect(aiStudioUsage({ inputTextTokens: '12', completionTokens: '3', totalTokens: '20' })).toEqual({
      inputTokens: 12,
      cachedTokens: 5,
      outputTokens: 3,
      totalTokens: 20,
    })
  })

  it('uses an explicit cached-token field when supplied', () => {
    expect(aiStudioUsage({ input_tokens: 12, output_tokens: 3, total_tokens: 20, input_tokens_details: { cached_tokens: 4 } })).toEqual({
      inputTokens: 12,
      cachedTokens: 4,
      outputTokens: 3,
      totalTokens: 20,
    })
  })

  it('does not invent usage for an absent response payload', () => {
    expect(aiStudioUsage(undefined)).toBeNull()
  })
})
