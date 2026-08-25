import { describe, expect, it } from 'vitest'
import { bodyFigureVariant, bodyZoneShapes } from './body-progress-geometry'

describe('body progress geometry', () => {
  it('uses a deterministic neutral figure when gender is missing', () => {
    expect(bodyFigureVariant(null)).toBe('neutral')
    expect(bodyFigureVariant('female')).toBe('female')
    expect(bodyFigureVariant('male')).toBe('male')
  })

  it.each(['male', 'female', 'neutral'] as const)('has distinct interactive geometry for %s', (variant) => {
    expect(bodyZoneShapes(variant, 'chest')).not.toEqual(bodyZoneShapes(variant, 'shoulders'))
    expect(bodyZoneShapes(variant, 'biceps').length).toBeGreaterThan(1)
    expect(bodyZoneShapes(variant, 'calves').length).toBe(2)
  })

  it('keeps male and female masks independently calibrated', () => {
    expect(bodyZoneShapes('male', 'upper_back')).not.toEqual(bodyZoneShapes('female', 'upper_back'))
  })
})
