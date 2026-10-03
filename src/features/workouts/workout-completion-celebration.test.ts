import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { celebrationCopy, completionPhrases, selectCompletionCelebration } from './workout-completion-celebration'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('completion celebration rotation', () => {
  it('keeps each workout stable while avoiding consecutive icons and exhausting the phrase pool', () => {
    const first = selectCompletionCelebration('athlete', 'first')
    const selections = [first]
    for (let i = 1; i < completionPhrases.length; i++) selections.push(selectCompletionCelebration('athlete', `workout-${i}`))
    expect(new Set(selections.map((item) => item.phrase)).size).toBe(completionPhrases.length)
    selections.slice(1).forEach((item, i) => expect(item.icon).not.toBe(selections[i]!.icon))
    expect(selectCompletionCelebration('athlete', 'first')).toEqual(first)
    const next = selectCompletionCelebration('athlete', 'next-cycle')
    expect(next.phrase).not.toBe(selections.at(-1)!.phrase)
    expect(next.icon).not.toBe(selections.at(-1)!.icon)
  })

  it('keeps accounts separate and safely recovers malformed local data', () => {
    localStorage.setItem('fit.completion-celebrations.v1:a', '{invalid')
    selectCompletionCelebration('a', 'same-workout')
    selectCompletionCelebration('b', 'same-workout')
    expect(JSON.parse(localStorage.getItem('fit.completion-celebrations.v1:a')!)).toHaveProperty('entries.same-workout')
    expect(JSON.parse(localStorage.getItem('fit.completion-celebrations.v1:b')!)).toHaveProperty('entries.same-workout')
  })

  it('keeps deterministic decoration when storage is blocked or full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(selectCompletionCelebration('a', 'workout')).toEqual(selectCompletionCelebration('a', 'workout'))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(selectCompletionCelebration('a', 'workout')).toEqual(selectCompletionCelebration('a', 'workout'))
  })

  it('uses explicit grammatical forms with neutral fallback', () => {
    const selected = { phrase: 5, icon: 'fist' as const }
    expect(celebrationCopy(selected, 'female').title).toBe('Вот это ты выдала!')
    expect(celebrationCopy(selected, 'male').title).toBe('Вот это ты выдал!')
    expect(celebrationCopy(selected, null).title).toBe('Вот это сила!')
  })
})
