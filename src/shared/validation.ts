import { z } from 'zod'

export const clientSchema = z.object({
  fullName: z.string().trim().min(2, 'Введите имя'),
  gender: z.enum(['male', 'female']),
  ageYears: z.coerce.number().int().min(1).max(119),
  heightCm: z.coerce.number().positive().max(259),
  goal: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(5000).optional(),
  initialWeightKg: z.coerce.number().positive().max(1000).optional(),
})

export const progressSchema = z.object({
  recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.coerce.number().positive().max(1000).optional(),
  chestCm: z.coerce.number().positive().max(1000).optional(),
  waistCm: z.coerce.number().positive().max(1000).optional(),
  hipCm: z.coerce.number().positive().max(1000).optional(),
}).refine((value) => [value.weightKg, value.chestCm, value.waistCm, value.hipCm].some(Boolean), {
  message: 'Добавьте хотя бы один замер',
})
