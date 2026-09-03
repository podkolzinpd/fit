import type { ExerciseSnapshot, MuscleGroup } from './domain'
import { IMPORTED_EXERCISES } from './system-exercises.generated'
import { BASE_EXERCISES } from './system-exercises.base.generated'
import { CATALOG_EXPANSION } from './system-exercises.expansion.generated'
import { VITAL_FREE_PACK_EXERCISES, VITAL_FREE_PACK_MEDIA_BY_REF } from './vital-free-pack'

export const SYSTEM_EXERCISE_CATALOG_VERSION = 8

// Форма импортированного упражнения (генерируется scripts/import-exercises.mjs).
export interface ImportedExercise extends ExerciseSnapshot {
  source: 'system'
  equipment: string
  equipmentRef: string
  primaryMuscleDetail: string
  secondaryMuscles: string[]
  level: string | null
  imageUrl: string
  motionImageUrl: string
  instructions: string[]
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio',
]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  legs: 'Ноги',
  glutes: 'Ягодицы',
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
  { source: 'system', ref: 'hyperextension', name: 'Гиперэкстензия', muscleGroup: 'back', inputKind: 'strength' },

  { source: 'system', ref: 'bench-press', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-bench-press', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'incline-bench-press', name: 'Жим на наклонной скамье', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-fly', name: 'Разводка гантелей', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'push-ups', name: 'Отжимания', muscleGroup: 'chest', inputKind: 'reps' },
  { source: 'system', ref: 'dips', name: 'Отжимания на брусьях', muscleGroup: 'chest', inputKind: 'reps' },
  { source: 'system', ref: 'pec-deck', name: 'Сведение в тренажёре (бабочка)', muscleGroup: 'chest', inputKind: 'strength' },

  { source: 'system', ref: 'barbell-row', name: 'Тяга штанги в наклоне', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'dumbbell-row', name: 'Тяга гантели в наклоне', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'pull-ups', name: 'Подтягивания', muscleGroup: 'back', inputKind: 'reps' },
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
  { source: 'system', ref: 'close-grip-push-up', name: 'Отжимания узким хватом', muscleGroup: 'arms', inputKind: 'reps' },

  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
  { source: 'system', ref: 'crunches', name: 'Скручивания', muscleGroup: 'core', inputKind: 'reps' },
  { source: 'system', ref: 'leg-raise', name: 'Подъём ног', muscleGroup: 'core', inputKind: 'reps' },
  { source: 'system', ref: 'russian-twist', name: 'Русский твист', muscleGroup: 'core', inputKind: 'reps' },
  { source: 'system', ref: 'side-plank', name: 'Боковая планка', muscleGroup: 'core', inputKind: 'duration' },

  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'stationary-bike', name: 'Велотренажёр', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'elliptical', name: 'Эллипс', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'rowing-machine', name: 'Гребной тренажёр', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'walking', name: 'Ходьба', muscleGroup: 'cardio', inputKind: 'distance' },
  { source: 'system', ref: 'jump-rope', name: 'Прыжки со скакалкой', muscleGroup: 'cardio', inputKind: 'reps' },
  { source: 'system', ref: 'burpees', name: 'Берпи', muscleGroup: 'cardio', inputKind: 'reps' },
] as const satisfies readonly ExerciseSnapshot[]

