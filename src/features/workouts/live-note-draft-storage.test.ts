import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acknowledgePendingLiveNote, readPendingLiveNotes, writePendingLiveNote } from './live-note-draft-storage'

describe('pending coach Live notes', () => {
  let values: Map<string, string>
  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('restores text and an intentional deletion only in their account/workout', () => {
    writePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Контролировать дыхание')
    writePendingLiveNote('coach-a', 'workout-a', 'exercise-b', '')
    expect([...readPendingLiveNotes('coach-a', 'workout-a')]).toEqual([['exercise-a', 'Контролировать дыхание'], ['exercise-b', '']])
    expect(readPendingLiveNotes('coach-b', 'workout-a').size).toBe(0)
    expect(readPendingLiveNotes('coach-a', 'workout-b').size).toBe(0)
  })
  it('acknowledges only the accepted version without discarding other notes', () => {
    writePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Первая версия')
    writePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Новая версия')
    writePendingLiveNote('coach-a', 'workout-a', 'exercise-b', '')
    acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Первая версия')
    expect(readPendingLiveNotes('coach-a', 'workout-a').get('exercise-a')).toBe('Новая версия')
    acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Новая версия')
    expect([...readPendingLiveNotes('coach-a', 'workout-a')]).toEqual([['exercise-b', '']])
    acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-b', '')
    expect(values.size).toBe(0)
  })
  it('ignores malformed, non-string and over-limit stored values', () => {
    const key = 'fit.live-note-drafts.coach-a.workout-a'
    for (const raw of ['[1]', 'null', '{broken']) {
      values.set(key, raw)
      expect(readPendingLiveNotes('coach-a', 'workout-a').size).toBe(0)
    }
    values.set(key, JSON.stringify({ valid: 'Текст', number: 5, tooLong: 'a'.repeat(5001) }))
    expect([...readPendingLiveNotes('coach-a', 'workout-a')]).toEqual([['valid', 'Текст']])
  })
  it('tolerates storage denied by the browser', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(readPendingLiveNotes('coach-a', 'workout-a').size).toBe(0)
    expect(() => writePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Текст')).not.toThrow()
    expect(() => acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Текст')).not.toThrow()
    vi.stubGlobal('localStorage', {
      getItem: () => '{"exercise-a":"Текст","exercise-b":"Другой"}',
      setItem: () => { throw new Error('quota') },
    })
    expect(() => acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Текст')).not.toThrow()
    vi.stubGlobal('localStorage', {
      getItem: () => '{"exercise-a":"Текст"}',
      removeItem: () => { throw new Error('denied') },
    })
    expect(() => acknowledgePendingLiveNote('coach-a', 'workout-a', 'exercise-a', 'Текст')).not.toThrow()
  })
})
