import type { ExerciseSnapshot, WorkoutDraft } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { filterExercises } from '../exercises'
import { isActiveCatalogExercise } from '../../shared/exercise-catalog-retirement'

export type ProgramExerciseDraft = { name: string; exerciseRef?: string; sets: number; reps?: number; weightKg?: number; durationMin?: number; distanceKm?: number }
export type ProgramSessionDraft = { title: string; day: string; exercises: ProgramExerciseDraft[] }

export function optionalProgramNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

export function programSessions(value: readonly unknown[]): ProgramSessionDraft[] {
  return value.flatMap((session): ProgramSessionDraft[] => {
    if (typeof session !== 'object' || session === null || Array.isArray(session)) return []
    const row = session as Record<string, unknown>
    if (typeof row.title !== 'string' || typeof row.day !== 'string' || !Array.isArray(row.exercises)) return []
    const exercises = row.exercises.flatMap((exercise): ProgramExerciseDraft[] => {
      if (typeof exercise === 'string' && exercise.trim()) return [{ name: exercise.trim(), sets: 1 }]
      if (typeof exercise !== 'object' || exercise === null || Array.isArray(exercise)) return []
      const item = exercise as Record<string, unknown>
      if (typeof item.name !== 'string' || !item.name.trim() || typeof item.sets !== 'number' || !Number.isInteger(item.sets) || item.sets < 1) return []
      const number = (field: string) => typeof item[field] === 'number' && Number.isFinite(item[field]) && item[field] > 0 ? item[field] as number : undefined
      return [{ name: item.name.trim(), exerciseRef: typeof item.exerciseRef === 'string' && item.exerciseRef.trim() ? item.exerciseRef.trim() : undefined, sets: item.sets, reps: number('reps'), weightKg: number('weightKg'), durationMin: number('durationMin'), distanceKm: number('distanceKm') }]
    })
    return exercises.length ? [{ title: row.title, day: row.day, exercises }] : []
  })
}

export function updateProgramExercise(sessions: ProgramSessionDraft[], sessionIndex: number, exerciseIndex: number, patch: Partial<ProgramExerciseDraft>): ProgramSessionDraft[] {
  return sessions.map((session, currentSessionIndex) => currentSessionIndex !== sessionIndex ? session : {
    ...session,
    exercises: session.exercises.map((exercise, currentExerciseIndex) => currentExerciseIndex === exerciseIndex ? { ...exercise, ...patch } : exercise),
  })
}

export function programWorkoutDrafts(clientId: string, sessions: readonly ProgramSessionDraft[], dates: readonly string[], requestIds: readonly string[], catalog: readonly ExerciseSnapshot[]): WorkoutDraft[] | undefined {
  catalog = catalog.filter(isActiveCatalogExercise)
  if (sessions.length === 0 || sessions.length !== dates.length || sessions.length !== requestIds.length) return undefined
  const byName = new Map(catalog.map((exercise) => [exercise.name.toLocaleLowerCase('ru-RU'), exercise]))
  const resolveExercise = (name: string, exerciseRef?: string) => {
    if (exerciseRef) {
      const byRefMatch = catalog.find((exercise) => exercise.ref === exerciseRef)
      if (byRefMatch) return byRefMatch
    }
    const exact = byName.get(name.toLocaleLowerCase('ru-RU'))
    if (exact) return exact
    const matches = filterExercises(catalog, 'all', name)
    return matches.length === 1 ? matches[0] : undefined
  }
  const drafts: Array<WorkoutDraft | undefined> = sessions.map((session, index): WorkoutDraft | undefined => {
    const date = dates[index]?.trim()
    const requestId = requestIds[index]?.trim()
    const exercises = session.exercises.map((item) => ({ item, exercise: resolveExercise(item.name, item.exerciseRef) }))
    if (!date || !requestId || !session.title.trim() || exercises.some(({ exercise }) => exercise === undefined)) return undefined
    return { requestId, clientId, workoutDate: localDate(date), notes: session.title.trim(), exercises: exercises.map(({ item, exercise }, position) => ({ ...exercise!, position, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1, sets: Array.from({ length: item.sets }, (_, setPosition) => ({ position: setPosition, reps: item.reps, weightKg: item.weightKg, durationMin: item.durationMin, distanceKm: item.distanceKm })) })) }
  })
  return drafts.every((draft): draft is WorkoutDraft => draft !== undefined) ? drafts : undefined
}
