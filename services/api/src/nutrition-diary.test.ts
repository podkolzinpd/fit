import { describe, expect, it } from 'vitest'
import { isNutritionDate, nutritionTotals, readNutritionDraft, readNutritionPilot } from './nutrition-diary.js'

const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-00000000000${index}`)
const draft = { id: ids[0], expectedVersion: 0, day: '2026-10-10', meal: 'lunch', grams: 150,
  food: { kind: 'manual', name: 'Курица с рисом', basis: '100g', calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 } }

describe('nutrition pilot is independently fail-closed', () => {
  it('requires exactly three clients and two distinct trainers', () => {
    expect(readNutritionPilot('true', ids.slice(0, 3).join(','), ids.slice(3).join(','))).toEqual({ clients: ids.slice(0, 3), trainers: ids.slice(3) })
    expect(readNutritionPilot('true', ids.slice(0, 2).join(','), ids.slice(3).join(','))).toBeNull()
    expect(readNutritionPilot('true', ids.slice(0, 3).join(','), [ids[0], ids[4]].join(','))).toBeNull()
    expect(readNutritionPilot('true', 'invalid', 'invalid')).toBeNull()
    expect(readNutritionPilot(undefined, ids.slice(0, 3).join(','), ids.slice(3).join(','))).toBeNull()
    expect(readNutritionPilot('TRUE', ids.slice(0, 3).join(','), ids.slice(3).join(','))).toBeNull()
  })
})
describe('nutrition entry validation and calculation', () => {
  it('preserves missing macros and scales only the chosen grams', () => {
    expect(nutritionTotals({ calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 }, '100g', 150))
      .toEqual({ calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 })
    expect(nutritionTotals({ calories: 100, protein: null, fat: null, carbs: null }, 'portion', null))
      .toEqual({ calories: 100, protein: null, fat: null, carbs: null })
  })
  it('accepts real local calendar dates only', () => {
    expect(isNutritionDate('2024-02-29')).toBe(true)
    expect(isNutritionDate('2026-02-29')).toBe(false)
    expect(isNutritionDate('2026-10-10T10:00Z')).toBe(false)
    expect(isNutritionDate('2026-13-01')).toBe(false)
  })
  it('accepts a bounded draft and rejects invalid versions/quantities/macros', () => {
    expect(readNutritionDraft(draft)).toEqual(draft)
    for (const patch of [{ id: 'other' }, { expectedVersion: -1 }, { grams: 0 }, { grams: 20001 }, { grams: '150' }, { meal: 'other' }]) {
      expect(readNutritionDraft({ ...draft, ...patch })).toBeUndefined()
    }
    for (const patch of [{ calories: NaN }, { calories: -1 }, { protein: 101 }, { fat: '4.2' }, { carbs: undefined }]) {
      expect(readNutritionDraft({ ...draft, food: { ...draft.food, ...patch } })).toBeUndefined()
    }
  })
  it('does not accept owner or trainer IDs as authority', () => {
    expect(readNutritionDraft({ ...draft, ownerId: ids[4], trainerId: ids[3] })).toEqual(draft)
  })
})
