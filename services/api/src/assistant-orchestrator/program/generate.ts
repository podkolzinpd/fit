import { createHash } from 'node:crypto'
import { eligibleProgramExercises, PROGRAM_CATALOG_VERSION, type ProgramExercise } from './catalog.js'
import { activityOverlap, isCalendarDate, missingBriefFields, type ProgramBrief } from './brief.js'
import { programSessionCount } from './context.js'
import { programLoadIssues, type ProgramLoad } from './load.js'

export const PROGRAM_METHOD_VERSION = 'four-week-foundation-v2'
export interface Prescription { sets: number; reps: number | null; durationSec: number | null; rpe: number; restSec: number }
export interface ProgramTemplate { rationale: string; progression: string; sessions: { weekday: number; title: string; exercises: { exerciseRef: string; progressionNote?: string; weeks: Prescription[] }[] }[] }

const REQUIRED_MOVEMENTS = ['squat', 'hinge', 'horizontal_push', 'horizontal_pull', 'core'] as const

export function programSelectionSlots(brief: ProgramBrief) {
  const catalog = eligibleProgramExercises(brief.equipment ?? [], brief.excludedRefs ?? [])
  const forced = REQUIRED_MOVEMENTS.filter((movement) => {
    const choices = catalog.filter((exercise) => exercise.movement === movement)
    return choices.length > 0 && choices.every((exercise) => exercise.unsupportedTrunk)
  })
  if (forced.length > 1) throw new ProgramValidationError(['catalog_no_supported_combination'])
  return (brief.weekdays ?? []).map((weekday, index) => {
    const loadedMovement = forced[0] ?? (index % 2 === 0 ? 'squat' : 'hinge')
    const choices = Object.fromEntries(REQUIRED_MOVEMENTS.map((movement) => [movement,
      catalog.filter((exercise) => exercise.movement === movement && (!exercise.unsupportedTrunk || movement === loadedMovement)).map((exercise) => exercise.ref),
    ])) as Record<typeof REQUIRED_MOVEMENTS[number], string[]>
    return { key: `day${index + 1}`, weekday, choices,
      accessories: catalog.filter((exercise) => ['accessory', 'vertical_push', 'vertical_pull'].includes(exercise.movement) && !exercise.unsupportedTrunk).map((exercise) => exercise.ref),
    }
  })
}

/** The schema itself requires every essential movement; the model chooses refs. */
export function programTemplateSchema(_catalog: readonly ProgramExercise[], brief: ProgramBrief) {
  const slots = programSelectionSlots(brief)
  return { type: 'object', additionalProperties: false, required: ['days'], properties: {
    days: { type: 'object', additionalProperties: false, required: slots.map((slot) => slot.key), properties: Object.fromEntries(slots.map((slot) => [slot.key, {
      type: 'object', additionalProperties: false, required: [...REQUIRED_MOVEMENTS, 'accessory'], properties: {
        ...Object.fromEntries(REQUIRED_MOVEMENTS.map((movement) => [movement, { type: 'string', enum: slot.choices[movement] }])),
        accessory: { type: ['string', 'null'], enum: [null, ...slot.accessories] },
      },
    }])) },
  } }
}

