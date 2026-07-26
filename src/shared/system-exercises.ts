import type { ExerciseSnapshot, MuscleGroup } from './domain'
import { IMPORTED_EXERCISES } from './system-exercises.generated'
import { BASE_EXERCISES } from './system-exercises.base.generated'

export const SYSTEM_EXERCISE_CATALOG_VERSION = 1

// Форма импортированного упражнения (генерируется scripts/import-exercises.mjs).
export interface ImportedExercise extends ExerciseSnapshot {
  source: 'system'
  equipment: string
  equipmentRef: string
  primaryMuscleDetail: string
  secondaryMuscles: string[]
  level: string | null
  imageUrl: string
  instructions: string[]
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio',
]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  legs: 'Ноги',
  chest: 'Грудь',
  back: 'Спина',
  shoulders: 'Плечи',
  arms: 'Руки',
  core: 'Кор',
  cardio: 'Кардио',
  other: 'Другое',
}

export const SYSTEM_EXERCISES = [
  { source: 'system', ref: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'front-squat', name: 'Фронтальный присед', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'leg-press', name: 'Жим ногами', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'stiff-leg-deadlift', name: 'Становая тяга на прямых ногах', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'lunges', name: 'Выпады', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'bulgarian-split-squat', name: 'Болгарский присед', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'leg-curl', name: 'Сгибание ног', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'leg-extension', name: 'Разгибание ног', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'calf-raise', name: 'Подъём на носки', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'hyperextension', name: 'Гиперэкстензия', muscleGroup: 'legs', inputKind: 'strength' },

  { source: 'system', ref: 'bench-press', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-bench-press', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'incline-bench-press', name: 'Жим на наклонной скамье', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-fly', name: 'Разводка гантелей', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'push-ups', name: 'Отжимания', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'dips', name: 'Отжимания на брусьях', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'pec-deck', name: 'Сведение в тренажёре (бабочка)', muscleGroup: 'chest', inputKind: 'strength' },

  { source: 'system', ref: 'barbell-row', name: 'Тяга штанги в наклоне', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-row', name: 'Тяга гантели в наклоне', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'pull-ups', name: 'Подтягивания', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'seated-cable-row', name: 'Тяга нижнего блока', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'deadlift', name: 'Становая тяга', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'good-morning', name: 'Гудмонинг', muscleGroup: 'back', inputKind: 'strength' },

  { source: 'system', ref: 'overhead-press', name: 'Жим штанги стоя', muscleGroup: 'shoulders', inputKind: 'strength' },
  { source: 'system', ref: 'seated-dumbbell-press', name: 'Жим гантелей сидя', muscleGroup: 'shoulders', inputKind: 'strength' },
  { source: 'system', ref: 'lateral-raise', name: 'Разводка в стороны', muscleGroup: 'shoulders', inputKind: 'strength' },
  { source: 'system', ref: 'rear-delt-fly', name: 'Разводка в наклоне (задняя дельта)', muscleGroup: 'shoulders', inputKind: 'strength' },
  { source: 'system', ref: 'upright-row', name: 'Тяга к подбородку', muscleGroup: 'shoulders', inputKind: 'strength' },
  { source: 'system', ref: 'shrugs', name: 'Шраги', muscleGroup: 'shoulders', inputKind: 'strength' },

  { source: 'system', ref: 'biceps-curl', name: 'Сгибание на бицепс', muscleGroup: 'arms', inputKind: 'strength' },
  { source: 'system', ref: 'hammer-curl', name: 'Молоток', muscleGroup: 'arms', inputKind: 'strength' },
  { source: 'system', ref: 'barbell-curl', name: 'Подъём штанги на бицепс', muscleGroup: 'arms', inputKind: 'strength' },
  { source: 'system', ref: 'french-press', name: 'Французский жим', muscleGroup: 'arms', inputKind: 'strength' },
  { source: 'system', ref: 'triceps-pushdown', name: 'Разгибание на трицепс', muscleGroup: 'arms', inputKind: 'strength' },
  { source: 'system', ref: 'close-grip-push-up', name: 'Отжимания узким хватом', muscleGroup: 'arms', inputKind: 'strength' },

  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'reps' },
  { source: 'system', ref: 'crunches', name: 'Скручивания', muscleGroup: 'core', inputKind: 'strength' },
  { source: 'system', ref: 'leg-raise', name: 'Подъём ног', muscleGroup: 'core', inputKind: 'strength' },
  { source: 'system', ref: 'russian-twist', name: 'Русский твист', muscleGroup: 'core', inputKind: 'strength' },
  { source: 'system', ref: 'side-plank', name: 'Боковая планка', muscleGroup: 'core', inputKind: 'reps' },

  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'stationary-bike', name: 'Велотренажёр', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'elliptical', name: 'Эллипс', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'rowing-machine', name: 'Гребной тренажёр', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'walking', name: 'Ходьба', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'jump-rope', name: 'Прыжки со скакалкой', muscleGroup: 'cardio', inputKind: 'reps' },
  { source: 'system', ref: 'burpees', name: 'Берпи', muscleGroup: 'cardio', inputKind: 'reps' },
] as const satisfies readonly ExerciseSnapshot[]

// Полный системный каталог: рукописные базовые + импортированные из открытой
// базы. Импортированные добавляются в конец, дубли по ref отсекаются.
const SEEN_REFS = new Set<string>(SYSTEM_EXERCISES.map((exercise) => exercise.ref))
// Каталог: обогащённые базовые (картинки/оборудование/мышцы/инструкции) +
// импортированные. SYSTEM_EXERCISES (рукописный литерал) остаётся источником
// ref/name/muscleGroup/inputKind для генератора базовых и для тестов.
export const SYSTEM_EXERCISE_CATALOG: readonly ExerciseSnapshot[] = [
  ...BASE_EXERCISES,
  ...IMPORTED_EXERCISES.filter((exercise) => !SEEN_REFS.has(exercise.ref)),
]
