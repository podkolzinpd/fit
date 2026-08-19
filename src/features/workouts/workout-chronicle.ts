export interface ChronicleExercisePreview<T> {
  visible: T[]
  hiddenCount: number
}

export function chronicleExercisePreview<T>(exercises: T[], maxVisible = 2): ChronicleExercisePreview<T> {
  const visibleCount = Math.max(0, maxVisible)
  return {
    visible: exercises.slice(0, visibleCount),
    hiddenCount: Math.max(0, exercises.length - visibleCount),
  }
}