export function prescribeProgram(raw: unknown, brief: ProgramBrief, today: string, load: ProgramLoad): ProgramTemplate {
  const loadIssues = programLoadIssues(brief, load)
  if (loadIssues.length) throw new ProgramValidationError(loadIssues)
  if (!object(raw) || !exact(raw, ['days']) || !object(raw.days)) throw new ProgramValidationError(['invalid_model_schema'])
  const days = raw.days
  const slots = programSelectionSlots(brief)
  if (!exact(days, slots.map((slot) => slot.key))) throw new ProgramValidationError(['invalid_model_days'])
  const byRef = new Map(eligibleProgramExercises(brief.equipment ?? [], brief.excludedRefs ?? []).map((row) => [row.ref, row]))
  const sessions = slots.map((slot, index) => {
    const selection = days[slot.key]
    if (!object(selection) || !exact(selection, [...REQUIRED_MOVEMENTS, 'accessory'])) throw new ProgramValidationError(['invalid_model_session'])
    const refs = REQUIRED_MOVEMENTS.map((movement) => {
      const ref = selection[movement]
      if (typeof ref !== 'string' || !slot.choices[movement].includes(ref)) throw new ProgramValidationError(['invalid_model_movement'])
      return ref
    })
    if (selection.accessory !== null) {
      if (typeof selection.accessory !== 'string' || !slot.accessories.includes(selection.accessory)) throw new ProgramValidationError(['invalid_model_accessory'])
      if (load.weeklySetCeiling === null || load.weeklySetCeiling >= slots.length * 6) refs.push(selection.accessory)
    }
    const session = { weekday: slot.weekday, title: `Всё тело ${index + 1}`, exercises: refs }
    const selected = session.exercises.map((ref: unknown) => {
      if (typeof ref !== 'string' || !byRef.has(ref)) throw new ProgramValidationError(['invalid_exercise_reference_or_weeks'])
      return byRef.get(ref)!
    })
    if (selected.filter((exercise) => exercise.unsupportedTrunk).length > 1) throw new ProgramValidationError(['repeated_loaded_trunk'])
    const restSec = brief.goal === 'strength' ? ((brief.durationMin ?? 60) < 40 ? 90 : 120) : ((brief.durationMin ?? 60) < 40 ? 60 : 90)
    const rpe = load.rpe
    const prescriptions = (sets: number) => selected.map((exercise) => ({ exerciseRef: exercise.ref,
      weeks: load.increments.map((increment) => ({ sets, restSec, rpe,
        reps: exercise.inputKind === 'duration' ? null : (exercise.movement === 'accessory' || exercise.movement === 'core' || brief.goal === 'hypertrophy' ? 10 : brief.goal === 'strength' ? 6 : 8) + increment,
        durationSec: exercise.inputKind === 'duration' ? 30 + increment * 5 : null,
      })),
    }))
    let sets = Math.min(load.maxSetsPerExercise, load.weeklySetCeiling === null ? load.maxSetsPerExercise
      : Math.floor(load.weeklySetCeiling / (slots.length * selected.length)))
    let exercises = prescriptions(sets)
    const duration = () => 10 + exercises.reduce((sum, exercise) => {
      const week = exercise.weeks[3]!
      return sum + 2 + week.sets * ((week.durationSec ?? week.reps! * 3) + week.restSec) / 60
    }, 0)
    while (duration() > (brief.durationMin ?? 0) && sets > 1) exercises = prescriptions(--sets)
    return { weekday: session.weekday, title: session.title, exercises }
  })
  const template = validateProgramTemplate({ rationale: `Цель: ${(brief.goalText ?? '').slice(0, 160)}. Четыре недели, ${brief.frequency ?? 0} занятий в неделю. ${load.summary} В каждом занятии пять основных движений; рабочий вес подбирает тренер.`, sessions,
    progression: (load.mode === 'recent' ? 'Во вторую и третью недели добавляйте по одному повторению (в удержаниях — по 5 секунд).' : 'Первые две недели закрепляйте нагрузку; в третью добавьте одно повторение (в удержаниях — 5 секунд).')
      + ' Повышайте нагрузку только при сохранении техники и запаса сил. Подходы и целевое усилие сохраняются; четвёртая неделя — закрепление. При дискомфорте остановитесь и обсудите корректировку с тренером.',
  }, brief, today)
  validateProgramLoad(template, load)
  return template
}

