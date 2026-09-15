export const PROGRAM_CATALOG_VERSION = 'program-catalog-v1'
export type Movement = 'squat' | 'hinge' | 'horizontal_push' | 'vertical_push' | 'horizontal_pull' | 'vertical_pull' | 'core' | 'accessory'
export type Equipment = 'dumbbells' | 'barbell' | 'bench' | 'rack' | 'cable' | 'pullup_bar' | 'leg_press' | 'leg_curl' | 'leg_extension'
export interface ProgramExercise {
  ref: string
  name: string
  muscleGroup: string
  inputKind: 'strength' | 'reps' | 'duration'
  movement: Movement
  equipment: readonly Equipment[]
  unsupportedTrunk: boolean
}

// Deliberately bounded programming annotations, not injury contraindications.
// Canonical names/refs/types are checked against the application catalog in CI.
export const PROGRAM_CATALOG: readonly ProgramExercise[] = [
  { ref: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength', movement: 'squat', equipment: ['barbell', 'rack'], unsupportedTrunk: true },
  { ref: 'leg-press', name: 'Жим ногами в тренажёре', muscleGroup: 'legs', inputKind: 'strength', movement: 'squat', equipment: ['leg_press'], unsupportedTrunk: false },
  { ref: 'vital-dumbbell-goblet-squat', name: 'Гоблет-присед с гантелью', muscleGroup: 'legs', inputKind: 'strength', movement: 'squat', equipment: ['dumbbells'], unsupportedTrunk: false },
  { ref: 'fedb-bodyweight-squat', name: 'Приседания без веса', muscleGroup: 'legs', inputKind: 'reps', movement: 'squat', equipment: [], unsupportedTrunk: false },
  { ref: 'romanian-deadlift', name: 'Румынская тяга со штангой', muscleGroup: 'legs', inputKind: 'strength', movement: 'hinge', equipment: ['barbell'], unsupportedTrunk: true },
  { ref: 'fedb-butt-lift-bridge', name: 'Ягодичный мост на полу', muscleGroup: 'glutes', inputKind: 'reps', movement: 'hinge', equipment: [], unsupportedTrunk: false },
  { ref: 'fedb-barbell-hip-thrust', name: 'Хип-траст со штангой с опорой на скамью', muscleGroup: 'glutes', inputKind: 'strength', movement: 'hinge', equipment: ['barbell', 'bench'], unsupportedTrunk: false },
  { ref: 'bench-press', name: 'Жим штанги лёжа', muscleGroup: 'chest', inputKind: 'strength', movement: 'horizontal_push', equipment: ['barbell', 'bench', 'rack'], unsupportedTrunk: false },
  { ref: 'dumbbell-bench-press', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength', movement: 'horizontal_push', equipment: ['dumbbells', 'bench'], unsupportedTrunk: false },
  { ref: 'push-ups', name: 'Отжимания', muscleGroup: 'chest', inputKind: 'reps', movement: 'horizontal_push', equipment: [], unsupportedTrunk: false },
  { ref: 'overhead-press', name: 'Жим штанги над головой стоя', muscleGroup: 'shoulders', inputKind: 'strength', movement: 'vertical_push', equipment: ['barbell', 'rack'], unsupportedTrunk: true },
  { ref: 'vital-standing-dumbbell-press', name: 'Жим гантелей над головой стоя', muscleGroup: 'shoulders', inputKind: 'strength', movement: 'vertical_push', equipment: ['dumbbells'], unsupportedTrunk: false },
  { ref: 'barbell-row', name: 'Тяга штанги в наклоне', muscleGroup: 'back', inputKind: 'strength', movement: 'horizontal_pull', equipment: ['barbell'], unsupportedTrunk: true },
  { ref: 'dumbbell-row', name: 'Тяга гантели в наклоне', muscleGroup: 'back', inputKind: 'strength', movement: 'horizontal_pull', equipment: ['dumbbells', 'bench'], unsupportedTrunk: false },
  { ref: 'seated-cable-row', name: 'Тяга нижнего блока', muscleGroup: 'back', inputKind: 'strength', movement: 'horizontal_pull', equipment: ['cable'], unsupportedTrunk: false },
  { ref: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'back', inputKind: 'strength', movement: 'vertical_pull', equipment: ['cable'], unsupportedTrunk: false },
  { ref: 'pull-ups', name: 'Подтягивания', muscleGroup: 'back', inputKind: 'reps', movement: 'vertical_pull', equipment: ['pullup_bar'], unsupportedTrunk: false },
  { ref: 'leg-curl', name: 'Сгибание ног лёжа в тренажёре', muscleGroup: 'legs', inputKind: 'strength', movement: 'accessory', equipment: ['leg_curl'], unsupportedTrunk: false },
  { ref: 'leg-extension', name: 'Разгибание ног в тренажёре', muscleGroup: 'legs', inputKind: 'strength', movement: 'accessory', equipment: ['leg_extension'], unsupportedTrunk: false },
  { ref: 'lateral-raise', name: 'Разведение гантелей в стороны', muscleGroup: 'shoulders', inputKind: 'strength', movement: 'accessory', equipment: ['dumbbells'], unsupportedTrunk: false },
  { ref: 'biceps-curl', name: 'Сгибание рук с гантелями', muscleGroup: 'arms', inputKind: 'strength', movement: 'accessory', equipment: ['dumbbells'], unsupportedTrunk: false },
  { ref: 'triceps-pushdown', name: 'Разгибание рук на трицепс в блоке', muscleGroup: 'arms', inputKind: 'strength', movement: 'accessory', equipment: ['cable'], unsupportedTrunk: false },
  { ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', movement: 'core', equipment: [], unsupportedTrunk: false },
  { ref: 'side-plank', name: 'Боковая планка', muscleGroup: 'core', inputKind: 'duration', movement: 'core', equipment: [], unsupportedTrunk: false },
  { ref: 'crunches', name: 'Скручивания', muscleGroup: 'core', inputKind: 'reps', movement: 'core', equipment: [], unsupportedTrunk: false },
]

export const PROGRAM_EQUIPMENT: readonly Equipment[] = ['dumbbells', 'barbell', 'bench', 'rack', 'cable', 'pullup_bar', 'leg_press', 'leg_curl', 'leg_extension']

export function eligibleProgramExercises(equipment: readonly Equipment[], excludedRefs: readonly string[]): ProgramExercise[] {
  return PROGRAM_CATALOG.filter((exercise) => !excludedRefs.includes(exercise.ref)
    && exercise.equipment.every((item) => equipment.includes(item)))
}
