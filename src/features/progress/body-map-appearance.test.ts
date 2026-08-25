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

  it('uses the anatomical scheme when the subject gender is unknown', () => {
    expect(defaultBodyMapDisplayMode(null)).toBe('scheme')
    expect(resolveBodyFigureVariant('real', null)).toBe('neutral')
    expect(resolveBodyFigureVariant('scheme', 'female')).toBe('neutral')
  })

  it('keeps trainer choices separate for every client', () => {
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'scheme')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('scheme')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-2', 'male')).toBe('real')
  })

  it('keeps trainer and client choices private for the same subject', () => {
    setBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'scheme')
    setBodyMapDisplayMode('client-1', 'client', 'client-1', 'real')

    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'female')).toBe('scheme')
    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('real')
  })

  it('migrates only the old client preference', () => {
    storage.set('fit.bodyMapAppearance.client.client-1', 'neutral')
    storage.set('fit.bodyMapAppearance.trainer.trainer-1', 'female')

    expect(getBodyMapDisplayMode('client-1', 'client', 'client-1', 'female')).toBe('scheme')
    expect(getBodyMapDisplayMode('trainer-1', 'trainer', 'client-1', 'male')).toBe('real')
  })
})