export function validateProgramLoad(template: ProgramTemplate, load: ProgramLoad): void {
  for (let week = 0; week < 4; week++) {
    let sets = 0
    for (const session of template.sessions) for (const exercise of session.exercises) {
      const prescription = exercise.weeks[week]!
      if (prescription.sets > load.maxSetsPerExercise || prescription.rpe > load.rpe) throw new ProgramValidationError(['history_load_limit'])
      const initial = exercise.weeks[0]!
      const delta = prescription.reps === null ? prescription.durationSec! - initial.durationSec! : prescription.reps - initial.reps!
      // Check the upper progression envelope; hold/reduction are valid model choices.
      if (delta > load.increments[week]! * (prescription.reps === null ? 5 : 1)) throw new ProgramValidationError(['history_progression_mismatch'])
      sets += prescription.sets
    }
    if (load.weeklySetCeiling !== null && sets > load.weeklySetCeiling) throw new ProgramValidationError(['history_volume_limit'])
  }
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value) }
function bounded(value: unknown, min: number, max: number, integer = true): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
}

export class ProgramValidationError extends Error {
  constructor(readonly codes: string[]) { super('program_validation_failed') }
}

export function programBriefIssues(brief: ProgramBrief, today: string): string[] {
  const issues: string[] = []
  if (missingBriefFields(brief).length) issues.push('incomplete_brief')
  if (brief.adult !== true) issues.push('adult_confirmation_required')
  if (brief.limitations !== 'none') issues.push('limitations_require_review')
  if (activityOverlap(brief) && brief.activityOverlapConfirmed !== true) issues.push('other_activity_overlap_requires_review')
  if (!isCalendarDate(brief.startDate) || brief.startDate < today || brief.startDate > addDays(today, 90)) issues.push('invalid_start_date')
  const catalog = eligibleProgramExercises(brief.equipment ?? [], brief.excludedRefs ?? [])
  if (brief.preserveRefs?.some((ref) => !catalog.some((row) => row.ref === ref))) issues.push('catalog_preserved_exercise_unavailable')
  for (const family of ['squat', 'hinge', 'horizontal_push', 'horizontal_pull', 'core']) {
    if (!catalog.some((row) => row.movement === family)) issues.push(`catalog_missing_${family}`)
  }
  if (brief.weekdays?.some((day) => brief.weekdays!.includes(day % 7 + 1))) issues.push('adjacent_training_days')
  if (brief.durationMin !== undefined && brief.durationMin < 30) issues.push('insufficient_training_time')

  return issues
}

