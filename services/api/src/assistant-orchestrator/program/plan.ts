import type { ProgramLoad } from './load.js'
import type { ProgramBrief } from './brief.js'
import { PROGRAM_CATALOG, type ProgramExercise } from './catalog.js'
import { programExerciseMinutes, ProgramValidationError, validateProgramTemplate, type ProgramTemplate } from './generate.js'

const DOSES = ['sets', 'amount', 'rpe', 'restSec'] as const
const ROOT_KEYS = ['a_strategy', 'increaseWhen', 'holdWhen', 'reduceWhen', 'sessions', 'exercises', 'durationExercises', 'aerobicExercises']
const EXERCISE_KEYS = ['weekday', 'exerciseRef', 'progressionNote', ...DOSES]
const NUMERIC_PROGRESSION_NOTE = /\p{N}|недел|(?:^|[^\p{L}])(?:перв|втор|трет|четв[её]рт)/iu
// A stated effort range is not a second progression timeline. Accept it only
// when every actual weekly effort fits; other numeric/weekly narration is rejected.
function conflictingProgressionNote(row: Record<string, unknown>): boolean {
  if (typeof row.progressionNote !== 'string') return true
  const note = row.progressionNote.replace(/(?:усили[ея]|RPE)\s+(\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?(?:\s*(?:из|\/)\s*10)?/giu, (match, low: string, high: string | undefined) => {
    const min = Number(low.replace(',', '.')), max = high ? Number(high.replace(',', '.')) : min
    return Array.isArray(row.rpe) && row.rpe.length === 4 && row.rpe.every((value: unknown) => typeof value === 'number' && value >= min && value <= max) ? '' : match
  })
  return NUMERIC_PROGRESSION_NOTE.test(note) || /(?:^|[.;!?]\s*)максимальное\s+количество\s+повтор/iu.test(note)
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value) }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max }
function invalid(code = 'invalid_model_plan'): never { throw new ProgramValidationError([code]) }

/** Flat exercise rows avoid the provider's nesting limit. Every dose array is
 * four explicit model assignments, not a progression formula applied by code. */
