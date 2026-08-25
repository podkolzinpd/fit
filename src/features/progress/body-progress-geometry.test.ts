import { describe, expect, it } from 'vitest'
import { bodyFigureVariant, bodyFigureViewBox, bodyZoneShapes, bodyZoneSides } from './body-progress-geometry'

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

  it('separates front and back shapes without changing their image coordinates', () => {
    expect(bodyZoneShapes('female', 'arms', 'front').every((shape) => shape.cx < 476)).toBe(true)
    expect(bodyZoneShapes('female', 'arms', 'back').every((shape) => shape.cx >= 476)).toBe(true)
    expect(bodyZoneSides('male', 'chest')).toEqual(['front'])
    expect(bodyZoneSides('male', 'upper_back')).toEqual(['back'])
    expect(bodyZoneSides('male', 'arms')).toEqual(['front', 'back'])
    expect(bodyFigureViewBox('front')).toBe('0 0 476 1000')
    expect(bodyFigureViewBox('back')).toBe('476 0 476 1000')
  })
})
