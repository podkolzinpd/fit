import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allowedBodyMapAppearances,
  defaultBodyMapAppearance,
  getBodyMapAppearance,
  setBodyMapAppearance,
} from './body-map-appearance'

describe('body map appearance', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('defaults a client to the figure matching their gender', () => {
    expect(defaultBodyMapAppearance('client', 'female')).toBe('female')
    expect(defaultBodyMapAppearance('client', 'male')).toBe('male')
    expect(allowedBodyMapAppearances('client', 'female')).toEqual(['female', 'neutral'])
  })

  it('does not accept a realistic figure that conflicts with the client gender', () => {
    storage.set('fit.bodyMapAppearance.client.client-1', 'male')
    expect(getBodyMapAppearance('client-1', 'client', 'female')).toBe('female')
  })

  it('keeps trainer and client choices private even for the same user id', () => {
    setBodyMapAppearance('shared-id', 'trainer', 'male')
    setBodyMapAppearance('shared-id', 'client', 'neutral')

    expect(getBodyMapAppearance('shared-id', 'trainer', null)).toBe('male')
    expect(getBodyMapAppearance('shared-id', 'client', 'female')).toBe('neutral')
  })

  it('uses the neutral scheme when the viewer has not made a choice and gender is unknown', () => {
    expect(defaultBodyMapAppearance('trainer', null)).toBe('neutral')
    expect(defaultBodyMapAppearance('client', null)).toBe('neutral')
    expect(allowedBodyMapAppearances('client', null)).toEqual(['neutral'])
  })
})