export function programPlanSchema(catalog: readonly ProgramExercise[], brief: ProgramBrief, load: ProgramLoad, repairDay = false, timeRepair?: { core: boolean; aerobic: boolean }) {
  const weekday = { type: 'integer', enum: brief.weekdays }
  const constant = (min: number, max: number, step = 1) => Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, index) => Array(4).fill(min + index * step) as number[])
  const four = (items: object, values?: number[][]) => ({ type: 'array', minItems: 4, maxItems: 4, items, ...(values ? { enum: values } : {}) })
  const sequences = (min: number, max: number, step: number) => {
    const patterns = [[0, 0, 0, 0], [0, 1, 2, 3], [0, 0, 1, 2], [0, 1, 1, 2], [0, 2, 2, 4], [0, 1, 2, 2], [0, 1, 2, 0], [0, -1, -1, 0]]
    return Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, index) => patterns.map((pattern) => pattern.map((delta) => min + (index + delta) * step)))
      .flat().filter((values) => values.every((value) => value >= min && value <= max))
  }
  // A time repair gets a mathematically feasible search space instead of another
  // request to estimate the same sums. The model still chooses refs and doses;
  // existing prescriptions are never silently clamped.
  const strengthRefs = catalog.filter((row) => ['strength', 'reps'].includes(row.inputKind))
  const budgeted = timeRepair && strengthRefs.length >= 3
  const strengthSlots = Math.max(3, (brief.preserveRefs ?? []).filter((ref) => strengthRefs.some((row) => row.ref === ref)).length)
  const coreSlots = budgeted && timeRepair.core ? 1 : 0
  const aerobicSlots = budgeted && timeRepair.aerobic ? 1 : 0
  const aerobicMax = Math.min(1800, Math.max(300, Math.floor(brief.durationMin! * 0.2) * 60))
  const secondsPerStrength = Math.floor((brief.durationMin! - 10 - strengthSlots * 2 - coreSlots * 3.5 - aerobicSlots * (2 + aerobicMax / 60)) * 60 / strengthSlots)
  const budgetSets = Math.max(1, Math.min(load.maxSetsPerExercise, Math.floor((secondsPerStrength + 60) / 120), Math.floor(((brief.experience === 'experienced' ? 24 : 18) - coreSlots) / strengthSlots)))
  const budgetAmount = Math.max(4, Math.min(20, Math.floor(secondsPerStrength / 3)))
  const budgetRest = budgetSets === 1 ? 180 : Math.max(60, Math.min(180, Math.floor((secondsPerStrength - budgetSets * 60) / (budgetSets - 1))))
  const exerciseRows = (kind: 'reps' | 'duration' | 'aerobic') => {
    const duration = kind !== 'reps'
    const aerobic = kind === 'aerobic'
    const refs = catalog.filter((exercise) => aerobic ? exercise.movement === 'aerobic' : exercise.movement !== 'aerobic' && (exercise.inputKind === 'duration') === duration).map((exercise) => exercise.ref)
    const maxSets = aerobic || budgeted && duration ? 1 : budgeted ? budgetSets : load.maxSetsPerExercise
    const maxAmount = aerobic ? budgeted ? aerobicMax : 1800 : duration ? 90 : budgeted ? budgetAmount : 20
    return { type: 'array', minItems: budgeted && kind === 'reps' ? strengthSlots : repairDay && kind === 'reps' ? Math.min(3, refs.length) : 0, maxItems: !refs.length ? 0 : budgeted ? aerobic ? aerobicSlots : duration ? coreSlots : strengthSlots : (brief.frequency ?? 1) * 8, items: {
      type: 'object', additionalProperties: false, required: EXERCISE_KEYS, properties: {
        weekday,
        exerciseRef: { type: 'string', ...(refs.length ? { enum: refs } : { maxLength: 0 }) },
        progressionNote: { type: 'string', minLength: 1, maxLength: 240 },
        sets: four({ type: 'integer', minimum: 1, maximum: maxSets }, constant(1, maxSets)),
        amount: four({ type: 'integer', minimum: aerobic ? 300 : duration ? 15 : 4, maximum: maxAmount }, aerobic ? sequences(300, maxAmount, 60) : duration ? sequences(15, maxAmount, 5) : sequences(4, maxAmount, 1)),
        rpe: four({ type: 'number', minimum: aerobic ? 3 : 6, maximum: aerobic ? 6 : load.rpe }, constant(aerobic ? 3 : 6, aerobic ? 6 : load.rpe, 0.5)),
        restSec: four({ type: 'integer', minimum: aerobic ? 0 : 60, maximum: aerobic ? 0 : budgeted && !duration ? budgetRest : 180 }),
      },
    } }
  }
  return {
    type: 'object', additionalProperties: false, required: ROOT_KEYS, properties: {
      a_strategy: { type: 'string', minLength: 1, maxLength: 900, description: 'First define the goal, weekly muscle distribution, time allocation per session, progression approach and measurable outcome. Then choose exercise rows consistent with this strategy.' },
      increaseWhen: { type: 'string', minLength: 1, maxLength: 150 },
      holdWhen: { type: 'string', minLength: 1, maxLength: 150 },
      reduceWhen: { type: 'string', minLength: 1, maxLength: 150 },
      sessions: { type: 'array', minItems: brief.frequency, maxItems: brief.frequency, items: {
        type: 'object', additionalProperties: false, required: ['weekday', 'title'], properties: {
          weekday, title: { type: 'string', minLength: 1, maxLength: 100 },
        },
      } },
      exercises: exerciseRows('reps'),
      durationExercises: exerciseRows('duration'),
      aerobicExercises: exerciseRows('aerobic'),
    },
  }
}

