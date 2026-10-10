import { z } from 'zod'
import type { LocalDate } from './local-date'

export const nutritionValuesSchema = z.object({ calories: z.number().finite().nonnegative(),
  protein: z.number().finite().nonnegative().nullable(), fat: z.number().finite().nonnegative().nullable(),
  carbs: z.number().finite().nonnegative().nullable() })
export const nutritionFoodSchema = nutritionValuesSchema.extend({ id: z.uuid(), name: z.string().min(1).max(160), basis: z.literal('100g') })
export const nutritionEntrySchema = nutritionValuesSchema.extend({ id: z.uuid(), day: z.iso.date(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), name: z.string().min(1).max(160),
  basis: z.enum(['100g', 'portion']), grams: z.number().positive().nullable(), totals: nutritionValuesSchema,
  version: z.number().int().positive(), updatedAt: z.iso.datetime({ offset: true }), deletedAt: z.iso.datetime({ offset: true }).nullable() })
export const nutritionDaySchema = z.discriminatedUnion('access', [
  z.object({ access: z.literal('locked'), entries: z.array(nutritionEntrySchema).max(0), totals: z.null() }),
  z.object({ access: z.literal('granted'), entries: z.array(nutritionEntrySchema), totals: nutritionValuesSchema,
    lastRecordedDay: z.iso.date().nullable().optional() }),
])
export const nutritionConnectionSchema = z.object({ clientId: z.uuid(), trainerId: z.uuid(), name: z.string(),
  connectionStartedAt: z.iso.datetime({ offset: true }), granted: z.boolean() })
export type NutritionValues = z.infer<typeof nutritionValuesSchema>
export type NutritionFood = z.infer<typeof nutritionFoodSchema>
export type NutritionEntry = z.infer<typeof nutritionEntrySchema>
export type NutritionDay = z.infer<typeof nutritionDaySchema>
export type NutritionConnection = z.infer<typeof nutritionConnectionSchema>
export type NutritionMeal = NutritionEntry['meal']
export type NutritionSelection = { kind: 'catalog'; id: string } | { kind: 'recent'; entryId: string }
  | ({ kind: 'manual'; name: string; basis: '100g' | 'portion' } & NutritionValues)
export interface NutritionDraft { id: string; expectedVersion: number; day: LocalDate; meal: NutritionMeal;
  grams: number | null; food: NutritionSelection }
export const NUTRITION_MEALS: Record<NutritionMeal, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' }
export function nutritionNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}
export function scaledNutrition(values: NutritionValues, basis: '100g' | 'portion', grams: number | null): NutritionValues {
  const ratio = basis === '100g' ? (grams ?? 0) / 100 : 1
  const scale = (value: number | null) => value === null ? null : Math.round(value * ratio * 10) / 10
  return { calories: scale(values.calories) ?? 0, protein: scale(values.protein), fat: scale(values.fat), carbs: scale(values.carbs) }
}
