import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultBodyMapDisplayMode,
  getBodyMapDisplayMode,
  resolveBodyFigureVariant,
  setBodyMapDisplayMode,
} from './body-map-appearance'

describe('body map display', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('dispatchEvent', vi.fn())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows the real figure matching the subject gender by default', () => {
    expect(defaultBodyMapDisplayMode('female')).toBe('real')
    expect(defaultBodyMapDisplayMode('male')).toBe('real')
    expect(resolveBodyFigureVariant('real', 'female')).toBe('female')
    expect(resolveBodyFigureVariant('real', 'male')).toBe('male')
  })

  it('uses the list fallback when the subject gender is unknown', () => {
    expect(defaultBodyMapDisplayMode(null)).toBe('list')
    expect(resolveBodyFigureVariant('real', null)).toBe('neutral')
    expect(resolveBodyFigureVariant('list', 'female')).toBe('neutral')
  })

  it('uses one trainer account choice across clients', () => {
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'list')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('list')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-2', 'male')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.v2.trainer.trainer-1.account')).toBe('list')
  })

  it('keeps trainer and client choices private for the same subject', () => {
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'list')
    setBodyMapDisplayMode('client-1', 'client', 'client-1', 'real')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('list')
    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it.each(['list', 'scheme', 'neutral'])('shows the matching figure despite the old %s choice', (stored) => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', stored)
    storage.set('fit.bodyMapDisplay.trainer.trainer-1.account', stored)
    storage.set('fit.bodyMapAppearance.client.client-1', stored)
    storage.set('fit.bodyMapAppearance.trainer.trainer-1', stored)

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'male')).toBe('real')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('real')
    expect(storage.has('fit.bodyMapDisplay.v2.client.client-1.client-1')).toBe(false)
    expect(storage.has('fit.bodyMapDisplay.v2.trainer.trainer-1.account')).toBe(false)
  })

  it('lets both roles explicitly hide the figure after the one-time preference reset', () => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', 'list')
    storage.set('fit.bodyMapDisplay.trainer.trainer-1.account', 'list')

    setBodyMapDisplayMode('client-1', 'client', 'client-1', 'list')
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'list')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'male')).toBe('list')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-2', 'female')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.v2.client.client-1.client-1')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.v2.trainer.trainer-1.account')).toBe('list')
  })

  it('keeps an explicit real preference while gender is missing', () => {
    storage.set('fit.bodyMapDisplay.v2.client.client-1.client-1', 'real')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', null)).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.v2.client.client-1.client-1')).toBe('real')
    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it('does not infer gender from an old appearance preference', () => {
    storage.set('fit.bodyMapAppearance.client.client-1', 'male')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', null)).toBe('list')
    expect(storage.has('fit.bodyMapDisplay.v2.client.client-1.client-1')).toBe(false)
    expect(resolveBodyFigureVariant(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female'), 'female')).toBe('female')
  })

  it('shows the gender-matched figure when old storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked') },
      setItem: () => { throw new Error('Storage blocked') },
    })

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it('uses a safe list without gender when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked') },
    })

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', null)).toBe('list')
  })

  it('defaults the trainer account to real figures before a preference is saved', () => {
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', undefined, null)).toBe('real')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('real')
  })
})