export function validateProgramTemplate(raw: unknown, brief: ProgramBrief, today: string): ProgramTemplate {
  const briefIssues = programBriefIssues(brief, today)
  if (briefIssues.length) throw new ProgramValidationError(briefIssues)
  if (!object(raw) || !exact(raw, ['rationale', 'progression', 'sessions'])
    || typeof raw.rationale !== 'string' || !raw.rationale.trim() || raw.rationale.length > 900
    || typeof raw.progression !== 'string' || !raw.progression.trim() || raw.progression.length > 600
    || !Array.isArray(raw.sessions) || raw.sessions.length !== brief.frequency) throw new ProgramValidationError(['invalid_template_schema'])
  const byRef = new Map(eligibleProgramExercises(brief.equipment!, brief.excludedRefs ?? []).map((row) => [row.ref, row]))
  const sessions: ProgramTemplate['sessions'] = []
  for (const session of raw.sessions) {
    if (!object(session) || !exact(session, ['weekday', 'title', 'exercises']) || !bounded(session.weekday, 1, 7)
      || !brief.weekdays!.includes(session.weekday) || typeof session.title !== 'string' || !session.title.trim() || session.title.length > 100
      || !Array.isArray(session.exercises) || session.exercises.length < 3 || session.exercises.length > 8) throw new ProgramValidationError(['invalid_session_schema'])
    const exercises: ProgramTemplate['sessions'][number]['exercises'] = []
    for (const item of session.exercises) {
      if (!object(item) || !exact(item, ['exerciseRef', 'weeks', ...('progressionNote' in item ? ['progressionNote'] : [])]) || typeof item.exerciseRef !== 'string' || !byRef.has(item.exerciseRef)
        || !Array.isArray(item.weeks) || item.weeks.length !== 4) throw new ProgramValidationError(['invalid_exercise_reference_or_weeks'])
      if ('progressionNote' in item && (typeof item.progressionNote !== 'string' || !item.progressionNote.trim() || item.progressionNote.length > 240)) throw new ProgramValidationError(['invalid_progression_note'])
      const exercise = byRef.get(item.exerciseRef)!
      const weeks: Prescription[] = []
      for (const week of item.weeks) {
        if (!object(week) || !exact(week, ['sets', 'reps', 'durationSec', 'rpe', 'restSec']) || !bounded(week.sets, 1, 4)
          || !bounded(week.rpe, 6, brief.experience === 'experienced' ? 8 : 7.5, false) || week.rpe * 2 % 1 !== 0
          || !bounded(week.restSec, 60, 180)
          || (exercise.inputKind === 'duration' ? week.reps !== null || !bounded(week.durationSec, 15, 90)
            : week.durationSec !== null || !bounded(week.reps, 4, 20))) throw new ProgramValidationError(['invalid_prescription'])
        weeks.push({ sets: week.sets, reps: week.reps as number | null, durationSec: week.durationSec as number | null, rpe: week.rpe, restSec: week.restSec })
      }
      exercises.push({ exerciseRef: item.exerciseRef, weeks, ...(typeof item.progressionNote === 'string' ? { progressionNote: item.progressionNote.trim() } : {}) })
    }
    if (new Set(exercises.map((row) => row.exerciseRef)).size !== exercises.length) throw new ProgramValidationError(['duplicate_session_exercise'])
    sessions.push({ weekday: session.weekday, title: session.title.trim(), exercises })
  }
  if (new Set(sessions.map((row) => row.weekday)).size !== sessions.length) throw new ProgramValidationError(['duplicate_weekday'])
  const issues = new Set<string>()
  for (const ref of brief.preserveRefs ?? []) if (!sessions.some((session) => session.exercises.some((exercise) => exercise.exerciseRef === ref))) issues.add('required_exercise_missing')
  const weekTotals: number[] = []
  for (let week = 0; week < 4; week++) {
    let weeklySets = 0
    const movements = new Set<string>()
    for (const session of sessions) {
      let duration = 10 // Explicit pilot estimate: preparation/warm-up allowance.
      let totalSets = 0
      let loadedTrunk = 0
      for (const item of session.exercises) {
        const exercise = byRef.get(item.exerciseRef)!
        const prescription = item.weeks[week]!
        movements.add(exercise.movement)
        totalSets += prescription.sets
        duration += 2 + prescription.sets * ((prescription.durationSec ?? prescription.reps! * 3) + prescription.restSec) / 60
        if (exercise.unsupportedTrunk && prescription.rpe >= 7) loadedTrunk++
        const previous = item.weeks[week - 1]
        if (previous) {
          const increased = [prescription.sets > previous.sets, (prescription.reps ?? prescription.durationSec!) > (previous.reps ?? previous.durationSec!), prescription.rpe > previous.rpe].filter(Boolean).length
          if (increased > 1 || prescription.sets > previous.sets + 1 || (prescription.reps ?? 0) > (previous.reps ?? 0) + 2
            || (prescription.durationSec ?? 0) > (previous.durationSec ?? 0) + 10 || prescription.rpe > previous.rpe + 0.5) issues.add('progression_jump')
        }
      }
      weeklySets += totalSets
      if (duration > brief.durationMin!) issues.add('session_exceeds_time_budget')
      if (totalSets > (brief.experience === 'experienced' ? 24 : 18)) issues.add('session_volume_limit')
      if (loadedTrunk > 1) issues.add('repeated_loaded_trunk')
    }
    for (const movement of ['squat', 'hinge', 'horizontal_push', 'horizontal_pull', 'core']) if (!movements.has(movement)) issues.add(`missing_weekly_${movement}`)
    weekTotals.push(weeklySets)
    if (week > 0 && weeklySets > weekTotals[week - 1]! * 1.2) issues.add('weekly_volume_jump')
  }
  // Check exact adjacent dates, including week boundaries, rather than day labels.
  const scheduled = scheduleSessions(brief, sessions)
  for (let index = 1; index < scheduled.length; index++) {
    const previous = scheduled[index - 1]!
    const current = scheduled[index]!
    if (current.date !== addDays(previous.date, 1)) continue
    const groups = (item: typeof current) => new Set(item.session.exercises.filter((row) => row.weeks[item.week]!.rpe >= 7
      && byRef.get(row.exerciseRef)!.movement !== 'accessory' && byRef.get(row.exerciseRef)!.movement !== 'core')
      .map((row) => byRef.get(row.exerciseRef)!.muscleGroup))
    const before = groups(previous)
    if ([...groups(current)].some((group) => before.has(group))) issues.add('adjacent_day_recovery')
  }
  if (issues.size) throw new ProgramValidationError([...issues])
  return { rationale: raw.rationale.trim(), progression: raw.progression.trim(), sessions }
}

