import { NUTRITION_DRAFT_PREFIX } from '../../shared/nutrition-session'
import type { NutritionEntry, NutritionFood } from '../../shared/nutrition'
export { clearNutritionForms } from '../../shared/nutrition-session'

export type NutritionForm = {
  id: string
  expectedVersion: number
  date: string
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  grams: string
  manual: boolean
  per100: boolean
  name: string
  calories: string
  protein: string
  fat: string
  carbs: string
  search: string
  selection: NutritionEntry | NutritionFood | null
}

export function removeNutritionForm(userId: string, key: string) {
  try { sessionStorage.removeItem(`${NUTRITION_DRAFT_PREFIX}${userId}.${key}`) } catch { /* The in-memory form remains usable. */ }
}
export function nutritionDecimal(text: string): number | null {
  if (!/^(?:\d+)(?:[.,]\d{1,4})?$/.test(text.trim())) return null
  const value = Number(text.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
