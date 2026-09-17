import { assessProgramQuality, QUALITY_REVIEW_NOTES } from './quality.js'
import { createHash } from 'node:crypto'
import { PROGRAM_CATALOG, eligibleProgramExercises } from './catalog.js'
import type { ProgramBrief } from './brief.js'
import { materializeProgram, ProgramValidationError, validateProgramLoad, validateProgramTemplate, type ProgramTemplate } from './generate.js'
import type { ProgramLoad } from './load.js'

export function editableProgramCatalog(brief: ProgramBrief) {
  return eligibleProgramExercises(brief.equipment ?? [], brief.excludedRefs ?? []).map(({ ref, name, inputKind }) => ({ ref, name, inputKind }))
}
export function editProgram(message: string, payload: Record<string, unknown>, brief: ProgramBrief, clientId: string, today: string) {
  const match = message.match(/^Измени упражнение (\d+) в занятии (\d{4}-\d{2}-\d{2}); область: (только это занятие|этот день во всех неделях); упражнение: ([^;]+); подходы: (\d+); повторы: (\d+|нет); секунды: (\d+|нет); усилие: ([\d.]+); отдых: (\d+)\.$/u)
  if (!match) throw new Error('program_edit_needs_form')
  const catalog = editableProgramCatalog(brief)
  const replacement = catalog.find((row) => row.name === match[4])
  if (!replacement) throw new ProgramValidationError(['invalid_edit_exercise'])
  const initial = validateProgramTemplate(payload.template, brief, today)
  const weeks: ProgramTemplate[] = Array.isArray(payload.weeklyTemplates) && payload.weeklyTemplates.length === 4
    ? structuredClone(payload.weeklyTemplates) as ProgramTemplate[] : Array.from({ length: 4 }, () => structuredClone(initial))
  const current = materializeProgram(initial, brief, clientId, 'lookup')
  const target = current.sessions.find((session) => session.day === match[2])
  if (!target) throw new ProgramValidationError(['invalid_edit_date'])
  const weekday = (new Date(`${target.day}T00:00:00Z`).getUTCDay() + 6) % 7 + 1
  const position = Number(match[1]) - 1
  const prescription = { sets: Number(match[5]), reps: match[6] === 'нет' ? null : Number(match[6]),
    durationSec: match[7] === 'нет' ? null : Number(match[7]), rpe: Number(match[8]), restSec: Number(match[9]) }
  const affected = match[3] === 'только это занятие' ? [target.week - 1] : [0, 1, 2, 3]
  for (const week of affected) {
    const exercise = weeks[week]!.sessions.find((session) => session.weekday === weekday)?.exercises[position]
    if (!exercise) throw new ProgramValidationError(['invalid_edit_position'])
    exercise.exerciseRef = replacement.ref
    exercise.weeks = Array.from({ length: 4 }, () => ({ ...prescription }))
    exercise.progressionNote = `Назначение изменено пользователем для ${match[3] === 'только это занятие' ? `занятия ${target.day}` : 'этого дня во всех четырёх неделях'}. Сравните новые значения с соседними неделями; дальнейшую нагрузку меняйте только при сохранении техники, целевого усилия и запаса сил.`
  }
  const load = payload.loadBasis as ProgramLoad
  if (!load || load.version !== 'observed-load-v1') throw new Error('program_edit_missing_basis')
  const isolated = weeks.map((template, week) => {
    const sameWeek = { ...template, sessions: template.sessions.map((session) => ({ ...session, exercises: session.exercises.map((exercise) => ({ ...exercise,
      weeks: Array.from({ length: 4 }, () => ({ ...exercise.weeks[week]! })),
    })) })) }
    const checked = validateProgramTemplate(sameWeek, brief, today)
    validateProgramLoad(checked, load)
    return checked
  })
  let previousTotal = 0
  for (let week = 0; week < 4; week++) {
    let total = 0
    for (const session of isolated[week]!.sessions) for (const [index, exercise] of session.exercises.entries()) {
      const dose = exercise.weeks[0]!
      const aerobic = PROGRAM_CATALOG.find((row) => row.ref === exercise.exerciseRef)?.movement === 'aerobic'
      total += aerobic ? 0 : dose.sets
      const previous = isolated[week - 1]?.sessions.find((row) => row.weekday === session.weekday)?.exercises[index]
      const first = initial.sessions.find((row) => row.weekday === session.weekday)?.exercises[index]
      if (previous?.exerciseRef === exercise.exerciseRef) {
        const before = previous.weeks[0]!
        if ([dose.sets > before.sets, (dose.reps ?? dose.durationSec!) > (before.reps ?? before.durationSec!), dose.rpe > before.rpe].filter(Boolean).length > 1
          || dose.sets > before.sets + 1 || (dose.reps ?? 0) > (before.reps ?? 0) + 2 || (dose.durationSec ?? 0) > (before.durationSec ?? 0) + (aerobic ? 300 : 10) || dose.rpe > before.rpe + 0.5) throw new ProgramValidationError(['progression_jump'])
      }
      if (!aerobic && first?.exerciseRef === exercise.exerciseRef && (dose.reps ?? dose.durationSec!) - (first.weeks[0]!.reps ?? first.weeks[0]!.durationSec!) > load.increments[week]! * (dose.reps === null ? 5 : 1)) throw new ProgramValidationError(['history_progression_mismatch'])
    }
    if (week > 0 && total > previousTotal * 1.2) throw new ProgramValidationError(['weekly_volume_jump'])
    previousTotal = total
  }
  const editId = createHash('sha256').update(JSON.stringify([clientId, brief, isolated])).digest('hex')
  const reviewNotes = [...new Set(isolated.flatMap((template) => assessProgramQuality(template, brief, load.familiarRefs).signals))].map((signal) => QUALITY_REVIEW_NOTES[signal]!)
  const materialized = isolated.map((template) => materializeProgram({ ...template, reviewNotes }, brief, clientId, editId))
  const result = { ...materialized[0]!, sessions: current.sessions.map((session, index) => materialized[session.week - 1]!.sessions[index]!),
    canonicalWorkouts: current.sessions.map((session, index) => materialized[session.week - 1]!.canonicalWorkouts[index]!) }
  const previousWorkouts = payload.canonicalWorkouts as typeof result.canonicalWorkouts
  if (!Array.isArray(previousWorkouts) || previousWorkouts.length !== result.canonicalWorkouts.length) throw new Error('program_edit_missing_original')
  result.canonicalWorkouts = result.canonicalWorkouts.map((workout, index) => ({ ...workout, requestId: previousWorkouts[index]!.requestId,
    exercises: workout.exercises.map((exercise, position) => ({ ...exercise, blockId: previousWorkouts[index]!.exercises[position]!.blockId })),
  }))
  // Canonical metadata is always from the checked catalog, including replacements.
  if (!PROGRAM_CATALOG.some((row) => row.ref === replacement.ref)) throw new Error('program_edit_catalog_changed')
  return { ...payload, ...result, weeklyTemplates: isolated, editGuidance: `Изменено: ${target.day}, упражнение ${position + 1} → ${replacement.name}. Область: ${match[3]}. Остальные назначения сохранены. Проверьте результат перед добавлением.` }
}
