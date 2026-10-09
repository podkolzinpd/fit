import { describe, expect, it } from 'vitest'
import { coachLiveSetSummary } from './coach-live-summary'

describe('Coach Live reference summary', () => {
  it('collapses only truly equal values', () => {
    expect(coachLiveSetSummary(['50 кг × 10 повт.', '50 кг × 10 повт.'])).toBe('2 подхода · 50 кг · 10 повт.')
    expect(coachLiveSetSummary(['50 кг × 10 повт.', '60 кг × 8 повт.'])).toBe('2 подхода · разные параметры')
    expect(coachLiveSetSummary(['50 кг', null])).toBe('2 подхода · разные параметры')
  })
  it('keeps duration and distance dimensions intact', () => {
    expect(coachLiveSetSummary(['5 км × 30 мин'])).toBe('1 подход · 5 км · 30 мин')
    expect(coachLiveSetSummary(['30 с', '45 с'])).toBe('2 подхода · разные параметры')
  })
  it.each([[0, 'подходов'], [1, 'подход'], [2, 'подхода'], [5, 'подходов'], [11, 'подходов'], [21, 'подход'], [24, 'подхода']])('uses real count %i', (count, noun) => {
    expect(coachLiveSetSummary(Array.from({ length: count }, () => null))).toBe(`${count} ${noun}`)
  })
})
