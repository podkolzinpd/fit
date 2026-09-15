import type { ProgramLoad } from './load.js'
import type { ProgramBrief } from './brief.js'
import { PROGRAM_CATALOG, type ProgramExercise } from './catalog.js'
import { ProgramValidationError, validateProgramTemplate, type ProgramTemplate } from './generate.js'

const DOSES = ['sets', 'amount', 'rpe', 'restSec'] as const
const ROOT_KEYS = ['rationale', 'increaseWhen', 'holdWhen', 'reduceWhen', 'sessions', 'exercises', 'durationExercises']
const EXERCISE_KEYS = ['weekday', 'exerciseRef', 'progressionNote', ...DOSES]
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
    const variants: number[][] = []
    for (let base = min; base <= max; base += scale) {
      const deltas = [[0, 0, 0, 0], load.increments, [0, 0, 0, Math.min(1, load.increments[3]!)], [0, -1, -1, 0]]
      for (const delta of deltas) {
        const values = delta.map((value) => base + value * scale)
        if (values.every((value) => value >= min && value <= max)) variants.push(values)
      }
    }
    return variants
  }
  const four = (items: object, values?: number[][]) => ({ type: 'array', minItems: 4, maxItems: 4, items, ...(values ? { enum: values } : {}) })
  const exerciseRows = (duration: boolean) => {
    const refs = catalog.filter((exercise) => (exercise.inputKind === 'duration') === duration).map((exercise) => exercise.ref)
    return { type: 'array', minItems: 0, maxItems: refs.length ? (brief.frequency ?? 1) * 8 : 0, items: {
      type: 'object', additionalProperties: false, required: EXERCISE_KEYS, properties: {
        weekday,
        exerciseRef: { type: 'string', ...(refs.length ? { enum: refs } : { maxLength: 0 }) },
        progressionNote: { type: 'string', minLength: 1, maxLength: 240 },
        sets: four({ type: 'integer', minimum: 1, maximum: load.maxSetsPerExercise }, constant(1, load.maxSetsPerExercise)),
        amount: four({ type: 'integer', minimum: duration ? 15 : 4, maximum: duration ? 90 : 20 }, duration ? sequences(15, 90, 5) : sequences(4, 20, 1)),
        rpe: four({ type: 'number', minimum: 6, maximum: load.rpe }, constant(6, load.rpe, 0.5)),
        restSec: four({ type: 'integer', minimum: 60, maximum: 180 }),
      },
    } }
  }
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
      exercises: exerciseRows(false),
      durationExercises: exerciseRows(true),
    },
  }
}

/** Shape conversion only: never fill, round, clamp, or silently replace model doses. */
export function readProgramPlan(raw: unknown, brief: ProgramBrief, today: string): ProgramTemplate {
  if (!record(raw) || !exact(raw, ROOT_KEYS) || !text(raw.rationale, 900)
    || !text(raw.increaseWhen, 150) || !text(raw.holdWhen, 150) || !text(raw.reduceWhen, 150)
    || !Array.isArray(raw.sessions) || raw.sessions.length !== brief.frequency
    || !Array.isArray(raw.exercises) || !Array.isArray(raw.durationExercises)
    || raw.exercises.length + raw.durationExercises.length > 24) invalid()
  const parseRows = (values: unknown[], duration: boolean) => values.map((row: unknown) => {
    if (record(row) && !text(row.progressionNote, 240)) invalid('invalid_progression_note')
    if (!record(row) || !exact(row, EXERCISE_KEYS) || typeof row.weekday !== 'number'
      || !brief.weekdays?.includes(row.weekday)
      || !DOSES.every((key) => Array.isArray(row[key]) && row[key].length === 4)) invalid()
    const catalogEntry = PROGRAM_CATALOG.find((exercise) => exercise.ref === row.exerciseRef)
    if (!catalogEntry || (catalogEntry.inputKind === 'duration') !== duration) invalid('invalid_exercise_input_kind')
    return row
  })
  // The contract places timed core work after rep-based exercises in each day.
  const rows = [...parseRows(raw.exercises, false), ...parseRows(raw.durationExercises, true)]
  const sessions = raw.sessions.map((day: unknown) => {
    if (!record(day) || !exact(day, ['weekday', 'title'])) invalid()
    const exercises = rows.filter((row) => row.weekday === day.weekday)
    return { ...day, exercises: exercises.map((row) => ({ exerciseRef: row.exerciseRef, progressionNote: row.progressionNote,
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
  const rows = template.sessions.flatMap((session) => session.exercises.map((exercise) => ({
    weekday: session.weekday, exerciseRef: exercise.exerciseRef,
    progressionNote: exercise.progressionNote ?? `Назначение по неделям: ${exercise.weeks.map((week) => `${week.sets} × ${week.reps ?? week.durationSec}`).join(' → ')}${exercise.weeks[0]?.reps === null ? ' секунд' : ' повторений'}. Переход к следующей нагрузке — при сохранении техники и целевого усилия; рабочий вес подбирает тренер.`,
    ...Object.fromEntries(DOSES.map((key) => [key, exercise.weeks.map((week) => key === 'amount' ? week.reps ?? week.durationSec : week[key])])),
  })))
  const isDuration = (ref: string) => PROGRAM_CATALOG.some((exercise) => exercise.ref === ref && exercise.inputKind === 'duration')
  return { rationale: template.rationale,
    increaseWhen: 'Все подходы выполнены с целевым усилием и сохранением техники: перейти к следующей неделе.',
    holdWhen: 'Не достигнуты повторы или усилие выше целевого: повторить предыдущую выполненную нагрузку.',
    reduceWhen: 'При выраженной усталости снизить нагрузку с тренером; при боли остановить упражнение и обсудить корректировку.',
    sessions: template.sessions.map(({ weekday, title }) => ({ weekday, title })),
    exercises: rows.filter((row) => !isDuration(row.exerciseRef)),
    durationExercises: rows.filter((row) => isDuration(row.exerciseRef)),
  }
}
