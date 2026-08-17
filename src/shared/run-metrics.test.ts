import { describe, expect, it } from 'vitest'
import {
  formatRunDistanceInput,
  formatRunDuration,
  parseRunDurationInput,
  preferredRunDistanceUnit,
  runDistanceKmFromInput,
  runDistanceLabel,
  runPaceLabel,
} from './run-metrics'

describe('run metrics', () => {
  it('formats and parses runner-friendly duration', () => {
    expect(formatRunDuration(1780)).toBe('29:40')
    expect(formatRunDuration(3661)).toBe('1:01:01')
    expect(parseRunDurationInput('29:40')).toBe(1780)
    expect(parseRunDurationInput('1:01:01')).toBe(3661)
    expect(parseRunDurationInput('30')).toBe(1800)
    expect(parseRunDurationInput('1:75')).toBeUndefined()
  })

  it('converts metres and kilometres without changing storage', () => {
    expect(preferredRunDistanceUnit(0.4)).toBe('m')
    expect(formatRunDistanceInput(0.4, 'm')).toBe('400')
    expect(runDistanceKmFromInput('400', 'm')).toBe(0.4)
    expect(runDistanceKmFromInput('5,2', 'km')).toBe(5.2)
    expect(runDistanceKmFromInput('', 'km')).toBeUndefined()
    expect(runDistanceLabel(0.4)).toBe('400 м')
    expect(runDistanceLabel(5.2)).toBe('5,2 км')
  })

  it('calculates pace from confirmed time and distance', () => {
    expect(runPaceLabel(1780, 5.2)).toBe('5:42/км')
    expect(runPaceLabel(100, 0.4)).toBe('4:10/км')
    expect(runPaceLabel(undefined, 5)).toBeNull()
  })
})
