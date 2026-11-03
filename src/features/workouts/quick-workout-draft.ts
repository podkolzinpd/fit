import type { ExerciseSnapshot } from '../../shared/domain'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import type { WorkoutParseUnmatchedView } from './llm-workout-parser'

export type QuickWorkoutEntryItem = { id: string; groupId?: string; parsed?: ParsedWorkoutExercise; unmatched?: WorkoutParseUnmatchedView }
export type QuickWorkoutEntryDraft = {
  text: string
  parsedText: string
  entries: QuickWorkoutEntryItem[]
  choices: Record<string, ExerciseSnapshot>
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const exercise = (value: unknown) => record(value) && (value.source === 'system' || value.source === 'custom')
  && ['ref', 'name', 'muscleGroup'].every(key => typeof value[key] === 'string')
  && ['strength', 'distance', 'reps', 'duration'].includes(String(value.inputKind))
const sets = (value: unknown) => Array.isArray(value) && value.every(set => record(set)
  && Object.values(set).every(item => item === undefined || typeof item === 'number' && Number.isFinite(item)))

const structure = (value: unknown) => record(value) && Object.entries(value).every(([key, item]) =>
  item === undefined || key === 'blockId' && typeof item === 'string'
  || key === 'blockType' && ['single', 'group'].includes(String(item))
  || key === 'blockPreset' && ['set', 'circuit', 'interval'].includes(String(item))
  || ['blockRounds', 'restBetweenExercisesSec', 'restBetweenRoundsSec', 'restBetweenSetsSec'].includes(key)
    && typeof item === 'number' && Number.isFinite(item) && item >= 0)

/** Invalid optional previews never make a legacy plan or its raw text unreadable. */
export function readQuickWorkoutEntryDraft(value: unknown, text?: string): QuickWorkoutEntryDraft | undefined {
  if (!record(value) || typeof value.text !== 'string' || typeof value.parsedText !== 'string'
    || text !== undefined && value.text !== text || value.parsedText && value.parsedText !== value.text
    || !Array.isArray(value.entries) || !record(value.choices)) return undefined
  if (value.entries.length && value.parsedText !== value.text) return undefined
  if (!value.entries.every(entry => record(entry) && typeof entry.id === 'string'
    && (entry.groupId === undefined || typeof entry.groupId === 'string')
    && (entry.parsed === undefined || record(entry.parsed) && typeof entry.parsed.line === 'string'
      && typeof entry.parsed.hasValues === 'boolean' && exercise(entry.parsed.exercise) && sets(entry.parsed.sets)
      && (entry.parsed.structure === undefined || structure(entry.parsed.structure)))
    && (entry.unmatched === undefined || record(entry.unmatched) && typeof entry.unmatched.line === 'string'
      && ['not-found', 'ambiguous'].includes(String(entry.unmatched.reason))
      && Array.isArray(entry.unmatched.candidates) && entry.unmatched.candidates.every(exercise)
      && (entry.unmatched.sets === undefined || sets(entry.unmatched.sets))))) return undefined
  if (!Object.values(value.choices).every(exercise)) return undefined
  return value as QuickWorkoutEntryDraft
}
