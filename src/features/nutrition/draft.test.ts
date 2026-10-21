import { afterEach, describe, expect, it } from 'vitest'
import { clearNutritionForms, nutritionDecimal, removeNutritionForm } from './draft'
import { nutritionDaySchema, nutritionNumber, scaledNutrition } from '../../shared/nutrition'

const id = 'f00d0000-6010-4000-8000-000000000001'
const entry = {
  id, name: 'Курица с рисом', basis: '100g' as const, calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8,
  day: '2026-10-09', meal: 'dinner' as const, grams: 150, totals: { calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 },
  version: 1, updatedAt: '2026-10-10T00:00:00Z', deletedAt: null,
}
afterEach(() => sessionStorage.clear())
describe('nutrition drafts and snapshot calculations', () => {
  it('removes a legacy draft for the current food form', () => {
    sessionStorage.setItem(`fit.nutrition-draft.${id}.new`, 'legacy')
    removeNutritionForm(id, 'new')
    expect(sessionStorage.getItem(`fit.nutrition-draft.${id}.new`)).toBeNull()
  })
  it('clears only nutrition drafts on logout', () => {
    sessionStorage.setItem(`fit.nutrition-draft.${id}.new`, 'legacy')
    sessionStorage.setItem('another-feature', 'preserve')
    clearNutritionForms()
    expect(sessionStorage.getItem(`fit.nutrition-draft.${id}.new`)).toBeNull()
    expect(sessionStorage.getItem('another-feature')).toBe('preserve')
  })
  it.each(['', '-1', '1e4', 'NaN', 'Infinity', '0.12345', ' 1 5 '])('rejects ambiguous number %s', (value) => {
    expect(nutritionDecimal(value)).toBeNull()
  })
  it('supports Russian decimals, calculates one decimal and preserves unknown macros', () => {
    expect(nutritionDecimal(' 150,5 ')).toBe(150.5)
    expect(nutritionNumber(null)).toBe('—')
    expect(scaledNutrition({ calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 }, '100g', 150))
      .toEqual({ calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 })
    expect(scaledNutrition({ calories: 100, protein: null, fat: null, carbs: null }, 'portion', null).protein).toBeNull()
    expect(nutritionDaySchema.safeParse({ access: 'locked', entries: [entry], totals: null }).success).toBe(false)
  })
})
