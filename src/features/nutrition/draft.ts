import { z } from 'zod'
import { nutritionEntrySchema, nutritionFoodSchema } from '../../shared/nutrition'

export const nutritionFormSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().nonnegative(),
  date: z.iso.date(), meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), grams: z.string().max(20),
  manual: z.boolean(), per100: z.boolean(), name: z.string().max(160), calories: z.string().max(20),
  protein: z.string().max(20), fat: z.string().max(20), carbs: z.string().max(20),
  search: z.string().max(120), selection: z.union([nutritionEntrySchema, nutritionFoodSchema]).nullable() })
export type NutritionForm = z.infer<typeof nutritionFormSchema>
const prefix = 'fit.nutrition-draft.'
export function readNutritionForm(userId: string, key: string): NutritionForm | null {
  try {
    const raw = sessionStorage.getItem(`${prefix}${userId}.${key}`)
    if (!raw || raw.length > 12000) return null
    return nutritionFormSchema.parse(JSON.parse(raw))
  } catch { return null }
}
export function storeNutritionForm(userId: string, key: string, values: unknown): boolean {
  try {
    sessionStorage.setItem(`${prefix}${userId}.${key}`, JSON.stringify(nutritionFormSchema.parse(values)))
    return true
  } catch { return false }
}
export function removeNutritionForm(userId: string, key: string) {
  try { sessionStorage.removeItem(`${prefix}${userId}.${key}`) } catch { /* The in-memory form remains usable. */ }
}
export function clearNutritionForms() {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
    keys.forEach((key) => { if (key?.startsWith(prefix)) sessionStorage.removeItem(key) })
  } catch { /* Storage may be unavailable in private browsing. */ }
}
export function nutritionDecimal(text: string): number | null {
  if (!/^(?:\d+)(?:[.,]\d{1,4})?$/.test(text.trim())) return null
  const value = Number(text.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
