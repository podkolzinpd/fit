export type WorkoutParseResponse = {
  items: Array<{ sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }>; position?: number }>
  unmatched: Array<{ sourceText: string; reason: string; suggestedExerciseRefs: string[]; sets?: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }>; position?: number }>
}
