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
    expect(storage.get('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('list')
  })

  it('keeps trainer and client choices private for the same subject', () => {
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'list')
    setBodyMapDisplayMode('client-1', 'client', 'client-1', 'real')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('list')
    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it('migrates the old client preference but ignores a legacy trainer gender', () => {
    storage.set('fit.bodyMapAppearance.client.client-1', 'neutral')
    storage.set('fit.bodyMapAppearance.trainer.trainer-1', 'female')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('list')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'male')).toBe('real')
  })

  it.each(['neutral', 'scheme'])('preserves the legacy trainer %s choice as a list', (stored) => {
    storage.set('fit.bodyMapAppearance.trainer.trainer-1', stored)

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('list')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-2', 'male')).toBe('list')
  })

  it('does not replace a newer trainer preference with a legacy list choice', () => {
    storage.set('fit.bodyMapDisplay.trainer.trainer-1.account', 'real')
    storage.set('fit.bodyMapAppearance.trainer.trainer-1', 'neutral')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', undefined, null)).toBe('real')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('real')
    expect(storage.get('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('real')
  })

  it.each(['scheme', 'neutral'])('migrates stored %s to the list for both roles', (stored) => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', stored)
    storage.set('fit.bodyMapDisplay.trainer.trainer-1.account', stored)

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('list')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-2', 'male')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('list')
  })

  it('keeps an explicit real preference while gender is missing', () => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', 'real')
    storage.set('fit.bodyMapAppearance.client.client-1', 'neutral')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', null)).toBe('list')
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('real')
    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it('does not infer gender from a legacy appearance preference', () => {
    storage.set('fit.bodyMapAppearance.client.client-1', 'male')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', null)).toBe('list')
    expect(storage.has('fit.bodyMapDisplay.client.client-1.client-1')).toBe(false)
    expect(resolveBodyFigureVariant(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female'), 'female')).toBe('female')
  })

  it('keeps the retired scheme on the list when preference migration cannot be saved', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'scheme',
      setItem: () => { throw new Error('Storage blocked') },
    })

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('list')
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
