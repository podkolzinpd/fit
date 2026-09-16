import type { ExerciseSnapshot } from './domain'
import { VITAL_GYM_PRO_PURPOSES_BY_REF } from './vital-gym-pro.generated'

export type ExercisePurpose = 'warmup' | 'mobility' | 'recovery'

export const EXERCISE_PURPOSES: readonly ExercisePurpose[] = ['warmup', 'mobility', 'recovery']

export const EXERCISE_PURPOSE_LABELS: Record<ExercisePurpose, string> = {
  warmup: 'Разминка',
  mobility: 'Растяжка и мобильность',
  recovery: 'Восстановление',
}

const BASE_PURPOSES_BY_REF: Readonly<Record<string, readonly ExercisePurpose[]>> = {
  'joint-warmup': ['warmup', 'mobility'],
  'shoulder-mobility': ['warmup', 'mobility'],
  'band-external-rotation': ['warmup', 'mobility'],
  'thoracic-mobility': ['warmup', 'mobility'],
  'hip-mobility': ['warmup', 'mobility'],
  'ankle-mobility': ['warmup', 'mobility'],
  'dynamic-hamstring-stretch': ['warmup', 'mobility'],
  'cat-cow': ['warmup', 'mobility'],
}

export function exercisePurposes(exercise: ExerciseSnapshot): readonly ExercisePurpose[] {
  const purposes = BASE_PURPOSES_BY_REF[exercise.ref] ?? VITAL_GYM_PRO_PURPOSES_BY_REF[exercise.ref] ?? []
  return purposes.filter((purpose): purpose is ExercisePurpose => EXERCISE_PURPOSES.includes(purpose as ExercisePurpose))
}

export function canonicalEquipment(equipment?: string): string | undefined {
  if (!equipment) return undefined
  return equipment === 'Своё тело' || equipment === 'Собственный вес' || equipment === 'Без оборудования'
    ? 'Без оборудования'
    : equipment
}
