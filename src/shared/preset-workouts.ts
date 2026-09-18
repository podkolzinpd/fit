import type { ExerciseSnapshot, WorkoutSetDraft } from './domain'
import type { ParsedWorkoutExercise } from '../features/workouts/quick-workout-entry'

export interface PresetWorkoutSetTemplate {
  reps?: number
  durationSec?: number
  distanceKm?: number
}

export interface PresetWorkoutExerciseTemplate {
  ref: string
  sets: PresetWorkoutSetTemplate[]
}

export interface PresetWorkoutTemplate {
  id: string
  title: string
  description: string
  estimatedDurationMin: number
  exercises: PresetWorkoutExerciseTemplate[]
}

function sets(count: number, values: PresetWorkoutSetTemplate): PresetWorkoutSetTemplate[] {
  return Array.from({ length: count }, () => values)
}

export const PRESET_WORKOUTS: readonly PresetWorkoutTemplate[] = [
  {
    id: 'full-body-no-equipment',
    title: 'Всё тело без инвентаря',
    description: 'Базовая тренировка на всё тело для первого раза — только вес своего тела.',
    estimatedDurationMin: 20,
    exercises: [
      { ref: 'joint-warmup', sets: sets(1, { durationSec: 180 }) },
      { ref: 'push-ups', sets: sets(3, { reps: 8 }) },
      { ref: 'lunges', sets: sets(3, { reps: 10 }) },
      { ref: 'plank', sets: sets(3, { durationSec: 30 }) },
      { ref: 'crunches', sets: sets(3, { reps: 15 }) },
    ],
  },
  {
    id: 'cardio-starter',
    title: 'Кардио для начала',
    description: 'Лёгкая кардиотренировка, чтобы разогнать пульс и попробовать формат.',
    estimatedDurationMin: 20,
    exercises: [
      { ref: 'joint-warmup', sets: sets(1, { durationSec: 180 }) },
      { ref: 'jump-rope', sets: sets(3, { reps: 40 }) },
      { ref: 'stationary-bike', sets: sets(1, { distanceKm: 3 }) },
      { ref: 'burpees', sets: sets(3, { reps: 8 }) },
    ],
  },
  {
    id: 'stretch-mobility',
    title: 'Растяжка и мобильность',
    description: 'Мягкая растяжка и суставная гимнастика — подходит после долгого перерыва.',
    estimatedDurationMin: 15,
    exercises: [
      { ref: 'cat-cow', sets: sets(1, { durationSec: 60 }) },
      { ref: 'thoracic-mobility', sets: sets(1, { durationSec: 60 }) },
      { ref: 'shoulder-mobility', sets: sets(1, { durationSec: 60 }) },
      { ref: 'hip-mobility', sets: sets(1, { durationSec: 60 }) },
      { ref: 'ankle-mobility', sets: sets(1, { durationSec: 60 }) },
      { ref: 'dynamic-hamstring-stretch', sets: sets(1, { durationSec: 60 }) },
    ],
  },
  {
    id: 'core-basics',
    title: 'Кор без инвентаря',
    description: 'Базовая тренировка на мышцы кора — без оборудования, для новичка.',
    estimatedDurationMin: 15,
    exercises: [
      { ref: 'joint-warmup', sets: sets(1, { durationSec: 120 }) },
      { ref: 'plank', sets: sets(3, { durationSec: 30 }) },
      { ref: 'side-plank', sets: sets(2, { durationSec: 20 }) },
      { ref: 'crunches', sets: sets(3, { reps: 15 }) },
      { ref: 'leg-raise', sets: sets(3, { reps: 12 }) },
      { ref: 'russian-twist', sets: sets(3, { reps: 20 }) },
    ],
  },
]

/**
 * Резолвит ref-ы шаблона по живому каталогу упражнений, а не статическому
 * снэпшоту — сохранённая тренировка должна нести актуальные name/muscleGroup/
 * inputKind (см. TodayPage draftExercise(), который спредит item.exercise целиком).
 */
export function presetWorkoutToParsedItems(
  preset: PresetWorkoutTemplate,
  catalog: readonly ExerciseSnapshot[],
): ParsedWorkoutExercise[] {
  return preset.exercises.map((item) => {
    const exercise = catalog.find((candidate) => candidate.ref === item.ref)
    if (!exercise) throw new Error(`Preset "${preset.id}" references unknown exercise ref "${item.ref}"`)
    const draftSets: WorkoutSetDraft[] = item.sets.map((set, position) => ({ position, ...set }))
    return { line: exercise.name, exercise, sets: draftSets, hasValues: true }
  })
}
