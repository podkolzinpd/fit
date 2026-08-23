import { describe, expect, it } from 'vitest'
import { normalizeWorkoutSpeech, parseWorkoutNumber } from './workout-speech-normalizer'

describe('normalizeWorkoutSpeech', () => {
  it('removes standalone hesitation sounds and discourse markers', () => {
    expect(normalizeWorkoutSpeech('Так, эээ, приседания с гирей, ну, три по десять, двадцать килограмм, дальше, эм, выпады с гантелями'))
      .toBe('приседания с гирей, три по десять, двадцать килограмм, дальше, выпады с гантелями')
  })

  it('does not remove conjunctions or words inside exercise names', () => {
    expect(normalizeWorkoutSpeech('Сведение и разведение ног, тяга одной рукой'))
      .toBe('Сведение и разведение ног, тяга одной рукой')
  })

  it('collapses accidental repeated words without rewriting values', () => {
    expect(normalizeWorkoutSpeech('жим жим гантелей двадцать на десять'))
      .toBe('жим гантелей двадцать на десять')
  })
})

describe('parseWorkoutNumber', () => {
  it.each([
    ['3', 3],
    ['7,5', 7.5],
    ['три', 3],
    ['двадцать пять', 25],
    ['сто двадцать пять', 125],
    ['семь с половиной', 7.5],
    ['полтора', 1.5],
  ])('parses %s', (value, expected) => {
    expect(parseWorkoutNumber(value)).toBe(expected)
  })

  it('does not reinterpret an exercise-name fragment as a metric', () => {
    expect(parseWorkoutNumber('одной')).toBeUndefined()
  })
})
