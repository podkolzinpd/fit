import { describe, expect, it } from 'vitest'
import { bodyFigureClipBox, bodyFigureVariant, bodyFigureViewBox, bodyZoneShapes, bodyZoneSides } from './body-progress-geometry'

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

  it('keeps shoulder masks on the deltoids instead of the chest', () => {
    const male = bodyZoneShapes('male', 'shoulders', 'front')
    const female = bodyZoneShapes('female', 'shoulders', 'front')
    expect(male.map((shape) => shape.cx)).toEqual([168, 392])
    expect(female.map((shape) => shape.cx)).toEqual([142, 352])
    expect(Math.max(...female.map((shape) => shape.rx))).toBeLessThanOrEqual(26)
  })

  it('separates upper-back muscles from the centre of the shirt', () => {
    for (const variant of ['male', 'female'] as const) {
      const sideShapes = bodyZoneShapes(variant, 'upper_back', 'back').filter((shape) => shape.cy > 280)
      expect(sideShapes).toHaveLength(2)
      expect(sideShapes[1]!.cx - sideShapes[0]!.cx).toBeGreaterThan(120)
      expect(Math.max(...sideShapes.map((shape) => shape.rx))).toBeLessThanOrEqual(37)
    }
  })

  it('separates front and back shapes without changing their image coordinates', () => {
    expect(bodyZoneShapes('female', 'arms', 'front').every((shape) => shape.cx < 476)).toBe(true)
    expect(bodyZoneShapes('female', 'arms', 'back').every((shape) => shape.cx >= 476)).toBe(true)
    expect(bodyZoneSides('male', 'chest')).toEqual(['front'])
    expect(bodyZoneSides('male', 'upper_back')).toEqual(['back'])
    expect(bodyZoneSides('male', 'arms')).toEqual(['front', 'back'])
    expect(bodyFigureViewBox('male', 'front')).toBe('42 0 476 1000')
    expect(bodyFigureViewBox('male', 'back')).toBe('441 0 476 1000')
    expect(bodyFigureViewBox('female', 'front')).toBe('9 0 476 1000')
    expect(bodyFigureViewBox('female', 'back')).toBe('475 0 476 1000')
    expect(bodyFigureViewBox('neutral', 'front')).toBe('0 0 476 1000')
    expect(bodyFigureViewBox('neutral', 'back')).toBe('476 0 476 1000')
    expect(bodyFigureClipBox('front')).toEqual({ x: 0, y: 0, width: 476, height: 1000 })
    expect(bodyFigureClipBox('back')).toEqual({ x: 476, y: 0, width: 476, height: 1000 })
  })
})