export function addDays(date: string, days: number): string {
  if (!isCalendarDate(date)) throw new Error('invalid_program_date')
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function scheduleSessions(brief: ProgramBrief, sessions: ProgramTemplate['sessions']) {
  const scheduled: { date: string; week: number; session: ProgramTemplate['sessions'][number] }[] = []
  for (let offset = 0; offset < 28; offset++) {
    const date = addDays(brief.startDate!, offset)
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 + 1
    const session = sessions.find((row) => row.weekday === weekday)
    if (session) scheduled.push({ date, week: Math.floor(offset / 7), session })
  }
  return scheduled
}

function stableId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function materializeProgram(template: ProgramTemplate, brief: ProgramBrief, clientId: string, generationId: string) {
  const byRef = new Map(eligibleProgramExercises(brief.equipment!, brief.excludedRefs ?? []).map((row) => [row.ref, row]))
  const sessions = scheduleSessions(brief, template.sessions).map(({ date, week, session }) => ({
    day: date, week: week + 1, title: `Неделя ${week + 1}: ${session.title}`,
    exercises: session.exercises.map((item) => ({ ...byRef.get(item.exerciseRef)!, exerciseRef: item.exerciseRef, ...item.weeks[week]!, ...(item.progressionNote ? { progressionNote: item.progressionNote } : {}) })),
  }))
  if (sessions.length !== programSessionCount(brief.frequency!)) throw new Error('invalid_program_session_count')
  const workouts = sessions.map((session) => ({
    requestId: stableId(`${generationId}:${session.day}`), clientId, workoutDate: session.day,
    notes: [session.title, template.progression, ...session.exercises.flatMap((exercise) => exercise.progressionNote ? [`${exercise.name}: ${exercise.progressionNote}`] : [])].join('\n'),
    exercises: session.exercises.map((exercise, position) => ({
      source: 'system', ref: exercise.ref, name: exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind,
      position, blockId: stableId(`${generationId}:${session.day}:${position}`), blockType: 'single', blockRounds: 1,
      restBetweenSetsSec: exercise.restSec,
      sets: Array.from({ length: exercise.sets }, (_, setPosition) => ({ position: setPosition, rpe: exercise.rpe,
        ...(exercise.reps === null ? { durationSec: exercise.durationSec } : { reps: exercise.reps }),
      })),
    })),
  }))
  return { schemaVersion: 'program-v1', methodVersion: PROGRAM_METHOD_VERSION, catalogVersion: PROGRAM_CATALOG_VERSION,
    rationale: template.rationale, progression: template.progression, sessions, canonicalWorkouts: workouts }
}
