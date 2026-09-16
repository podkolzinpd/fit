import { PROGRAM_CATALOG, type ProgramExercise } from './catalog.js'
import type { ProgramBrief } from './brief.js'

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
const kind = (ref: unknown) => {
  const entry = PROGRAM_CATALOG.find((exercise) => exercise.ref === ref)
  return entry ? entry.movement === 'aerobic' ? 'aerobic' : entry.inputKind === 'duration' ? 'duration' : 'reps' : undefined
}
export function qualityPatchSchema(catalog: readonly ProgramExercise[], brief: ProgramBrief) {
  return { type: 'object', additionalProperties: false, required: ['rationale', 'changes'], properties: {
    rationale: { type: 'string', minLength: 1, maxLength: 900 },
    changes: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['weekday', 'exerciseRef', 'replacementRef', 'progressionNote'], properties: {
        weekday: { type: 'integer', enum: brief.weekdays },
        exerciseRef: { type: 'string', enum: catalog.map((entry) => entry.ref) },
        replacementRef: { type: 'string', enum: catalog.map((entry) => entry.ref) },
        progressionNote: { type: 'string', minLength: 1, maxLength: 240 },
      },
    } },
  } }
}

/** Only substitutions of the same prescription unit; validate the whole result
 * afterwards for duplicates, preserved refs, exclusions and quality regressions. */
export function applyQualityPatch(raw: unknown, patch: unknown): unknown {
  if (!record(raw) || !record(patch) || typeof patch.rationale !== 'string' || !patch.rationale.trim() || patch.rationale.length > 900
    || !Array.isArray(patch.changes) || patch.changes.length > 8) throw new Error('program_quality_patch_invalid')
  const result = structuredClone(raw)
  const changed = new Set<string>()
  const rows = [result.exercises, result.durationExercises, result.aerobicExercises].flatMap((rows) => Array.isArray(rows) ? rows.filter(record) : [])
  const originals = new Map(rows.map((row) => [`${String(row.weekday)}:${String(row.exerciseRef)}`, row]))
  for (const change of patch.changes) {
    if (!record(change) || typeof change.progressionNote !== 'string' || !change.progressionNote.trim() || change.progressionNote.length > 240
      || !kind(change.exerciseRef) || kind(change.exerciseRef) !== kind(change.replacementRef)) throw new Error('program_quality_patch_invalid')
    const key = `${String(change.weekday)}:${String(change.exerciseRef)}`
    if (changed.has(key)) throw new Error('program_quality_patch_invalid')
    const row = originals.get(key)
    if (!row) throw new Error('program_quality_patch_invalid')
    row.exerciseRef = change.replacementRef
    row.progressionNote = change.progressionNote
    changed.add(key)
  }
  result.a_strategy = patch.rationale.trim()
  return result
}

/** Explicit per-row choices prevent a reviewer from suggesting a duplicate. */
export function qualityReplacementOptions(raw: unknown, catalog: readonly ProgramExercise[], brief: ProgramBrief) {
  if (!record(raw)) return []
  const rows = [raw.exercises, raw.durationExercises, raw.aerobicExercises].flatMap((value) => Array.isArray(value) ? value.filter(record) : [])
  return rows.filter((row) => !brief.preserveRefs?.includes(String(row.exerciseRef))).map((row) => ({
    weekday: row.weekday, exerciseRef: row.exerciseRef,
    allowedReplacementRefs: catalog.filter((entry) => kind(entry.ref) === kind(row.exerciseRef)
      && !rows.some((other) => other.weekday === row.weekday && other.exerciseRef === entry.ref)).map((entry) => entry.ref),
  }))
}