/** Shape conversion only: never fill, round, clamp, or silently replace model doses. */
export function readProgramPlan(raw: unknown, brief: ProgramBrief, today: string): ProgramTemplate {
  if (!record(raw) || !exact(raw, ROOT_KEYS) || !text(raw.a_strategy, 900)
    || !text(raw.increaseWhen, 150) || !text(raw.holdWhen, 150) || !text(raw.reduceWhen, 150)
    || !Array.isArray(raw.sessions) || raw.sessions.length !== brief.frequency
    || !Array.isArray(raw.exercises) || !Array.isArray(raw.durationExercises) || !Array.isArray(raw.aerobicExercises)
    || raw.exercises.length + raw.durationExercises.length + raw.aerobicExercises.length > 24) invalid()
  const parseRows = (values: unknown[], kind: 'reps' | 'duration' | 'aerobic') => values.map((row: unknown) => {
    if (record(row) && !text(row.progressionNote, 240)) invalid('invalid_progression_note')
    if (!record(row) || !exact(row, EXERCISE_KEYS) || typeof row.weekday !== 'number'
      || !brief.weekdays?.includes(row.weekday)
      || !DOSES.every((key) => Array.isArray(row[key]) && row[key].length === 4)) invalid()
    // Exact progression is rendered from the dose arrays. A second model-written
    // timeline can contradict those numbers, so new notes stay qualitative.
    if (conflictingProgressionNote(row)) invalid('progression_note_must_be_qualitative')
    const catalogEntry = PROGRAM_CATALOG.find((exercise) => exercise.ref === row.exerciseRef)
    if (!catalogEntry || (catalogEntry.movement === 'aerobic' ? 'aerobic' : catalogEntry.inputKind === 'duration' ? 'duration' : 'reps') !== kind) invalid('invalid_exercise_input_kind')
    return row
  })
  // The contract places timed core work after rep-based exercises in each day.
  const rows = [...parseRows(raw.exercises, 'reps'), ...parseRows(raw.durationExercises, 'duration'), ...parseRows(raw.aerobicExercises, 'aerobic')]
  const sessions = raw.sessions.map((day: unknown) => {
    if (!record(day) || !exact(day, ['weekday', 'title'])) invalid()
    const exercises = rows.filter((row) => row.weekday === day.weekday)
    return { ...day, exercises: exercises.map((row) => ({ exerciseRef: row.exerciseRef, progressionNote: row.progressionNote,
      weeks: Array.from({ length: 4 }, (_, index) => {
        const duration = ['duration', 'distance'].includes(PROGRAM_CATALOG.find((exercise) => exercise.ref === row.exerciseRef)!.inputKind)
        return { sets: (row.sets as unknown[])[index], rpe: (row.rpe as unknown[])[index], restSec: (row.restSec as unknown[])[index],
          reps: duration ? null : (row.amount as unknown[])[index], durationSec: duration ? (row.amount as unknown[])[index] : null }
      }),
    })) }
  })
  if (sessions.reduce((sum, session) => sum + session.exercises.length, 0) !== rows.length) invalid('orphan_exercise_rows')
  return validateProgramTemplate({ rationale: raw.a_strategy,
    progression: `Увеличить: ${raw.increaseWhen.trim()}\nСохранить: ${raw.holdWhen.trim()}\nСнизить: ${raw.reduceWhen.trim()}`,
    sessions,
  }, brief, today)
}

/** Test fixtures and explicit synthetic smoke requests use the same wire format. */
export function programPlanFromTemplate(template: ProgramTemplate) {
  const rows = template.sessions.flatMap((session) => session.exercises.map((exercise) => ({
    weekday: session.weekday, exerciseRef: exercise.exerciseRef,
    progressionNote: exercise.progressionNote ?? 'Закрепляем технику упражнения; повышение нагрузки — при выполнении всех подходов с целевым усилием и сохранением техники под наблюдением тренера.',
    ...Object.fromEntries(DOSES.map((key) => [key, exercise.weeks.map((week) => key === 'amount' ? week.reps ?? week.durationSec : week[key])])),
  })))
  const isDuration = (ref: string) => PROGRAM_CATALOG.some((exercise) => exercise.ref === ref && ['duration', 'distance'].includes(exercise.inputKind))
  const isAerobic = (ref: string) => PROGRAM_CATALOG.some((exercise) => exercise.ref === ref && exercise.movement === 'aerobic')
  return { a_strategy: template.rationale,
    increaseWhen: 'Все подходы выполнены с целевым усилием и сохранением техники: перейти к следующей неделе.',
    holdWhen: 'Не достигнуты повторы или усилие выше целевого: повторить предыдущую выполненную нагрузку.',
    reduceWhen: 'При выраженной усталости снизить нагрузку с тренером; при боли остановить упражнение и обсудить корректировку.',
    sessions: template.sessions.map(({ weekday, title }) => ({ weekday, title })),
    exercises: rows.filter((row) => !isDuration(row.exerciseRef)),
    durationExercises: rows.filter((row) => isDuration(row.exerciseRef) && !isAerobic(row.exerciseRef)),
    aerobicExercises: rows.filter((row) => isAerobic(row.exerciseRef)),
  }
}