// Протоколы — самостоятельные элементы каталога, а не силовые упражнения с
// условным весом. Это даёт тренеру корректные поля ввода для функциональной
// работы и позволяет сохранить факт без отдельных заметок.
const FUNCTIONAL_PROTOCOLS = [
  { source: 'system', ref: 'interval-bike', name: 'Интервалы на велотренажёре', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-stationary-bike.jpg', equipment: 'Велотренажёр', primaryMuscleDetail: 'Кардио', instructions: ['Укажите время и дистанцию одного интервала.'] },
  { source: 'system', ref: 'interval-rowing', name: 'Интервалы на гребном тренажёре', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-rowing-machine.jpg', equipment: 'Гребной тренажёр', primaryMuscleDetail: 'Кардио', instructions: ['Укажите время и дистанцию одного интервала.'] },
  { source: 'system', ref: 'interval-walking', name: 'Интервальная ходьба', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-walking.jpg', equipment: 'Беговая дорожка', primaryMuscleDetail: 'Кардио', instructions: ['Укажите время и дистанцию одного интервала.'] },
  { source: 'system', ref: 'tabata', name: 'Табата', muscleGroup: 'cardio', inputKind: 'reps', imageUrl: '/exercises/base-burpees.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Кардио', instructions: ['Укажите время рабочего отрезка и число повторов. Отдых и движение добавьте в комментарий к упражнению.'] },
  { source: 'system', ref: 'emom', name: 'EMOM', muscleGroup: 'cardio', inputKind: 'reps', imageUrl: '/exercises/base-burpees.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Кардио', instructions: ['Один подход — одна минута: укажите рабочее время и повторы.'] },
  { source: 'system', ref: 'amrap', name: 'AMRAP', muscleGroup: 'cardio', inputKind: 'reps', imageUrl: '/exercises/base-burpees.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Кардио', instructions: ['Укажите лимит времени и число выполненных повторов или раундов.'] },
  { source: 'system', ref: 'circuit-training', name: 'Круговая тренировка', muscleGroup: 'cardio', inputKind: 'reps', imageUrl: '/exercises/base-burpees.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Кардио', instructions: ['Укажите время круга и число повторов или раундов. Состав круга добавьте в комментарий.'] },
  { source: 'system', ref: 'farmer-carry', name: 'Фермерская прогулка', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-walking.jpg', equipment: 'Гантели или гири', primaryMuscleDetail: 'Кардио', instructions: ['Укажите длительность и дистанцию проходки.'] },
  { source: 'system', ref: 'sled-push', name: 'Толкание саней', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-walking.jpg', equipment: 'Сани', primaryMuscleDetail: 'Кардио', instructions: ['Укажите длительность и дистанцию проходки.'] },
] as const satisfies readonly ExerciseSnapshot[]

// Специальные беговые упражнения остаются отдельными движениями, а варианты
// обычного бега (лёгкий/длительный/темповый/интервальный) используют один ref
// `running`. Так история и прогресс бега не распадаются на искусственные виды.
const RUNNING_DRILLS = [
  { source: 'system', ref: 'running-high-knees', name: 'Бег с высоким подниманием бедра', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-running.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Беговые упражнения', instructions: ['Держите корпус ровно и поднимайте бедро до комфортной высоты. Укажите время и дистанцию отрезка.'] },
  { source: 'system', ref: 'running-butt-kicks', name: 'Бег с захлёстом голени', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-running.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Беговые упражнения', instructions: ['Бегите легко, направляя пятку к ягодице без запрокидывания корпуса. Укажите время и дистанцию.'] },
  { source: 'system', ref: 'running-ankling', name: 'Семенящий бег', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-running.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Беговые упражнения', instructions: ['Делайте короткие частые шаги с активной работой стопы. Укажите время и дистанцию.'] },
  { source: 'system', ref: 'running-bounds', name: 'Беговые прыжки', muscleGroup: 'cardio', inputKind: 'distance', imageUrl: '/exercises/base-running.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Беговые упражнения', instructions: ['Продвигайтесь вперёд упругими прыжками с контролируемым приземлением. Укажите время и дистанцию.'] },
] as const satisfies readonly ExerciseSnapshot[]

export const RUNNING_EXERCISE_REFS: ReadonlySet<string> = new Set([
  'running',
  ...RUNNING_DRILLS.map((exercise) => exercise.ref),
])

// Короткий базовый набор, который тренер может быстро добавить перед основной
// частью тренировки. Мобилити фиксируем временем, а не выдуманными повторами.
export const WARMUP_MOBILITY_REFS = new Set([
  'joint-warmup', 'shoulder-mobility', 'band-external-rotation', 'thoracic-mobility',
  'hip-mobility', 'ankle-mobility', 'dynamic-hamstring-stretch', 'cat-cow',
])

const WARMUP_AND_MOBILITY = [
  { source: 'system', ref: 'joint-warmup', name: 'Суставная разминка', muscleGroup: 'other', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Разминка', instructions: ['Выполните мягкие круговые движения основными суставами без боли. Укажите общее время.'] },
  { source: 'system', ref: 'shoulder-mobility', name: 'Мобилизация плеч', muscleGroup: 'shoulders', inputKind: 'duration', imageUrl: '/exercises/base-jump-rope.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Плечи', instructions: ['Выполните контролируемые движения плечами в комфортной амплитуде. Укажите время работы.'] },
  { source: 'system', ref: 'band-external-rotation', name: 'Внешняя ротация плеча с резинкой', muscleGroup: 'shoulders', inputKind: 'duration', imageUrl: '/exercises/base-jump-rope.jpg', equipment: 'Резина', primaryMuscleDetail: 'Плечи', instructions: ['Держите локоть у корпуса и плавно поверните предплечье наружу. Укажите время работы.'] },
  { source: 'system', ref: 'thoracic-mobility', name: 'Мобилизация грудного отдела', muscleGroup: 'core', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Пресс', instructions: ['Выполняйте мягкие повороты и разгибание грудного отдела, не форсируя амплитуду. Укажите время.'] },
  { source: 'system', ref: 'hip-mobility', name: 'Мобилизация тазобедренных суставов', muscleGroup: 'legs', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Передняя поверхность бедра', instructions: ['Выполняйте контролируемые круговые движения и раскрытие таза. Укажите время работы.'] },
  { source: 'system', ref: 'ankle-mobility', name: 'Мобилизация голеностопа', muscleGroup: 'legs', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Икроножные', instructions: ['Плавно переносите колено над стопой, сохраняя пятку на полу. Укажите время работы.'] },
  { source: 'system', ref: 'dynamic-hamstring-stretch', name: 'Динамическая растяжка задней поверхности бедра', muscleGroup: 'legs', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Задняя поверхность бедра', instructions: ['Двигайтесь плавно в комфортной амплитуде, без пружинящих рывков. Укажите время работы.'] },
  { source: 'system', ref: 'cat-cow', name: 'Кошка-корова', muscleGroup: 'core', inputKind: 'duration', imageUrl: '/exercises/base-walking.jpg', equipment: 'Без оборудования', primaryMuscleDetail: 'Пресс', instructions: ['На четвереньках плавно чередуйте округление и прогиб спины. Укажите время работы.'] },
] as const satisfies readonly ExerciseSnapshot[]

// Точечные дополнения из реальной практики тренеров. Они получают новые ref и
// не заменяют существующие движения, поэтому старые планы и пользовательские
// упражнения продолжают ссылаться на прежние записи без миграции.
const CURATED_CATALOG_ADDITIONS = [
  {
    source: 'system',
    ref: 'smith-single-leg-romanian-deadlift',
    name: 'Румынская тяга на одной ноге в Смите (Тренажёр)',
    muscleGroup: 'glutes',
    inputKind: 'strength',
    equipment: 'Тренажёр Смита',
    equipmentRef: 'machine',
    primaryMuscleDetail: 'Ягодицы',
    secondaryMuscles: ['Задняя поверхность бедра', 'Поясница'],
    level: 'intermediate',
    imageUrl: '/exercises/fedb-smith-machine-stiff-legged-deadlift.jpg',
    motionImageUrl: '/exercises/fedb-smith-machine-stiff-legged-deadlift-end.jpg',
    instructions: [
      'Встаньте боком или лицом к грифу Смита, перенесите вес на опорную ногу.',
      'Отводите таз назад, сохраняя спину нейтральной, а свободную ногу вытянутой назад.',
      'Вернитесь вверх усилием ягодицы опорной ноги и повторите на другую сторону.',
    ],
  },
] as const satisfies readonly ExerciseSnapshot[]

// Полный системный каталог: рукописные базовые + импортированные из открытой
// базы. Импортированные добавляются в конец, дубли по ref отсекаются.
const SEEN_REFS = new Set<string>(SYSTEM_EXERCISES.map((exercise) => exercise.ref))
// Каталог: обогащённые базовые (картинки/оборудование/мышцы/инструкции) +
// импортированные. SYSTEM_EXERCISES (рукописный литерал) остаётся источником
// ref/name/muscleGroup/inputKind для генератора базовых и для тестов.
const SYSTEM_EXERCISE_CATALOG_SOURCE: readonly ExerciseSnapshot[] = [
  ...BASE_EXERCISES,
  ...IMPORTED_EXERCISES
    .filter((exercise) => !SEEN_REFS.has(exercise.ref))
    .map((exercise) => exercise.inputKind === 'strength' && exercise.equipmentRef === 'body only'
      ? { ...exercise, inputKind: 'reps' as const }
      : exercise),
  ...FUNCTIONAL_PROTOCOLS,
  ...RUNNING_DRILLS,
  ...WARMUP_AND_MOBILITY,
  ...CURATED_CATALOG_ADDITIONS,
  ...VITAL_FREE_PACK_EXERCISES,
  ...CATALOG_EXPANSION,
]

// Составные протоколы и СБУ переиспользуют обложки базовых упражнений. Для
// карточки техники им нужен тот же второй кадр, но дублировать его URL в каждом
// литерале нет смысла.
export const SYSTEM_EXERCISE_CATALOG: readonly ExerciseSnapshot[] = SYSTEM_EXERCISE_CATALOG_SOURCE.map((exercise) => {
  const vitalMedia = VITAL_FREE_PACK_MEDIA_BY_REF[exercise.ref]
  const correctedName = exercise.ref === 'fedb-snatch-deadlift'
    ? 'Рывковая становая тяга (Штанга)'
    : exercise.ref === 'fedb-car-deadlift'
      ? 'Становая тяга в тренажёре «Автомобиль» (Тренажёр)'
      : exercise.name
  return {
    ...exercise,
    name: correctedName,
    imageUrl: vitalMedia?.imageUrl ?? exercise.imageUrl,
    motionImageUrl: vitalMedia?.motionImageUrl ?? exercise.motionImageUrl ?? exercise.imageUrl?.replace(/\.jpg$/, '-end.jpg'),
    techniqueVideoUrl: vitalMedia?.techniqueVideoUrl,
  }
})
