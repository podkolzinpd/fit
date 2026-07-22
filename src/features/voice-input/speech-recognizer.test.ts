import { describe, expect, it } from 'vitest'
import { normalizeTranscript } from './speech-recognizer'

describe('normalizeTranscript', () => {
  it('normalizes whitespace without changing recognized words', () => {
    expect(normalizeTranscript('  Болгарский   присед\n40 килограмм  ')).toBe('Болгарский присед 40 килограмм')
  })
})
