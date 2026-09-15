import type { ProgramLoad } from './load.js'
import type { ProgramBrief } from './brief.js'
import { PROGRAM_CATALOG, type ProgramExercise } from './catalog.js'
import { ProgramValidationError, validateProgramTemplate, type ProgramTemplate } from './generate.js'

const DOSES = ['sets', 'amount', 'rpe', 'restSec'] as const
const ROOT_KEYS = ['rationale', 'increaseWhen', 'holdWhen', 'reduceWhen', 'sessions', 'exercises']
const EXERCISE_KEYS = ['weekday', 'exerciseRef', ...DOSES]
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value) }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max }
function invalid(code = 'invalid_model_plan'): never { throw new ProgramValidationError([code]) }

/** Flat exercise rows avoid the provider's nesting limit. Every dose array is
 * four explicit model assignments, not a progression formula applied by code. */
export function programPlanSchema(catalog: readonly ProgramExercise[], brief: ProgramBrief, load: ProgramLoad) {
  const weekday = { type: 'integer', enum: brief.weekdays }
  const constant = (min: number, max: number, step = 1) => Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, index) => Array(4).fill(min + index * step) as number[])
  const sequences = (min: number, max: number, scale: number) => {
    const variants: (number | null)[][] = [[null, null, null, null]]
    for (let base = min; base <= max; base += scale) {
      const deltas = [[0, 0, 0, 0], load.increments, [0, 0, 0, Math.min(1, load.increments[3]!)], [0, -1, -1, 0]]
      for (const delta of deltas) {
        const values = delta.map((value) => base + value * scale)
        if (values.every((value) => value >= min && value <= max)) variants.push(values)
      }
    }
    return variants
  }
  const four = (items: object, values?: (number | null)[][]) => ({ type: 'array', minItems: 4, maxItems: 4, items, ...(values ? { enum: values } : {}) })
  return {
    type: 'object', additionalProperties: false, required: ROOT_KEYS, properties: {
      rationale: { type: 'string', minLength: 1, maxLength: 900 },
      increaseWhen: { type: 'string', minLength: 1, maxLength: 150 },
      holdWhen: { type: 'string', minLength: 1, maxLength: 150 },
      reduceWhen: { type: 'string', minLength: 1, maxLength: 150 },
      sessions: { type: 'array', minItems: brief.frequency, maxItems: brief.frequency, items: {
        type: 'object', additionalProperties: false, required: ['weekday', 'title'], properties: {
          weekday, title: { type: 'string', minLength: 1, maxLength: 100 },
        },
      } },
      exercises: { type: 'array', minItems: (brief.frequency ?? 1) * 3, maxItems: (brief.frequency ?? 1) * 8, items: {
        type: 'object', additionalProperties: false, required: EXERCISE_KEYS, properties: {
          weekday,
          exerciseRef: { type: 'string', enum: catalog.map((exercise) => exercise.ref) },
          sets: four({ type: 'integer', minimum: 1, maximum: load.maxSetsPerExercise }, constant(1, load.maxSetsPerExercise)),
          amount: four({ type: 'integer', minimum: 4, maximum: 90 }, [...sequences(4, 20, 1), ...sequences(15, 90, 5)].filter((values) => values[0] !== null)),
          rpe: four({ type: 'number', minimum: 6, maximum: load.rpe }, constant(6, load.rpe, 0.5)),
          restSec: four({ type: 'integer', minimum: 60, maximum: 180 }),
        },
      } },
    },
  }
}

/** Shape conversion only: never fill, round, clamp, or silently replace model doses. */
export function readProgramPlan(raw: unknown, brief: ProgramBrief, today: string): ProgramTemplate {
  if (!record(raw) || !exact(raw, ROOT_KEYS) || !text(raw.rationale, 900)
    || !text(raw.increaseWhen, 150) || !text(raw.holdWhen, 150) || !text(raw.reduceWhen, 150)
    || !Array.isArray(raw.sessions) || raw.sessions.length !== brief.frequency
    || !Array.isArray(raw.exercises) || raw.exercises.length > 24) invalid()
  const rows = raw.exercises.map((row: unknown) => {
    if (!record(row) || !exact(row, EXERCISE_KEYS) || typeof row.weekday !== 'number'
      || !brief.weekdays?.includes(row.weekday)
      || !DOSES.every((key) => Array.isArray(row[key]) && row[key].length === 4)) invalid()
    return row
  })
  const sessions = raw.sessions.map((day: unknown) => {
    if (!record(day) || !exact(day, ['weekday', 'title'])) invalid()
    const exercises = rows.filter((row) => row.weekday === day.weekday)
    return { ...day, exercises: exercises.map((row) => ({ exerciseRef: row.exerciseRef,
      weeks: Array.from({ length: 4 }, (_, index) => {
        const duration = PROGRAM_CATALOG.find((exercise) => exercise.ref === row.exerciseRef)?.inputKind === 'duration'
        return { sets: (row.sets as unknown[])[index], rpe: (row.rpe as unknown[])[index], restSec: (row.restSec as unknown[])[index],
          reps: duration ? null : (row.amount as unknown[])[index], durationSec: duration ? (row.amount as unknown[])[index] : null }
      }),
    })) }
  })
  if (sessions.reduce((sum, session) => sum + session.exercises.length, 0) !== rows.length) invalid('orphan_exercise_rows')
  return validateProgramTemplate({ rationale: raw.rationale,
    progression: `Увеличить: ${raw.increaseWhen.trim()}\nСохранить: ${raw.holdWhen.trim()}\nСнизить: ${raw.reduceWhen.trim()}`,
    sessions,
  }, brief, today)
}

/** Test fixtures and explicit synthetic smoke requests use the same wire format. */
export function programPlanFromTemplate(template: ProgramTemplate) {
  return { rationale: template.rationale,
    increaseWhen: 'Все подходы выполнены с целевым усилием и сохранением техники: перейти к следующей неделе.',
    holdWhen: 'Не достигнуты повторы или усилие выше целевого: повторить предыдущую выполненную нагрузку.',
    reduceWhen: 'При выраженной усталости снизить нагрузку с тренером; при боли остановить упражнение и обсудить корректировку.',
    sessions: template.sessions.map(({ weekday, title }) => ({ weekday, title })),
    exercises: template.sessions.flatMap((session) => session.exercises.map((exercise) => ({
      weekday: session.weekday, exerciseRef: exercise.exerciseRef,
      ...Object.fromEntries(DOSES.map((key) => [key, exercise.weeks.map((week) => key === 'amount' ? week.reps ?? week.durationSec : week[key])])),
    }))),
  }
}