/** Measured feedback for repair; never edits model prescriptions. */
export function programPlanFeedback(raw: unknown, brief: ProgramBrief) {
  if (!record(raw)) return { expectedRootKeys: ROOT_KEYS }
  const rows = [raw.exercises, raw.durationExercises, raw.aerobicExercises].flatMap((value) => Array.isArray(value) ? value.filter(record) : [])
  const doseIssues: object[] = []
  const weeklySets = [0, 0, 0, 0]
  const dayBudgets = (brief.weekdays ?? []).flatMap((weekday) => Array.from({ length: 4 }, (_, week) => {
    let minutes = 10
    const loadedTrunk: string[] = []
    for (const row of rows.filter((item) => item.weekday === weekday)) {
      const entry = PROGRAM_CATALOG.find((item) => item.ref === row.exerciseRef)
      if (!entry || !DOSES.every((key) => Array.isArray(row[key]) && row[key].length === 4 && row[key].every((value: unknown) => typeof value === 'number' && Number.isFinite(value)))) continue
      const sets = row.sets as number[], amount = row.amount as number[], rpe = row.rpe as number[], rest = row.restSec as number[]
      const timed = ['duration', 'distance'].includes(entry.inputKind)
      const aerobic = entry.movement === 'aerobic'
      weeklySets[week]! += aerobic ? 0 : sets[week]!
      minutes += programExerciseMinutes({ sets: sets[week]!, reps: timed ? null : amount[week]!, durationSec: timed ? amount[week]! : null, restSec: rest[week]! })
      if (entry.unsupportedTrunk && rpe[week]! >= 7) loadedTrunk.push(entry.ref)
      if (week > 0) {
        const increasedAxes = ['sets', 'amount', 'rpe'].filter((key) => (row[key] as number[])[week]! > (row[key] as number[])[week - 1]!)
        const maxAmountStep = aerobic ? 300 : timed ? 10 : 2
        if (increasedAxes.length > 1 || amount[week]! - amount[week - 1]! > maxAmountStep || sets[week]! - sets[week - 1]! > 1 || rpe[week]! - rpe[week - 1]! > 0.5) {
          doseIssues.push({ weekday, exerciseRef: entry.ref, fromWeek: week, toWeek: week + 1, increasedAxes,
            before: { sets: sets[week - 1], amount: amount[week - 1], rpe: rpe[week - 1] },
            after: { sets: sets[week], amount: amount[week], rpe: rpe[week] },
            correction: 'Raise at most one axis. Keep other values unchanged or reduce them.', maxAmountStep })
        }
      }
    }
    return { weekday, week: week + 1, estimatedMinutes: Math.ceil(minutes), availableMinutes: brief.durationMin, loadedTrunk,
      overTime: minutes > brief.durationMin!, tooManyLoadedTrunk: loadedTrunk.length > 1 }
  }))
  return {
    noteIssues: rows.filter((row) => conflictingProgressionNote(row)).map((row) => ({ weekday: row.weekday, exerciseRef: row.exerciseRef, note: row.progressionNote, correction: 'Remove numbers and week names. Do not prescribe maximum repetitions: use the assigned reps and target effort. Exact doses are displayed separately.' })),
    doseIssues, dayBudgets, weeklySets, maximumWeeklySetsIncrease: 0.2,
    expectedWeekdays: brief.weekdays,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(record).map((session) => ({
      weekday: session.weekday, titleLength: typeof session.title === 'string' ? session.title.length : null,
      exerciseCount: rows.filter((row) => row.weekday === session.weekday).length,
      hasCore: rows.some((row) => row.weekday === session.weekday && PROGRAM_CATALOG.some((entry) => entry.ref === row.exerciseRef && entry.inputKind === 'duration')),
      hasAerobic: rows.some((row) => row.weekday === session.weekday && PROGRAM_CATALOG.some((entry) => entry.ref === row.exerciseRef && entry.movement === 'aerobic')),
    })) : [],
    requirements: {
      exercisesPerDay: { minimum: 3, maximum: 8 }, titleLength: { minimum: 1, maximum: 100 },
      uniqueSessionForEveryRequestedWeekday: true,
      exerciseWeekdayMustMatchSessionWeekday: true,
      countIncludesRepAndDurationExercises: true,
    },
  }
}

export function replaceProgramDay(raw: unknown, replacement: unknown, weekday: number): unknown {
  if (!record(raw) || !record(replacement)) return replacement
  const merge = (key: string) => Array.isArray(raw[key]) && Array.isArray(replacement[key])
    ? [...(raw[key] as unknown[]).filter((row: unknown) => record(row) && row.weekday !== weekday),
      ...(replacement[key] as unknown[]).filter((row: unknown) => record(row) && row.weekday === weekday)] : replacement[key]
  return { ...raw, sessions: merge('sessions'), exercises: merge('exercises'), durationExercises: merge('durationExercises'), aerobicExercises: merge('aerobicExercises') }
}

/** Repair explanatory text without asking the model to regenerate valid doses. */
export function replaceProgramNotes(raw: unknown, notes: { weekday: unknown; exerciseRef: unknown }[], replacement: unknown): unknown {
  if (!record(raw) || !record(replacement) || !notes.every((_, index) => text(replacement[`note${index + 1}`], 240))) invalid('invalid_progression_note')
  const rewrite = (value: unknown) => Array.isArray(value) ? value.map((row: unknown) => {
    if (!record(row)) return row
    const index = notes.findIndex((note) => note.weekday === row.weekday && note.exerciseRef === row.exerciseRef)
    return index < 0 ? row : { ...row, progressionNote: replacement[`note${index + 1}`] }
  }) : value
  return { ...raw, exercises: rewrite(raw.exercises), durationExercises: rewrite(raw.durationExercises), aerobicExercises: rewrite(raw.aerobicExercises) }
}
