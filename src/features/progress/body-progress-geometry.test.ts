import { describe, expect, it } from 'vitest'
import {
  bodyFigureCanvas,
  bodyFigureClipBox,
  bodyFigureVariant,
  bodyFigureViewBox,
  bodyZoneShapes,
  bodyZoneSides,
} from './body-progress-geometry'

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

  it.each(['male', 'female'] as const)('uses calibrated contours, not ellipse overlays, for every %s photo zone', (variant) => {
    const zones = ['chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'core',
      'upper_back', 'lower_back', 'glutes', 'quadriceps', 'hamstrings', 'calves',
      'inner_thigh', 'outer_thigh', 'arms', 'legs', 'back'] as const
    for (const zone of zones) {
      const shapes = bodyZoneShapes(variant, zone)
      expect(shapes.length).toBeGreaterThan(0)
      for (const shape of shapes) {
        expect(shape.path).toMatch(/^M.+Z$/)
        expect(shape.rotate).toBeUndefined()
        expect(shape.cx).toBeGreaterThan(0)
        expect(shape.cx).toBeLessThan(952)
        expect(shape.cy).toBeGreaterThan(0)
        expect(shape.cy).toBeLessThan(1000)
      }
    }
    expect(bodyZoneSides(variant, 'shoulders')).toEqual(['front', 'back'])
    expect(bodyZoneSides(variant, 'forearms')).toEqual(['front', 'back'])
  })

  it.each(['male', 'female'] as const)('reuses exact calibrated contours for broad %s groups', (variant) => {
    expect(bodyZoneShapes(variant, 'arms')).toEqual([
      ...bodyZoneShapes(variant, 'biceps'), ...bodyZoneShapes(variant, 'triceps'), ...bodyZoneShapes(variant, 'forearms'),
    ])
    expect(bodyZoneShapes(variant, 'legs')).toEqual([
      ...bodyZoneShapes(variant, 'quadriceps'), ...bodyZoneShapes(variant, 'hamstrings'), ...bodyZoneShapes(variant, 'calves'),
    ])
    expect(bodyZoneShapes(variant, 'back')).toEqual([
      ...bodyZoneShapes(variant, 'upper_back'), ...bodyZoneShapes(variant, 'lower_back'),
    ])
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
    expect(bodyFigureViewBox('neutral', 'front')).toBe('226 0 500 1052')
    expect(bodyFigureViewBox('neutral', 'back')).toBe('768 0 500 1052')
    expect(bodyFigureClipBox('male', 'front')).toEqual({ x: 0, y: 0, width: 476, height: 1000 })
    expect(bodyFigureClipBox('female', 'back')).toEqual({ x: 476, y: 0, width: 476, height: 1000 })
    expect(bodyFigureClipBox('neutral', 'front')).toEqual({ x: 226, y: 0, width: 500, height: 1052 })
    expect(bodyFigureClipBox('neutral', 'back')).toEqual({ x: 768, y: 0, width: 500, height: 1052 })
    expect(bodyFigureCanvas('neutral')).toEqual({ width: 1495, height: 1052 })
    expect(bodyZoneShapes('neutral', 'chest', 'front').every((shape) => shape.cx < 747.5)).toBe(true)
    expect(bodyZoneShapes('neutral', 'upper_back', 'back').every((shape) => shape.cx >= 747.5)).toBe(true)
  })
})
